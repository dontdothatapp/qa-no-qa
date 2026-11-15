#!/usr/bin/env node
/**
 * qa — visual QA runner CLI. Every command prints one JSON object (except `look`, which prints text).
 * Exit code 0 on success, 1 with {"error": "..."} otherwise.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { stateDir } from '../src/config.ts';
import { createRunFolder, startDaemon } from '../src/daemon.ts';
import { clearCurrentRun, DaemonUnreachable, isOurDaemon, readCurrentRun, sendCommand, writeCurrentRun } from '../src/daemon-client.ts';
import { writeReport } from '../src/report.ts';
import { CHROME_OFF_MESSAGE, findChromeEndpoint } from '../src/chrome.ts';
import { createScriptedClient, createTypeSafeClient, JevError, type JevAnswer, type JevClient } from '../src/jev-client.ts';
import { loadSuite, SuiteError } from '../src/scenarios.ts';
import { runDoctor } from '../src/doctor.ts';
import { login } from '../src/login.ts';
import { chromium } from 'playwright';
import { TypeSafeClient, noul } from '@typesafe-ai/sdk';

export const COMMANDS = ['start', 'daemon', 'run', 'resume', 'look', 'act', 'shot', 'step-done', 'giveup', 'evidence', 'report', 'stop', 'doctor', 'login'] as const;
export type CommandName = (typeof COMMANDS)[number];

const BIN = fs.realpathSync(fileURLToPath(import.meta.url));
const REF_OPS = new Set(['click', 'type', 'select', 'upload', 'scroll', 'press_enter']);

class UsageError extends Error {}

function fakeJevFrom(file: string): JevClient {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Array<Partial<JevAnswer> & { error?: 'fatal' | 'transient' | 'request' }>;
  return createScriptedClient(raw.map((a) => (a.error ? new JevError(`fake ${a.error} error`, a.error) : a)));
}

async function waitFor(file: string, child: { exited: boolean }, ms: number): Promise<{ port: number; token: string; pid: number }> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (fs.existsSync(file)) {
      try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {
        // partially written: try again
      }
    }
    if (child.exited) {
      const logFile = path.join(path.dirname(file), 'daemon.log');
      const last = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').trim().split('\n').filter((l) => /Error/.test(l)).pop() : '';
      throw new Error(`the run daemon could not start${last ? `: ${last.trim()}` : ''} — see ${logFile}`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`the run daemon did not start within ${Math.round(ms / 1000)} s`);
}

async function start(positionals: string[], values: Record<string, unknown>): Promise<unknown> {
  const file = positionals[0];
  if (!file) throw new UsageError('usage: qa start <scenarios.yaml> --session <id>');
  const current = readCurrentRun();
  if (current) {
    if (isOurDaemon(current.pid)) throw new Error(`a run is already active (pid ${current.pid}, ${current.runDir}) — finish it or run: qa stop`);
    clearCurrentRun(); // stale: the daemon is gone (its PID may now belong to another process)
  }
  let suite;
  try {
    suite = loadSuite(file);
  } catch (e) {
    if (e instanceof SuiteError) throw new Error(`invalid scenario file: ${e.problems.join('; ')}`);
    throw e;
  }
  const chromeMode = suite.browser === 'chrome';
  let note: string | undefined;
  if (chromeMode) {
    if (!findChromeEndpoint()) throw new Error(CHROME_OFF_MESSAGE);
    if (suite.scenarios.some((s) => s.session)) note = 'session: is ignored in chrome mode — scenarios use your Chrome sign-ins';
    process.stderr.write('Click "Allow" in Chrome to let the QA run connect.\n');
  } else {
    for (const s of suite.scenarios) {
      if (s.session && !fs.existsSync(path.join(stateDir(), 'sessions', `${s.session}.json`))) {
        throw new Error(`session "${s.session}" not found — run: node ${BIN} login ${s.session} <url>`);
      }
    }
  }
  const runDir = createRunFolder(suite, typeof values.session === 'string' ? values.session : null, new Date());
  const log = fs.openSync(path.join(runDir, 'daemon.log'), 'a');
  const child = spawn(process.execPath, [BIN, 'daemon', runDir], { detached: true, stdio: ['ignore', log, log], env: process.env });
  const state = { exited: false };
  child.on('exit', () => { state.exited = true; });
  child.unref();
  let d;
  try {
    const deadline = Number(process.env.VISUAL_QA_DAEMON_START_TIMEOUT_MS ?? (chromeMode ? 110_000 : 20_000));
    d = await waitFor(path.join(runDir, 'daemon.json'), state, deadline);
  } catch (e) {
    try { if (child.pid) process.kill(child.pid, 'SIGTERM'); } catch { /* already gone */ }
    throw e;
  }
  writeCurrentRun({ runDir, port: d.port, token: d.token, pid: d.pid });
  return { runDir, browser: suite.browser, scenarios: suite.scenarios.map((s) => s.id), judgeModel: suite.judgeModel, ...(note ? { note } : {}) };
}

