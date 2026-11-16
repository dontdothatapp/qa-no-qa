import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Socket } from 'node:net';
import type { Browser } from 'playwright';
import { DEFAULTS, runFolderName } from './config.ts';
import { ACTION_OPS, performAction, type ActionOp } from './actions.ts';
import { type Checkpoint, type Evidence } from './evidence.ts';
import { openEventLog, type EventLog } from './events.ts';
import { createTypeSafeClient, type JevClient } from './jev-client.ts';
import {
  blockedGiveUp, closeScenario, completeScenario, finishGaveUp, isAllowedUrl, markStepDone, openLoggedOutScenario, openScenarioInContext,
  resultOf, runJev, settleResponses, stopIfBlocked, type GaveUp, type RunnerTimeouts, type ScenarioState,
} from './scenario-runner.ts';
import { botBlockReason, describeFailed } from './network.ts';
import { formatControl, takeSnapshot } from './snapshot.ts';
import { CHROME_OFF_MESSAGE, connectChrome, explainConnectError, findChromeEndpoint } from './chrome.ts';
import { writeReport } from './report.ts';
import type { Suite } from './types.ts';

export type ScenarioRecord = {
  status: 'not_started' | 'running' | 'handback' | 'completed' | 'gave_up' | 'skipped';
  currentStep: number;
  jevActions: number;
  claudeActions: number;
  elapsedMs: number;
  handbacks: Array<{ step: number; reason: string; detail: string }>;
  madeUp: Record<string, string>;
  gaveUp: GaveUp | null;
  evidence: Evidence | null;
  checkpoints: Checkpoint[];
  skipReason: string | null;
};

export type RunFile = {
  suite: Suite;
  sessionId: string | null;
  startedAt: string;
  /** The earlier run this one continues (absolute path), or null. */
  continuesFrom: string | null;
  madeUpCache: Record<string, string>;
  scenarios: Record<string, ScenarioRecord>;
};

const emptyRecord = (): ScenarioRecord => ({
  status: 'not_started', currentStep: 0, jevActions: 0, claudeActions: 0, elapsedMs: 0, handbacks: [], madeUp: {}, gaveUp: null, evidence: null, checkpoints: [], skipReason: null,
});

export function readRunFile(runDir: string): RunFile {
  const run: RunFile = JSON.parse(fs.readFileSync(path.join(runDir, 'run.json'), 'utf8'));
  for (const rec of Object.values(run.scenarios)) {
    rec.checkpoints ??= []; // older runs have none
    rec.skipReason ??= null;
  }
  run.continuesFrom ??= null;
  return run;
}

function writeRunFile(runDir: string, run: RunFile): void {
  const file = path.join(runDir, 'run.json');
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(run, null, 2));
  fs.renameSync(`${file}.tmp`, file);
}

