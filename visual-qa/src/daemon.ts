import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Socket } from 'node:net';
import { chromium, type Browser } from 'playwright';
import { DEFAULTS, runFolderName, stateDir } from './config.ts';
import { ACTION_OPS, performAction, type ActionOp } from './actions.ts';
import { captureEvidence, type Evidence } from './evidence.ts';
import { openEventLog, type EventLog } from './events.ts';
import { createTypeSafeClient, type JevClient } from './jev-client.ts';
import {
  advanceStep, closeScenario, completeScenario, isAllowedUrl, openScenario, openScenarioInContext, resultOf, runJev,
  type GaveUp, type RunnerTimeouts, type ScenarioState,
} from './scenario-runner.ts';
import { formatControl, takeSnapshot } from './snapshot.ts';
import { CHROME_OFF_MESSAGE, connectChrome, explainConnectError, findChromeEndpoint } from './chrome.ts';
import { writeReport } from './report.ts';
import type { Suite } from './types.ts';

export type ScenarioRecord = {
  status: 'not_started' | 'running' | 'handback' | 'completed' | 'gave_up';
  currentStep: number;
  jevActions: number;
  claudeActions: number;
  elapsedMs: number;
  handbacks: Array<{ step: number; reason: string; detail: string }>;
  madeUp: Record<string, string>;
  gaveUp: GaveUp | null;
  evidence: Evidence | null;
};

export type RunFile = {
  suite: Suite;
  sessionId: string | null;
  startedAt: string;
  madeUpCache: Record<string, string>;
  scenarios: Record<string, ScenarioRecord>;
};

const emptyRecord = (): ScenarioRecord => ({
  status: 'not_started', currentStep: 0, jevActions: 0, claudeActions: 0, elapsedMs: 0, handbacks: [], madeUp: {}, gaveUp: null, evidence: null,
});

export function readRunFile(runDir: string): RunFile {
  return JSON.parse(fs.readFileSync(path.join(runDir, 'run.json'), 'utf8'));
}

function writeRunFile(runDir: string, run: RunFile): void {
  const file = path.join(runDir, 'run.json');
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(run, null, 2));
  fs.renameSync(`${file}.tmp`, file);
}

/** Creates <outputRoot>/<date> <topic>/ with a fresh run.json and returns its path. */
export function createRunFolder(suite: Suite, sessionId: string | null, now: Date, env: Record<string, string | undefined> = process.env): string {
  const runDir = runFolderName(suite.topic, now, fs.existsSync, env);
  fs.mkdirSync(runDir, { recursive: true });
  const scenarios: Record<string, ScenarioRecord> = {};
  for (const s of suite.scenarios) scenarios[s.id] = emptyRecord();
  writeRunFile(runDir, { suite, sessionId, startedAt: now.toISOString(), madeUpCache: {}, scenarios });
  return runDir;
}

export type DaemonOptions = RunnerTimeouts & {
  jev?: JevClient;
  takeoverBudget?: number;
  /** Stop after this long without a command (default 30 min) so an abandoned run frees Chromium. */
  idleMs?: number;
  onStop?: () => void;
  env?: Record<string, string | undefined>;
};

class CommandError extends Error {}