async function stop(): Promise<unknown> {
  const current = readCurrentRun();
  if (!current) return { stopped: false, note: 'no active run' };
  let result: unknown = { stopped: true, runDir: current.runDir };
  if (isOurDaemon(current.pid)) {
    try {
      result = await sendCommand('stop', {}, process.env, 10_000);
    } catch {
      try { process.kill(current.pid, 'SIGTERM'); } catch { /* already gone */ }
    }
  }
  clearCurrentRun();
  return result;
}

function needId(positionals: string[], usage: string): string {
  if (!positionals[0]) throw new UsageError(`usage: qa ${usage}`);
  return positionals[0];
}

export async function main(argv: string[]): Promise<number> {
  const [name, ...rest] = argv;
  const print = (v: unknown) => process.stdout.write(`${JSON.stringify(v)}\n`);
  try {
    if (!name || !(COMMANDS as readonly string[]).includes(name)) throw new UsageError(`usage: qa <${COMMANDS.join('|')}> ...`);
    const { positionals, values } = parseArgs({
      args: rest,
      allowPositionals: true,
      options: { session: { type: 'string' }, class: { type: 'string' }, reason: { type: 'string' }, 'made-up': { type: 'boolean' } },
    });
    switch (name as CommandName) {
      case 'start':
        print(await start(positionals, values));
        return 0;
      case 'daemon': {
        const runDir = needId(positionals, 'daemon <runDir>');
        const jev = process.env.VISUAL_QA_FAKE_JEV ? fakeJevFrom(process.env.VISUAL_QA_FAKE_JEV) : createTypeSafeClient();
        const d = await startDaemon(runDir, { jev, onStop: () => process.exit(0) });
        process.on('SIGTERM', () => { void d.close().then(() => process.exit(0)); });
        return -1; // keep running
      }
      case 'stop':
        print(await stop());
        return 0;
      case 'look': {
        const r = (await sendCommand('look', { id: needId(positionals, 'look <id>') })) as { text: string };
        process.stdout.write(`${r.text}\n`);
        return 0;
      }
      case 'act': {
        const [id, op, ...more] = positionals;
        if (!id || !op) throw new UsageError('usage: qa act <id> <op> [ref] [value] [--made-up]');
        let ref: number | undefined;
        if (REF_OPS.has(op) && more[0] !== undefined && /^\d+$/.test(more[0])) ref = Number(more.shift());
        const value = more.length ? more.join(' ') : undefined;
        print(await sendCommand('act', { id, op, ref, value, madeUp: values['made-up'] === true }));
        return 0;
      }
      case 'giveup':
        print(await sendCommand('giveup', { id: needId(positionals, 'giveup <id> --class <c> --reason <text>'), class: values.class, reason: values.reason }));
        return 0;
      case 'report': {
        // works without a live daemon: the report only needs the run folder
        if (positionals[0]) {
          print(writeReport(path.resolve(positionals[0])));
          return 0;
        }
        const current = readCurrentRun();
        if (!current) throw new UsageError('no active run — pass the run folder: qa report <runDir>');
        try {
          print(await sendCommand('report', {}));
        } catch (e) {
          if (!(e instanceof DaemonUnreachable)) throw e;
          print(writeReport(current.runDir));
        }
        return 0;
      }
      case 'doctor': {
        const r = await runDoctor({
          env: process.env,
          nodeVersion: process.version,
          chromiumPath: () => chromium.executablePath(),
          fileExists: fs.existsSync,
          chromeEndpoint: () => findChromeEndpoint(),
          pingJev: async (key) => {
            const client = new TypeSafeClient({ apiKey: key, logLevel: 'off', retry: { maxRetries: 0 } } as ConstructorParameters<typeof TypeSafeClient>[0]);
            await client.systemOne({ state: 'ping', questions: { ok: noul('Is this a test message?') } } as Parameters<TypeSafeClient['systemOne']>[0]);
          },
        });
        print(r);
        return r.ok ? 0 : 1;
      }
      case 'login': {
        const [sessionName, url] = positionals;
        if (!sessionName || !url) throw new UsageError('usage: qa login <name> <url>');
        print(await login(sessionName, url));
        return 0;
      }
      default:
        print(await sendCommand(name, { id: needId(positionals, `${name} <id>`) }));
        return 0;
    }
  } catch (e) {
    print({ error: (e as Error).message });
    return 1;
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === BIN) {
  main(process.argv.slice(2)).then((code) => {
    if (code >= 0) process.exitCode = code;
  });
}