/** Creates <outputRoot>/<date> <topic>/ with a fresh run.json and returns its path. */
export function createRunFolder(suite: Suite, sessionId: string | null, now: Date, env: Record<string, string | undefined> = process.env, continuesFrom: string | null = null): string {
  const runDir = runFolderName(suite.topic, now, fs.existsSync, env);
  fs.mkdirSync(runDir, { recursive: true });
  const scenarios: Record<string, ScenarioRecord> = {};
  for (const s of suite.scenarios) scenarios[s.id] = emptyRecord();
  writeRunFile(runDir, { suite, sessionId, startedAt: now.toISOString(), continuesFrom, madeUpCache: {}, scenarios });
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

const isFinished = (status: ScenarioRecord['status']) => status === 'completed' || status === 'gave_up' || status === 'skipped';

export async function startDaemon(runDir: string, opts: DaemonOptions = {}): Promise<{ port: number; token: string; close(): Promise<void> }> {
  const run = readRunFile(runDir);
  const jev = opts.jev ?? createTypeSafeClient();
  const budget = opts.takeoverBudget ?? DEFAULTS.takeoverBudget;
  const events: EventLog = openEventLog(path.join(runDir, 'events.jsonl'));
  // the user's own Chrome: they click Allow once; we only ever touch tabs (and contexts) we open
  const env = opts.env ?? process.env;
  const endpoint = findChromeEndpoint(env);
  if (!endpoint) throw new Error(CHROME_OFF_MESSAGE);
  const connectTimeout = Number(env.VISUAL_QA_CHROME_CONNECT_TIMEOUT_MS ?? 100_000);
  let browser: Browser;
  try {
    browser = await connectChrome(endpoint, connectTimeout);
  } catch (e) {
    throw new Error(explainConnectError(e, connectTimeout));
  }
  const needBrowser = () => {
    if (!browser.isConnected()) {
      throw new CommandError('the connection to the browser was lost (was Chrome closed?) — run report to keep what was captured');
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
      checkpoints: [...state.checkpoints], skipReason: null,
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
    if (!state) {
      const rec = run.scenarios[s.id];
      if (rec && isFinished(rec.status)) throw new CommandError(`scenario ${s.id} is already ${rec.status}`);
      throw new CommandError(`scenario ${s.id} has not been started — use: run ${s.id}`);
    }
    if (state.status === 'completed' || state.status === 'gave_up') throw new CommandError(`scenario ${s.id} is already ${state.status}`);
    return state;
  };

  const finishIfDone = async (state: ScenarioState) => {
    if (state.status === 'completed' || state.status === 'gave_up') await closeScenario(state);
  };

  const commands: Record<string, (a: Record<string, unknown>) => Promise<unknown>> = {
    async run(a) {
      const s = scenarioOf(a.id);
      const stored = run.scenarios[s.id];
      if (!states.has(s.id) && stored && isFinished(stored.status)) {
        // finished before the daemon was reopened: report what was stored, open nothing
        const steps = s.steps;
        return {
          id: s.id, status: stored.status, step: stored.currentStep, stepText: stored.currentStep < steps.length ? steps[stored.currentStep] : null,
          jevActions: stored.jevActions, claudeActions: stored.claudeActions, elapsedMs: stored.elapsedMs,
          ...(stored.gaveUp ? { gaveUp: stored.gaveUp } : {}), ...(stored.skipReason ? { skipReason: stored.skipReason } : {}),
        };
      }
      const existing = states.get(s.id);
      if (existing) {
        if (existing.status === 'completed' || existing.status === 'gave_up') return resultOf(existing);
        throw new CommandError(`scenario ${s.id} is already started — use: resume ${s.id}`);
      }
      needBrowser();
      events.append({ type: 'scenario_start', id: s.id });
      const state = s.loggedOut
        ? await openLoggedOutScenario(browser, run.suite, s, run.madeUpCache, t, (st) => states.set(s.id, st))
        : await openScenarioInContext(browser.contexts()[0], run.suite, s, run.madeUpCache, t, (st) => states.set(s.id, st));
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
      await settleResponses(state, 1000);
      const failed = state.failedRequests.slice(-5).map(describeFailed);
      const lines = [
        ...(state.botBlock ? [`${botBlockReason(state.botBlock)} — this scenario cannot continue; your next command ends it.`] : []),
        `URL: ${snap.url}`,
        `Title: ${snap.title}`,
        state.currentStep < steps.length ? `Step ${state.currentStep + 1} of ${steps.length}: "${steps[state.currentStep]}"` : 'All steps done',
        `Open tabs: ${state.ownPages.filter((p) => !p.isClosed()).length}`,
        ...(failed.length ? ['Failed requests to the site:', ...failed] : []),
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
        throw new CommandError('refusing to type into a password field — passwords are never filled; sign in to the site in your Chrome');
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
      const blocked = await stopIfBlocked(state, events, runDir, t);
      persist(state);
      if (blocked) {
        await finishIfDone(state);
        return blocked;
      }
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
      const blocked = await stopIfBlocked(state, events, runDir, t);
      if (blocked) {
        persist(state);
        await finishIfDone(state);
        return blocked;
      }
      await markStepDone(state, events, runDir, 'claude');
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
      const cls = a.class === 'app_problem' || a.class === 'tooling_or_environment' || a.class === 'no_matching_page' ? a.class : null;
      if (!cls) throw new CommandError('--class must be app_problem, tooling_or_environment or no_matching_page');
      const reason = String(a.reason ?? '').trim();
      if (!reason) throw new CommandError('--reason is required');
      const requested: GaveUp = { class: cls, reason };
      const state = states.get(s.id);
      const stored = run.scenarios[s.id];
      if (!state && stored && isFinished(stored.status)) throw new CommandError(`scenario ${s.id} is already ${stored.status}`);
      if (!state) {
        events.append({ type: 'giveup', id: s.id, ...requested });
        run.scenarios[s.id] = { ...emptyRecord(), status: 'gave_up', gaveUp: requested };
        writeRunFile(runDir, run);
        return { id: s.id, status: 'gave_up', step: 0, stepText: s.steps[0] ?? null, jevActions: 0, claudeActions: 0, elapsedMs: 0, gaveUp: requested };
      }
      if (state.status === 'completed' || state.status === 'gave_up') throw new CommandError(`scenario ${s.id} is already ${state.status}`);
      // the runner saw the site's bot protection refuse a request: that, not the takeover's guess, is the reason
      await settleResponses(state);
      const gaveUp = state.botBlock ? blockedGiveUp(state.botBlock) : requested;
      events.append({ type: 'giveup', id: s.id, ...gaveUp, ...(gaveUp !== requested ? { requested } : {}) });
      const result = await finishGaveUp(state, gaveUp, events, runDir, t);
      persist(state);
      await finishIfDone(state);
      return result;
    },

    async skip(a) {
      const s = scenarioOf(a.id);
      const reason = String(a.reason ?? '').trim();
      if (!reason) throw new CommandError('--reason is required');
      if (states.has(s.id) || (run.scenarios[s.id] && run.scenarios[s.id].status !== 'not_started')) throw new CommandError(`scenario ${s.id} already started`);
      events.append({ type: 'skip', id: s.id, reason });
      run.scenarios[s.id] = { ...emptyRecord(), status: 'skipped', skipReason: reason };
      writeRunFile(runDir, run);
      return { id: s.id, status: 'skipped', skipReason: reason };
    },

    async evidence(a) {
      const s = scenarioOf(a.id);
      const rec = run.scenarios[s.id];
      const judgeOutputPath = path.join(runDir, 'scenarios', s.id, 'judge.json');
      const ev = rec?.evidence ?? null;
      const checkpoints = rec?.checkpoints ?? [];
      const base = {
        id: s.id, url: ev?.url ?? '', title: ev?.title ?? '', httpStatus: ev?.httpStatus ?? null, consoleErrors: ev?.consoleErrors ?? [],
        errorPhrase: ev?.errorPhrase ?? null, textFile: ev?.textFile ?? '', viewportShot: ev?.viewportShot ?? '', fullPageShot: ev?.fullPageShot ?? '',
        judgeOutputPath,
      };
      const checkpointOf = (afterStep: number) => checkpoints.find((c) => c.step === afterStep);
      if (rec?.status === 'completed' && ev) {
        const reliesOn = s.reliesOn.map((r) => {
          const c = r.afterStep === null ? null : checkpointOf(r.afterStep);
          return r.afterStep === null
            ? { what: r.what, viewportShot: ev.viewportShot, textFile: ev.textFile }
            : { what: r.what, viewportShot: c?.viewportShot ?? null, textFile: c?.textFile ?? null };
        });
        return { ...base, needsJudge: true, scope: 'full', expected: s.expected, reliesOn };
      }
      if (rec?.status === 'gave_up' && rec.gaveUp?.class === 'app_problem') {
        const reliesOn = s.reliesOn.flatMap((r) => {
          const c = r.afterStep === null ? undefined : checkpointOf(r.afterStep);
          return c ? [{ what: r.what, viewportShot: c.viewportShot, textFile: c.textFile }] : [];
        });
        if (reliesOn.length) return { ...base, needsJudge: true, scope: 'relies_on_only', reliesOn };
        return { ...base, needsJudge: false, scope: null, reason: 'the test gave up on an app problem before any relies_on condition was captured', reliesOn: [] };
      }
      const why = rec?.status === 'gave_up' ? `the test gave up (${rec.gaveUp?.class ?? 'unknown'})` : `the test is ${rec?.status ?? 'unknown'}`;
      return { ...base, needsJudge: false, scope: null, reason: `nothing to judge: ${why}`, reliesOn: [] };
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
    // close only our own tabs and contexts, then disconnect (never closes the user's Chrome)
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
