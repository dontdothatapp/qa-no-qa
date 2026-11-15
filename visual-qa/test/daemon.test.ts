import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { startDaemon, createRunFolder } from '../src/daemon.ts';
import { createScriptedClient } from '../src/jev-client.ts';
import { loadSuite } from '../src/scenarios.ts';
import { serveFixtures } from './fixtures/serve.ts';

const exec = promisify(execFile);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(ROOT, 'bin', 'qa.ts');
const TMP = path.join(ROOT, 'test', '.tmp');

let server: Awaited<ReturnType<typeof serveFixtures>>;
before(async () => { server = await serveFixtures(); fs.mkdirSync(TMP, { recursive: true }); });
after(async () => { await server.close(); });

function tmp(name: string): string {
  return fs.mkdtempSync(path.join(TMP, `${name}-`));
}

function suiteFile(dir: string): string {
  const file = path.join(dir, 'suite.yaml');
  fs.writeFileSync(file, `topic: Daemon test
base_url: ${server.url}/
scenarios:
  - id: S1
    title: Search works
    start: /search.html
    steps: ['Search for "espresso"']
    expected: Results list mentions espresso
  - id: S2
    title: Never started
    start: /thanks.html
    steps: [Look]
    expected: Thanks
`);
  return file;
}

async function cmd(d: { port: number; token: string }, name: string, args: Record<string, unknown> = {}, token = d.token) {
  const res = await fetch(`http://127.0.0.1:${d.port}/cmd`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ name, args }),
  });
  return { status: res.status, body: (await res.json()) as { ok: boolean; result?: any; error?: string } };
}

async function inProcess(answers: Parameters<typeof createScriptedClient>[0], extra: { takeoverBudget?: number } = {}) {
  const dir = tmp('daemon');
  const env = { ...process.env, VISUAL_QA_OUTPUT_DIR: dir };
  const runDir = createRunFolder(loadSuite(suiteFile(dir)), 'session-x', new Date(), env);
  const d = await startDaemon(runDir, { jev: createScriptedClient(answers), navTimeoutMs: 5000, actionTimeoutMs: 3000, settleMs: 50, ...extra });
  return { d, runDir };
}

test('run → handback → act ×2 → step-done completes the scenario', async () => {
  const { d, runDir } = await inProcess([{ operation: 'click', target: 1, opConfidence: 0.4 }]);
  try {
    const r = await cmd(d, 'run', { id: 'S1' });
    assert.equal(r.body.result.status, 'handback');
    assert.equal(r.body.result.reason, 'low_confidence');
    const look = await cmd(d, 'look', { id: 'S1' });
    assert.match(look.body.result.text, /\[1\] textbox "Search"/);
    assert.equal((await cmd(d, 'act', { id: 'S1', op: 'type', ref: 1, value: 'espresso' })).body.ok, true);
    assert.equal((await cmd(d, 'act', { id: 'S1', op: 'press_enter', ref: 1 })).body.ok, true);
    const done = await cmd(d, 'step-done', { id: 'S1' });
    assert.equal(done.body.result.status, 'completed');
    assert.equal(done.body.result.claudeActions, 2);
    const ev = await cmd(d, 'evidence', { id: 'S1' });
    assert.equal(ev.body.result.expected, 'Results list mentions espresso');
    assert.equal(ev.body.result.judgeOutputPath, path.join(runDir, 'scenarios', 'S1', 'judge.json'));
    assert.ok(fs.existsSync(ev.body.result.viewportShot));
    const run = JSON.parse(fs.readFileSync(path.join(runDir, 'run.json'), 'utf8'));
    assert.equal(run.scenarios.S1.status, 'completed');
    assert.equal(run.sessionId, 'session-x');
  } finally {
    await d.close();
  }
});

test('act beyond the takeover budget is refused', async () => {
  const { d } = await inProcess([{ operation: 'click', target: 1, opConfidence: 0.4 }], { takeoverBudget: 2 });
  try {
    await cmd(d, 'run', { id: 'S1' });
    assert.equal((await cmd(d, 'act', { id: 'S1', op: 'scroll' })).body.ok, true);
    assert.equal((await cmd(d, 'act', { id: 'S1', op: 'scroll' })).body.ok, true);
    const third = await cmd(d, 'act', { id: 'S1', op: 'scroll' });
    assert.equal(third.body.ok, false);
    assert.match(third.body.error ?? '', /takeover budget exceeded — give up/);
  } finally {
    await d.close();
  }
});