export async function startDaemon(runDir: string, opts: DaemonOptions = {}): Promise<{ port: number; token: string; close(): Promise<void> }> {
  const run = readRunFile(runDir);
  const jev = opts.jev ?? createTypeSafeClient();
  const budget = opts.takeoverBudget ?? DEFAULTS.takeoverBudget;
  const events: EventLog = openEventLog(path.join(runDir, 'events.jsonl'));
  const chromeMode = run.suite.browser === 'chrome';
  let browser: Browser;
  if (chromeMode) {
    // the user's own Chrome (§12): they click Allow once; we only ever touch tabs we open
    const env = opts.env ?? process.env;
    const endpoint = findChromeEndpoint(env);
    if (!endpoint) throw new Error(CHROME_OFF_MESSAGE);
    const connectTimeout = Number(env.VISUAL_QA_CHROME_CONNECT_TIMEOUT_MS ?? 100_000);
    try {
      browser = await connectChrome(endpoint, connectTimeout);
    } catch (e) {
      throw new Error(explainConnectError(e, connectTimeout));
    }
  } else {
    browser = await chromium.launch();
  }
  const needBrowser = () => {
    if (!browser.isConnected()) {
      throw new CommandError(`the connection to the browser was lost${chromeMode ? ' (was Chrome closed?)' : ''} — run report to keep what was captured`);
    }
  };
  const states = new Map<string, ScenarioState>();
  const token = crypto.randomUUID();
  const t: RunnerTimeouts = { navTimeoutMs: opts.navTimeoutMs, actionTimeoutMs: opts.actionTimeoutMs, settleMs: opts.settleMs };
  const lookShots = new Map<string, number>();

  const persist = (state: ScenarioState) => {
    run.scenarios[state.scenario.id] = {
      status: state.status, currentStep: state.currentStep, jevActions: state.jevActions, claudeActions: state.claudeActions,
      elapsedMs: Date.now() - state.startedAt, handbacks: state.handbacks, madeUp: state.madeUpUsed, gaveUp: state.gaveUp, evidence: state.evidence,
    };
    writeRunFile(runDir, run);
  };

  const scenarioOf = (id: unknown) => {
    const s = run.suite.scenarios.find((x) => x.id === id);
    if (!s) throw new CommandError(`unknown scenario id "${String(id)}"`);
    return s;
  };

  const openState = (id: unknown): ScenarioState => {
    const s = scenarioOf(id);
    const state = states.get(s.id);
    if (!state) throw new CommandError(`scenario ${s.id} has not been started — use: run ${s.id}`);
    if (state.status === 'completed' || state.status === 'gave_up') throw new CommandError(`scenario ${s.id} is already ${state.status}`);
    return state;
  };

  const finishIfDone = async (state: ScenarioState) => {
    if (state.status === 'completed' || state.status === 'gave_up') await closeScenario(state);
  };

  const sessionFile = (name: string | null) => {
    if (!name) return null;
    const file = path.join(stateDir(opts.env ?? process.env), 'sessions', `${name}.json`);
    return fs.existsSync(file) ? file : null;
  };

  const commands: Record<string, (a: Record<string, unknown>) => Promise<unknown>> = {
    async run(a) {
      const s = scenarioOf(a.id);
      const existing = states.get(s.id);
      if (existing) {
        if (existing.status === 'completed' || existing.status === 'gave_up') return resultOf(existing);
        throw new CommandError(`scenario ${s.id} is already started — use: resume ${s.id}`);
      }
      needBrowser();
      events.append({ type: 'scenario_start', id: s.id });
      const state = chromeMode
        ? await openScenarioInContext(browser.contexts()[0], run.suite, s, run.madeUpCache, t, (st) => states.set(s.id, st))
        : await openScenario(browser, run.suite, s, sessionFile(s.session), run.madeUpCache, t, (st) => states.set(s.id, st));
      states.set(s.id, state);
      const result = await runJev(state, { jev, events, runDir, ...t });
      persist(state);
      await finishIfDone(state);
      return result;
    },

    async resume(a) {
      needBrowser();
      const state = openState(a.id);
      const result = await runJev(state, { jev, events, runDir, ...t });
      persist(state);
      await finishIfDone(state);
      return result;
    },

    async look(a) {
      needBrowser();
      const state = openState(a.id);
      const snap = await takeSnapshot(state.page, { frames: true, maxTextChars: DEFAULTS.lookTextChars });
      state.lastSnapshot = snap;
      const steps = state.scenario.steps;
      const shown = snap.controls.slice(0, DEFAULTS.lookMaxControls);
      const lines = [
        `URL: ${snap.url}`,
        `Title: ${snap.title}`,
        state.currentStep < steps.length ? `Step ${state.currentStep + 1} of ${steps.length}: "${steps[state.currentStep]}"` : 'All steps done',
        `Open tabs: ${state.ownPages.filter((p) => !p.isClosed()).length}`,
        `Controls (${snap.controls.length}${shown.length < snap.controls.length ? `, first ${shown.length} shown` : ''}):`,
        ...shown.map(formatControl),
        'Page text:',
        snap.text,
      ];
      return { text: lines.join('\n') };
    },

    async act(a) {
      needBrowser();
      const state = openState(a.id);
      if (state.claudeActions >= budget) throw new CommandError('takeover budget exceeded — give up');
      const op = String(a.op) as ActionOp;
      if (!ACTION_OPS.includes(op)) throw new CommandError(`unknown op "${op}" (use: ${ACTION_OPS.join(', ')})`);
      const snap = state.lastSnapshot ?? (state.lastSnapshot = await takeSnapshot(state.page, { frames: true, maxTextChars: DEFAULTS.lookTextChars }));
      const ref = a.ref === undefined || a.ref === null ? undefined : Number(a.ref);
      const value = a.value === undefined || a.value === null ? undefined : String(a.value);
      const control = ref === undefined ? null : snap.controls.find((c) => c.ref === ref) ?? null;
      if (op === 'type' && control?.isPassword) {
        throw new CommandError('refusing to type into a password field — use a saved session (qa login) or put the value in the scenario values');
      }
      if (op === 'goto' && value !== undefined && isAllowedUrl(value, run.suite.allowHosts) !== true) {
        throw new CommandError(`refusing to open ${value}: host is not in allow_hosts (${run.suite.allowHosts.join(', ')})`);
      }
      const res = await performAction(state, snap, { op, ref, value }, t);
      state.claudeActions++;
      if (op === 'type' && control) {
        state.lastTypedRef = control.ref;
        if (a.madeUp && value !== undefined) {
          run.madeUpCache[control.name] = value;
          state.madeUpUsed[control.name] = value;
        }
      }
      events.append({
        type: 'action', id: state.scenario.id, step: state.currentStep, actor: 'claude', op, ref: ref ?? null, label: control?.name ?? null,
        ...(value !== undefined && !control?.isPassword ? { value } : {}), ...(a.madeUp ? { valueSource: 'made_up' } : {}), ok: res.ok,
      });
      persist(state);
      if (!res.ok) throw new CommandError(res.detail);
      return { ok: true, url: state.page.url(), claudeActions: state.claudeActions, budgetLeft: budget - state.claudeActions };
    },

    async shot(a) {
      needBrowser();
      const state = openState(a.id);
      const n = (lookShots.get(state.scenario.id) ?? 0) + 1;
      lookShots.set(state.scenario.id, n);
      const dir = path.join(runDir, 'scenarios', state.scenario.id);
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `look-${n}.jpg`);
      await state.page.screenshot({ path: file, type: 'jpeg', quality: DEFAULTS.jpegQuality, scale: 'css' });
      return { path: file };
    },

    async 'step-done'(a) {
      needBrowser();
      const state = openState(a.id);
      events.append({ type: 'step_done', id: state.scenario.id, step: state.currentStep, actor: 'claude' });
      advanceStep(state);
      let result;
      if (state.currentStep >= state.scenario.steps.length) {
        result = await completeScenario(state, events, runDir, t);
      } else {
        state.status = 'handback';
        result = resultOf(state);
      }
      persist(state);
      await finishIfDone(state);
      return result;
    },

    async giveup(a) {
      const s = scenarioOf(a.id);
      const cls = a.class === 'app_problem' || a.class === 'tooling_or_environment' ? a.class : null;
      if (!cls) throw new CommandError('--class must be app_problem or tooling_or_environment');
      const reason = String(a.reason ?? '').trim();
      if (!reason) throw new CommandError('--reason is required');
      const gaveUp: GaveUp = { class: cls, reason };
      const state = states.get(s.id);
      events.append({ type: 'giveup', id: s.id, ...gaveUp });
      if (!state) {
        run.scenarios[s.id] = { ...emptyRecord(), status: 'gave_up', gaveUp };
        writeRunFile(runDir, run);
        return { id: s.id, status: 'gave_up', step: 0, stepText: s.steps[0] ?? null, jevActions: 0, claudeActions: 0, elapsedMs: 0 };
      }
      if (state.status === 'completed' || state.status === 'gave_up') throw new CommandError(`scenario ${s.id} is already ${state.status}`);
      state.evidence = await captureEvidence(state, runDir, { settleMs: t.settleMs }).catch(() => null);
      state.status = 'gave_up';
      state.gaveUp = gaveUp;
      const result = resultOf(state);
      events.append({ type: 'scenario_end', id: s.id, status: 'gave_up', elapsedMs: result.elapsedMs });
      persist(state);
      await finishIfDone(state);
      return result;
    },

    async evidence(a) {
      const s = scenarioOf(a.id);
      const ev = run.scenarios[s.id]?.evidence;
      if (!ev) throw new CommandError(`no evidence for ${s.id} (status: ${run.scenarios[s.id]?.status ?? 'unknown'})`);
      return {
        id: s.id, expected: s.expected, url: ev.url, title: ev.title, httpStatus: ev.httpStatus, consoleErrors: ev.consoleErrors,
        errorPhrase: ev.errorPhrase, textFile: ev.textFile, viewportShot: ev.viewportShot, fullPageShot: ev.fullPageShot,
        judgeOutputPath: path.join(runDir, 'scenarios', s.id, 'judge.json'),
      };
    },

    async report() {
      return writeReport(runDir);
    },

    async stop() {
      setImmediate(() => { void close().then(() => opts.onStop?.()); });
      return { stopped: true, runDir };
    },
  };

  let queue: Promise<unknown> = Promise.resolve();
  const sockets = new Set<Socket>();
  const server = http.createServer((req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    };
    if (req.method !== 'POST' || req.url !== '/cmd') return send(404, { ok: false, error: 'not found' });
    if (req.headers.authorization !== `Bearer ${token}`) return send(401, { ok: false, error: 'unauthorized' });
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let msg: { name?: string; args?: Record<string, unknown> };
      try {
        msg = JSON.parse(raw || '{}');
      } catch {
        return send(400, { ok: false, error: 'invalid JSON' });
      }
      const handler = msg.name ? commands[msg.name] : undefined;
      if (!handler) return send(400, { ok: false, error: `unknown command "${msg.name}"` });
      touch();
      const exec = async () => {
        try {
          send(200, { ok: true, result: await handler(msg.args ?? {}) });
        } catch (e) {
          send(200, { ok: false, error: e instanceof CommandError ? e.message : `internal error: ${(e as Error).message}` });
        }
      };
      // stop and report never touch the browser, so they must not wait behind a stuck command
      if (msg.name === 'stop' || msg.name === 'report') return void exec();
      // everything else runs one at a time: the browser state is shared
      queue = queue.then(exec).catch(() => {});
    });
  });
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });

  const idleMs = opts.idleMs ?? 30 * 60 * 1000;
  let idleTimer: NodeJS.Timeout | null = null;
  function touch(): void {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { void close().then(() => opts.onStop?.()); }, idleMs);
    idleTimer.unref();
  }

  let closed = false;
  async function close(): Promise<void> {
    if (closed) return;
    closed = true;
    if (idleTimer) clearTimeout(idleTimer);
    // chrome mode: close only our own tabs, then disconnect (never closes the user's Chrome)
    for (const st of states.values()) await closeScenario(st);
    await browser.close().catch(() => {});
    for (const s of sockets) s.destroy();
    await new Promise<void>((r) => server.close(() => r()));
  }

  const port = await new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as import('node:net').AddressInfo).port));
  });
  const daemonFile = path.join(runDir, 'daemon.json');
  fs.writeFileSync(`${daemonFile}.tmp`, JSON.stringify({ port, token, pid: process.pid }), { mode: 0o600 });
  fs.renameSync(`${daemonFile}.tmp`, daemonFile); // atomic: `qa start` never reads half a file
  touch();
  return { port, token, close };
}
