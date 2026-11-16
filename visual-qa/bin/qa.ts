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
import { createRunFolder, skipWithoutDaemon, startDaemon } from '../src/daemon.ts';
import { clearCurrentRun, DaemonUnreachable, isOurDaemon, readCurrentRun, sendCommand, writeCurrentRun } from '../src/daemon-client.ts';
import { writeReport } from '../src/report.ts';
import { CHROME_OFF_MESSAGE, findChromeEndpoint } from '../src/chrome.ts';
import { createScriptedClient, createTypeSafeClient, JevError, type JevAnswer, type JevClient } from '../src/jev-client.ts';
import { groupOrder, loadSuite, SuiteError } from '../src/scenarios.ts';
import { findLatestUnfinishedRun } from '../src/runs.ts';
import { outputRoot } from '../src/config.ts';

export const COMMANDS = ['start', 'daemon', 'run', 'resume', 'look', 'act', 'shot', 'step-done', 'giveup', 'skip', 'reopen', 'remaining', 'evidence', 'report', 'stop'] as const;
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
      // the daemon prints {"error": "..."} as its last line when it cannot start (e.g. Chrome refused)
      let reason = '';
      for (const line of (fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').trim().split('\n') : []).reverse()) {
        try {
          const err = JSON.parse(line).error;
          if (typeof err === 'string') { reason = err; break; }
        } catch { /* not JSON */ }
      }
      throw new Error(reason || `the run daemon could not start — see ${logFile}`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`the run daemon did not start within ${Math.round(ms / 1000)} s`);
}

async function start(positionals: string[], values: Record<string, unknown>): Promise<unknown> {
  const file = positionals[0];
  if (!file) throw new UsageError('usage: qa start <scenarios.yaml> --session <id> [--only <id,id>] [--continues <runDir>]');
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
  const only = typeof values.only === 'string' ? values.only.split(',').map((x) => x.trim()).filter(Boolean) : null;
  if (only) {
    const unknown = only.filter((id) => !suite.scenarios.some((s) => s.id === id));
    if (unknown.length) throw new Error(`unknown scenario id in --only: ${unknown.join(', ')}`);
    const keep = new Set(only);
    suite.scenarios = suite.scenarios.filter((s) => keep.has(s.id));
    const usedGroups = new Set(suite.scenarios.map((s) => s.group));
    suite.groups = suite.groups.filter((g) => usedGroups.has(g.id));
  }
  if (!findChromeEndpoint()) throw new Error(CHROME_OFF_MESSAGE);
  const continuesFrom = typeof values.continues === 'string' ? path.resolve(values.continues) : null;
  const runDir = createRunFolder(suite, typeof values.session === 'string' ? values.session : null, new Date(), process.env, continuesFrom);
  try {
    copyTestFiles(file, runDir);
    await spawnDaemon(runDir, chromeDeadlineMs());
  } catch (e) {
    // nothing has run (e.g. Allow was not clicked in time): leave no folder for "continue" to offer later
    fs.rmSync(runDir, { recursive: true, force: true });
    throw e;
  }
  return { runDir, scenarios: suite.scenarios.map((s) => s.id), groups: groupOrder(suite), judgeModel: suite.judgeModel };
}

const chromeDeadlineMs = () => Number(process.env.VISUAL_QA_DAEMON_START_TIMEOUT_MS ?? 110_000);

/** Keeps the test file and its checklist with the run, so a later chat can continue it. */
function copyTestFiles(file: string, runDir: string): void {
  fs.copyFileSync(file, path.join(runDir, 'tests.yaml'));
  const checklist = [file.replace(/\.ya?ml$/i, '') + '.checklist.txt', path.join(path.dirname(file), 'checklist.txt')].find((f) => fs.existsSync(f));
  if (checklist) fs.copyFileSync(checklist, path.join(runDir, 'checklist.txt'));
}

/** Starts the daemon on an existing run folder, waits until it is connected to Chrome, and records it as the current run. */
async function spawnDaemon(runDir: string, chromeDeadlineMs: number): Promise<void> {
  process.stderr.write('Click "Allow" in Chrome to let the QA run connect.\n');
  fs.rmSync(path.join(runDir, 'daemon.json'), { force: true }); // a reopened run has the old daemon's file
  const log = fs.openSync(path.join(runDir, 'daemon.log'), 'a');
  const child = spawn(process.execPath, [BIN, 'daemon', runDir], { detached: true, stdio: ['ignore', log, log], env: process.env });
  const state = { exited: false };
  child.on('exit', () => { state.exited = true; });
  child.unref();
  let d;
  try {
    d = await waitFor(path.join(runDir, 'daemon.json'), state, chromeDeadlineMs);
  } catch (e) {
    try { if (child.pid) process.kill(child.pid, 'SIGTERM'); } catch { /* already gone */ }
    // wait (briefly) until it is gone, so it cannot write into a run folder the caller removes
    for (let i = 0; i < 30 && !state.exited; i++) await new Promise((r) => setTimeout(r, 100));
    throw e;
  }
  writeCurrentRun({ runDir, port: d.port, token: d.token, pid: d.pid });
}

async function reopen(values: Record<string, unknown>): Promise<unknown> {
  const current = readCurrentRun();
  const wanted = typeof values['run-dir'] === 'string' ? path.resolve(values['run-dir']) : current?.runDir;
  if (!wanted) throw new Error('no run to reopen — pass the run folder: qa reopen --run-dir <dir>');
  if (current && isOurDaemon(current.pid)) {
    if (current.runDir === wanted) return { reopened: false, alive: true, runDir: wanted };
    throw new Error(`another run is active (pid ${current.pid}, ${current.runDir}) — finish it or run: qa stop`);
  }
  if (!fs.existsSync(path.join(wanted, 'run.json'))) throw new Error(`${wanted} is not a run folder (no run.json)`);
  if (current) clearCurrentRun(); // stale: the daemon is gone
  if (!findChromeEndpoint()) throw new Error(CHROME_OFF_MESSAGE);
  await spawnDaemon(wanted, chromeDeadlineMs());
  return { reopened: true, runDir: wanted };
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
      options: { session: { type: 'string' }, class: { type: 'string' }, reason: { type: 'string' }, only: { type: 'string' }, continues: { type: 'string' }, 'run-dir': { type: 'string' }, 'made-up': { type: 'boolean' } },
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
      case 'skip': {
        const id = needId(positionals, 'skip <id> --reason <text>');
        try {
          print(await sendCommand('skip', { id, reason: values.reason }));
        } catch (e) {
          // after a long pause the daemon may be gone: a skip opens nothing, so it needs no new Allow click
          const current = readCurrentRun();
          if (!(e instanceof DaemonUnreachable) || !current || isOurDaemon(current.pid)) throw e;
          print(skipWithoutDaemon(current.runDir, id, values.reason));
        }
        return 0;
      }
      case 'reopen':
        print(await reopen(values));
        return 0;
      case 'remaining':
        print(findLatestUnfinishedRun(outputRoot()) ?? { found: false });
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