test('made-up values are remembered run-wide and listed for the scenario', async () => {
  const { d, runDir } = await inProcess([{ operation: 'click', target: 1, opConfidence: 0.4 }]);
  try {
    await cmd(d, 'run', { id: 'S1' });
    await cmd(d, 'act', { id: 'S1', op: 'type', ref: 1, value: 'qa test', madeUp: true });
    const run = JSON.parse(fs.readFileSync(path.join(runDir, 'run.json'), 'utf8'));
    assert.deepEqual(run.madeUpCache, { Search: 'qa test' });
    assert.deepEqual(run.scenarios.S1.madeUp, { Search: 'qa test' });
  } finally {
    await d.close();
  }
});

test('giveup on a never-started scenario records it without evidence', async () => {
  const { d, runDir } = await inProcess([]);
  try {
    const g = await cmd(d, 'giveup', { id: 'S2', class: 'tooling_or_environment', reason: 'Jev unavailable' });
    assert.equal(g.body.result.status, 'gave_up');
    const run = JSON.parse(fs.readFileSync(path.join(runDir, 'run.json'), 'utf8'));
    assert.deepEqual(run.scenarios.S2.gaveUp, { class: 'tooling_or_environment', reason: 'Jev unavailable' });
    assert.equal(run.scenarios.S2.evidence, null);
  } finally {
    await d.close();
  }
});

test('wrong token → 401', async () => {
  const { d } = await inProcess([]);
  try {
    assert.equal((await cmd(d, 'look', { id: 'S1' }, 'nope')).status, 401);
  } finally {
    await d.close();
  }
});

function cliEnv(stateDir: string, outDir: string, fakeJev: string) {
  return { ...process.env, VISUAL_QA_STATE_DIR: stateDir, VISUAL_QA_OUTPUT_DIR: outDir, VISUAL_QA_FAKE_JEV: fakeJev };
}

async function qa(args: string[], env: NodeJS.ProcessEnv) {
  try {
    const { stdout } = await exec(process.execPath, [BIN, ...args], { env, timeout: 60000 });
    return { code: 0, out: stdout };
  } catch (e) {
    const err = e as { code: number; stdout: string };
    return { code: err.code, out: err.stdout };
  }
}

test('CLI end-to-end: start, run, stop (fake Jev)', async () => {
  const dir = tmp('cli');
  const fake = path.join(dir, 'jev.json');
  fs.writeFileSync(fake, JSON.stringify([{ operation: 'type', target: 1 }, { operation: 'press_enter', target: 1 }, { operation: 'done' }]));
  const env = cliEnv(path.join(dir, 'state'), path.join(dir, 'out'), fake);
  const started = await qa(['start', suiteFile(dir), '--session', 'sid-1'], env);
  assert.equal(started.code, 0, started.out);
  const s = JSON.parse(started.out);
  assert.deepEqual(s.scenarios, ['S1', 'S2']);
  assert.equal(s.judgeModel, 'sonnet');
  const ran = JSON.parse((await qa(['run', 'S1'], env)).out);
  assert.equal(ran.status, 'completed');
  const stopped = await qa(['stop'], env);
  assert.equal(stopped.code, 0, stopped.out);
  assert.ok(!fs.existsSync(path.join(dir, 'state', 'current-run.json')));
});

test('qa start replaces a stale run but refuses a live one', async () => {
  const dir = tmp('stale');
  const stateDir = path.join(dir, 'state');
  fs.mkdirSync(stateDir, { recursive: true });
  const fake = path.join(dir, 'jev.json');
  fs.writeFileSync(fake, '[]');
  const env = cliEnv(stateDir, path.join(dir, 'out'), fake);
  const current = path.join(stateDir, 'current-run.json');

  fs.writeFileSync(current, JSON.stringify({ runDir: '/gone', port: 1, token: 't', pid: 999999 }));
  const ok = await qa(['start', suiteFile(dir), '--session', 'x'], env);
  assert.equal(ok.code, 0, ok.out);
  await qa(['stop'], env);

  fs.writeFileSync(current, JSON.stringify({ runDir: '/live', port: 1, token: 't', pid: process.pid }));
  const refused = await qa(['start', suiteFile(dir), '--session', 'x'], env);
  assert.notEqual(refused.code, 0);
  assert.match(refused.out, /qa stop/);
  fs.rmSync(current);
});

test('qa start reports a missing saved session with the login command', async () => {
  const dir = tmp('session');
  const file = path.join(dir, 'suite.yaml');
  fs.writeFileSync(file, `topic: T\nbase_url: ${server.url}/\nsession: staging-user\nscenarios:\n  - {id: A, title: a, start: /, steps: [x], expected: y}\n`);
  const env = cliEnv(path.join(dir, 'state'), path.join(dir, 'out'), path.join(dir, 'none.json'));
  const r = await qa(['start', file, '--session', 'x'], env);
  assert.notEqual(r.code, 0);
  assert.match(JSON.parse(r.out).error, /session "staging-user" not found — run: node .*bin\/qa\.ts login staging-user <url>/);
});
