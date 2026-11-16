import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { isAlive } from '../src/daemon-client.ts';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { startDaemon, createRunFolder } from '../src/daemon.ts';
import { createScriptedClient } from '../src/jev-client.ts';
import { loadSuite } from '../src/scenarios.ts';
import { connectChrome } from '../src/chrome.ts';
import { serveFixtures } from './fixtures/serve.ts';
import { launchStandInChrome } from './helpers.ts';

const exec = promisify(execFile);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(ROOT, 'bin', 'qa.ts');
const TMP = path.join(ROOT, 'test', '.tmp');

let server: Awaited<ReturnType<typeof serveFixtures>>;
let chrome: Awaited<ReturnType<typeof launchStandInChrome>>;
let chromeEnv: Record<string, string | undefined>;
before(async () => {
  server = await serveFixtures();
  chrome = await launchStandInChrome();
  chromeEnv = { ...process.env, VISUAL_QA_CHROME_ENDPOINT: chrome.endpoint };
  fs.mkdirSync(TMP, { recursive: true });
});
after(async () => { await chrome.close(); await server.close(); });

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
  - id: S3
    title: Form
    start: /form.html
    steps: [Fill the form]
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

async function inProcess(answers: Parameters<typeof createScriptedClient>[0], extra: Partial<Parameters<typeof startDaemon>[1]> = {}) {
  const dir = tmp('daemon');
  const env = { ...process.env, VISUAL_QA_OUTPUT_DIR: dir };
  const runDir = createRunFolder(loadSuite(suiteFile(dir)), 'session-x', new Date(), env);
  const d = await startDaemon(runDir, { jev: createScriptedClient(answers), navTimeoutMs: 5000, actionTimeoutMs: 3000, settleMs: 50, env: chromeEnv, ...extra });
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

test('report command writes report.html and results.json', async () => {
  const { d, runDir } = await inProcess([{ operation: 'type', target: 1 }, { operation: 'press_enter', target: 1 }, { operation: 'done' }]);
  try {
    await cmd(d, 'run', { id: 'S1' });
    fs.writeFileSync(path.join(runDir, 'scenarios', 'S1', 'judge.json'), JSON.stringify({
      keyPoints: [{ point: 'results mention espresso', status: 'met', evidence: 'Espresso machine', source: 'text' }], verdict: 'pass', reason: 'ok',
    }));
    const r = await cmd(d, 'report');
    assert.equal(r.body.ok, true, r.body.error ?? '');
    assert.equal(r.body.result.reportPath, path.join(runDir, 'report.html'));
    assert.equal(r.body.result.summary, '1 pass · 2 not run');
    assert.ok(fs.existsSync(path.join(runDir, 'results.json')));
    assert.match(fs.readFileSync(path.join(runDir, 'report.html'), 'utf8'), /data:image\/jpeg;base64,/);
  } finally {
    await d.close();
  }
});

test('stop and report answer while another command is stuck (I1)', async () => {
  const neverAnswers = { decide: () => new Promise<never>(() => {}) };
  const { d } = await inProcess([], { jev: neverAnswers });
  void cmd(d, 'run', { id: 'S1' }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1500));
  const t0 = Date.now();
  const rep = await cmd(d, 'report');
  assert.equal(rep.body.ok, true);
  const stop = await cmd(d, 'stop');
  assert.equal(stop.body.ok, true);
  assert.ok(Date.now() - t0 < 5000);
  await d.close();
});

test('an idle daemon stops itself (I8)', async () => {
  let stopped = false;
  const { d } = await inProcess([], { idleMs: 300, onStop: () => { stopped = true; } });
  await new Promise((r) => setTimeout(r, 1200));
  assert.equal(stopped, true);
  await assert.rejects(fetch(`http://127.0.0.1:${d.port}/cmd`, { method: 'POST' }));
});

test('Claude may not type into password fields or goto other hosts (I10)', async () => {
  const { d } = await inProcess([{ operation: 'blocked' }, { operation: 'blocked' }]);
  try {
    await cmd(d, 'run', { id: 'S3' });
    const look = await cmd(d, 'look', { id: 'S3' });
    const ref = Number(/\[(\d+)\] textbox "Password"/.exec(look.body.result.text)?.[1]);
    const pw = await cmd(d, 'act', { id: 'S3', op: 'type', ref, value: 'x' });
    assert.equal(pw.body.ok, false);
    assert.match(pw.body.error ?? '', /password field/);
    const away = await cmd(d, 'act', { id: 'S3', op: 'goto', value: 'https://example.com/' });
    assert.equal(away.body.ok, false);
    assert.match(away.body.error ?? '', /not in allow_hosts/);
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

test('giveup accepts no_matching_page', async () => {
  const { d, runDir } = await inProcess([]);
  try {
    await cmd(d, 'giveup', { id: 'S2', class: 'no_matching_page', reason: 'no listing in France' });
    const run = JSON.parse(fs.readFileSync(path.join(runDir, 'run.json'), 'utf8'));
    assert.deepEqual(run.scenarios.S2.gaveUp, { class: 'no_matching_page', reason: 'no listing in France' });
  } finally {
    await d.close();
  }
});

async function botChatDaemon() {
  const dir = tmp('daemon-bot');
  const file = path.join(dir, 'suite.yaml');
  fs.writeFileSync(file, `topic: Bot wall\nbase_url: ${server.url}/\nscenarios:\n  - {id: B1, title: Chat, start: /bot-chat.html, steps: ['Click "Send"', 'Wait for the reply'], expected: A reply}\n`);
  const env = { ...process.env, VISUAL_QA_OUTPUT_DIR: dir };
  const runDir = createRunFolder(loadSuite(file), 'session-x', new Date(), env);
  // Jev hands back straight away, so Claude drives
  const d = await startDaemon(runDir, { jev: createScriptedClient([{ operation: 'done', opConfidence: 0.3 }]), navTimeoutMs: 5000, actionTimeoutMs: 3000, settleMs: 50, env: chromeEnv });
  const r = await cmd(d, 'run', { id: 'B1' });
  assert.equal(r.body.result.status, 'handback');
  const look = (await cmd(d, 'look', { id: 'B1' })).body.result.text as string;
  const refOf = (name: string) => Number(look.match(new RegExp(`\\[(\\d+)\\] button "${name}"`))?.[1]);
  return { d, runDir, refOf };
}

test('a takeover click that hits the bot wall ends the scenario as blocked (act → gave_up)', async () => {
  const { d, runDir, refOf } = await botChatDaemon();
  try {
    const a = await cmd(d, 'act', { id: 'B1', op: 'click', ref: refOf('Send') });
    assert.equal(a.body.ok, true, JSON.stringify(a.body));
    assert.equal(a.body.result.status, 'gave_up');
    assert.match(a.body.result.gaveUp.reason, /^Blocked by the site's bot protection: POST .*\/api\/chat returned 403/);
    const run = JSON.parse(fs.readFileSync(path.join(runDir, 'run.json'), 'utf8'));
    assert.equal(run.scenarios.B1.status, 'gave_up');
    assert.equal(run.scenarios.B1.gaveUp.class, 'tooling_or_environment');
    assert.match(run.scenarios.B1.evidence.failedRequests[0], /^403 POST .*\/api\/chat — .*recaptcha/);
    assert.match((await cmd(d, 'act', { id: 'B1', op: 'click', ref: refOf('Send') })).body.error ?? '', /already gave_up/);
  } finally {
    await d.close();
  }
});

test('a block that arrives late shows in look, and a giveup records the block, not "app_problem"', async () => {
  const { d, runDir, refOf } = await botChatDaemon();
  try {
    const a = await cmd(d, 'act', { id: 'B1', op: 'click', ref: refOf('Send slowly') });
    assert.equal(a.body.result.claudeActions, 1, 'the slow reply has not arrived when act returns');
    await new Promise((r) => setTimeout(r, 2000));
    const look = (await cmd(d, 'look', { id: 'B1' })).body.result.text as string;
    assert.match(look, /Blocked by the site's bot protection: POST .*\/api\/slow-chat returned 403/);
    assert.match(look, /Failed requests to the site:\n403 POST .*\/api\/slow-chat/);
    const g = await cmd(d, 'giveup', { id: 'B1', class: 'app_problem', reason: 'Send does nothing' });
    assert.equal(g.body.result.status, 'gave_up');
    const run = JSON.parse(fs.readFileSync(path.join(runDir, 'run.json'), 'utf8'));
    assert.equal(run.scenarios.B1.gaveUp.class, 'tooling_or_environment');
    assert.match(run.scenarios.B1.gaveUp.reason, /bot protection/);
  } finally {
    await d.close();
  }
});

test('step-done after a block ends the scenario instead of moving on', async () => {
  const { d, refOf } = await botChatDaemon();
  try {
    await cmd(d, 'act', { id: 'B1', op: 'click', ref: refOf('Send slowly') });
    await new Promise((r) => setTimeout(r, 2000));
    const s = await cmd(d, 'step-done', { id: 'B1' });
    assert.equal(s.body.result.status, 'gave_up');
    assert.equal(s.body.result.step, 0, 'the step was not counted as done');
  } finally {
    await d.close();
  }
});

test('look lists ordinary failed requests without calling them a block', async () => {
  const { d, refOf } = await botChatDaemon();
  try {
    await cmd(d, 'act', { id: 'B1', op: 'click', ref: refOf('Ping') });
    const look = (await cmd(d, 'look', { id: 'B1' })).body.result.text as string;
    assert.match(look, /Failed requests to the site:\n500 POST .*\/api\/broken — \{"error":"database timeout"\}/);
    assert.doesNotMatch(look, /bot protection/);
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
  return { ...process.env, VISUAL_QA_STATE_DIR: stateDir, VISUAL_QA_OUTPUT_DIR: outDir, VISUAL_QA_FAKE_JEV: fakeJev, VISUAL_QA_CHROME_ENDPOINT: chrome.endpoint };
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
  assert.deepEqual(s.scenarios, ['S1', 'S2', 'S3']);
  assert.equal(s.judgeModel, 'sonnet');
  const ran = JSON.parse((await qa(['run', 'S1'], env)).out);
  assert.equal(ran.status, 'completed');
  const stopped = await qa(['stop'], env);
  assert.equal(stopped.code, 0, stopped.out);
  assert.ok(!fs.existsSync(path.join(dir, 'state', 'current-run.json')));
});

test('qa start replaces a stale run but refuses a live daemon', async () => {
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
  const refused = await qa(['start', suiteFile(dir), '--session', 'x'], env);
  assert.notEqual(refused.code, 0);
  assert.match(refused.out, /qa stop/);
  await qa(['stop'], env);
});

test('a reused PID is treated as stale and never signalled (I7)', async () => {
  const dir = tmp('pid');
  const stateDir = path.join(dir, 'state');
  fs.mkdirSync(stateDir, { recursive: true });
  const env = cliEnv(stateDir, path.join(dir, 'out'), path.join(dir, 'none.json'));
  const bystander = spawn('sleep', ['30']);
  try {
    fs.writeFileSync(path.join(stateDir, 'current-run.json'), JSON.stringify({ runDir: '/x', port: 1, token: 't', pid: bystander.pid }));
    const stopped = await qa(['stop'], env);
    assert.equal(stopped.code, 0, stopped.out);
    assert.equal(bystander.exitCode, null);
    assert.ok(isAlive(bystander.pid!));
  } finally {
    bystander.kill();
  }
});

test('a daemon that misses the start deadline is killed, not orphaned (I8)', async () => {
  const dir = tmp('slow');
  const fake = path.join(dir, 'jev.json');
  fs.writeFileSync(fake, '[]');
  const env = { ...cliEnv(path.join(dir, 'state'), path.join(dir, 'out'), fake), VISUAL_QA_DAEMON_START_TIMEOUT_MS: '1' };
  const r = await qa(['start', suiteFile(dir), '--session', 'x'], env);
  assert.notEqual(r.code, 0);
  await new Promise((res) => setTimeout(res, 3000));
  const ps = await exec('ps', ['-axo', 'command']);
  assert.ok(!ps.stdout.includes(path.join(dir, 'out')), 'no daemon left for this run');
});

test('qa report works without a live daemon (I9)', async () => {
  const dir = tmp('report');
  const fake = path.join(dir, 'jev.json');
  fs.writeFileSync(fake, JSON.stringify([{ operation: 'type', target: 1 }, { operation: 'press_enter', target: 1 }, { operation: 'done' }]));
  const env = cliEnv(path.join(dir, 'state'), path.join(dir, 'out'), fake);
  const s = JSON.parse((await qa(['start', suiteFile(dir), '--session', 'x'], env)).out);
  await qa(['run', 'S1'], env);
  const current = JSON.parse(fs.readFileSync(path.join(dir, 'state', 'current-run.json'), 'utf8'));
  process.kill(current.pid, 'SIGKILL');
  await new Promise((res) => setTimeout(res, 500));
  const r = await qa(['report'], env);
  assert.equal(r.code, 0, r.out);
  assert.equal(JSON.parse(r.out).reportPath, path.join(s.runDir, 'report.html'));
  await qa(['stop'], env);
  const again = await qa(['report', s.runDir], env);
  assert.equal(again.code, 0, again.out);
});

test('run on a logged_out scenario opens and closes its own context', async () => {
  const dir = tmp('logged-out');
  const file = path.join(dir, 'suite.yaml');
  fs.writeFileSync(file, `topic: Logged out\nbase_url: ${server.url}/\nscenarios:\n  - {id: L1, title: Thanks, start: /thanks.html, steps: [Look], expected: Thanks, logged_out: true}\n`);
  const user = await connectChrome(chrome.endpoint, 10_000);
  const pagesBefore = user.contexts()[0].pages().length;
  const contextsBefore = user.contexts().length;
  const env = { ...process.env, VISUAL_QA_OUTPUT_DIR: dir, VISUAL_QA_CHROME_ENDPOINT: chrome.endpoint };
  const runDir = createRunFolder(loadSuite(file), 's', new Date(), env);
  const d = await startDaemon(runDir, { jev: createScriptedClient([{ operation: 'done' }]), navTimeoutMs: 5000, actionTimeoutMs: 3000, settleMs: 50, env });
  try {
    const r = await cmd(d, 'run', { id: 'L1' });
    assert.equal(r.body.result.status, 'completed', JSON.stringify(r.body));
    assert.equal(user.contexts()[0].pages().length, pagesBefore, 'no tab left in the default context');
    assert.equal(user.contexts().length, contextsBefore, 'its own context is closed');
  } finally {
    await d.close();
    await user.close();
  }
});

async function reliesOnDaemon(answers: Parameters<typeof createScriptedClient>[0]) {
  const dir = tmp('daemon-relies');
  const file = path.join(dir, 'suite.yaml');
  fs.writeFileSync(file, `topic: Relies
base_url: ${server.url}/
scenarios:
  - id: R1
    title: Two steps
    start: /thanks.html
    steps: [One, Two]
    expected: Thanks
    relies_on:
      - {what: the first page is shown, after_step: 1}
      - {what: the last page is shown}
  - id: R2
    title: No checkpoint yet
    start: /thanks.html
    steps: [One, Two]
    expected: Thanks
    relies_on:
      - {what: the first page is shown, after_step: 1}
`);
  const env = { ...process.env, VISUAL_QA_OUTPUT_DIR: dir };
  const runDir = createRunFolder(loadSuite(file), 'session-x', new Date(), env);
  const d = await startDaemon(runDir, { jev: createScriptedClient(answers), navTimeoutMs: 5000, actionTimeoutMs: 3000, settleMs: 50, env: chromeEnv });
  return { d, runDir };
}

test('evidence lists relies_on files: checkpoint for after_step items, final page otherwise', async () => {
  const { d, runDir } = await reliesOnDaemon([{ operation: 'done' }, { operation: 'done' }]);
  try {
    assert.equal((await cmd(d, 'run', { id: 'R1' })).body.result.status, 'completed');
    const ev = (await cmd(d, 'evidence', { id: 'R1' })).body.result;
    assert.equal(ev.needsJudge, true);
    assert.equal(ev.scope, 'full');
    assert.equal(ev.expected, 'Thanks');
    assert.equal(ev.reliesOn.length, 2);
    assert.deepEqual(ev.reliesOn[0], {
      what: 'the first page is shown',
      viewportShot: path.join(runDir, 'scenarios', 'R1', 'checkpoint-1.jpg'),
      textFile: path.join(runDir, 'scenarios', 'R1', 'checkpoint-1.txt'),
    });
    assert.ok(fs.existsSync(ev.reliesOn[0].viewportShot));
    assert.equal(ev.reliesOn[1].viewportShot, ev.viewportShot);
    assert.equal(ev.reliesOn[1].textFile, ev.textFile);
    const run = JSON.parse(fs.readFileSync(path.join(runDir, 'run.json'), 'utf8'));
    assert.equal(run.scenarios.R1.checkpoints.length, 1);
  } finally {
    await d.close();
  }
});

test('evidence for an app_problem give-up with a checkpoint is relies_on_only; without one, needsJudge is false', async () => {
  const { d, runDir } = await reliesOnDaemon([{ operation: 'done' }, { operation: 'click', target: 1, opConfidence: 0.2 }]);
  try {
    const r1 = await cmd(d, 'run', { id: 'R1' });
    assert.equal(r1.body.result.status, 'handback');
    await cmd(d, 'giveup', { id: 'R1', class: 'app_problem', reason: 'the page is broken' });
    const ev = (await cmd(d, 'evidence', { id: 'R1' })).body.result;
    assert.equal(ev.needsJudge, true);
    assert.equal(ev.scope, 'relies_on_only');
    assert.equal(ev.expected, undefined);
    assert.equal(ev.reliesOn.length, 1);
    assert.equal(ev.reliesOn[0].what, 'the first page is shown');
    assert.ok(fs.existsSync(ev.reliesOn[0].viewportShot));

    await cmd(d, 'giveup', { id: 'R2', class: 'app_problem', reason: 'broken before any checkpoint' });
    const none = (await cmd(d, 'evidence', { id: 'R2' })).body;
    assert.equal(none.ok, true);
    assert.equal(none.result.needsJudge, false);
    assert.equal(none.result.scope, null);
    assert.ok(none.result.reason);
    const run = JSON.parse(fs.readFileSync(path.join(runDir, 'run.json'), 'utf8'));
    assert.deepEqual(run.scenarios.R2.checkpoints, []);
  } finally {
    await d.close();
  }
});

function groupedSuiteFile(dir: string): string {
  const file = path.join(dir, 'suite.yaml');
  fs.writeFileSync(file, `topic: Grouped
base_url: ${server.url}/
groups:
  - {id: g1, needs: Flag ON}
  - {id: g2, needs: Flag OFF}
scenarios:
  - {id: A, title: a, group: g1, start: /thanks.html, steps: [Look], expected: Thanks}
  - {id: B, title: b, group: g2, start: /thanks.html, steps: [Look], expected: Thanks}
  - {id: C, title: c, group: g1, start: /thanks.html, steps: [Look], expected: Thanks}
`);
  return file;
}

test('start lists groups in order and copies the test file and checklist into the run folder', async () => {
  const dir = tmp('start-groups');
  const fake = path.join(dir, 'jev.json');
  fs.writeFileSync(fake, '[]');
  const file = groupedSuiteFile(dir);
  fs.writeFileSync(path.join(dir, 'suite.checklist.txt'), '☐ the checklist\n');
  const env = cliEnv(path.join(dir, 'state'), path.join(dir, 'out'), fake);
  const started = await qa(['start', file, '--session', 'x'], env);
  assert.equal(started.code, 0, started.out);
  try {
    const out = JSON.parse(started.out);
    assert.deepEqual(out.groups, [
      { id: 'g1', needs: 'Flag ON', scenarios: ['A', 'C'] },
      { id: 'g2', needs: 'Flag OFF', scenarios: ['B'] },
    ]);
    assert.deepEqual(out.scenarios, ['A', 'B', 'C']);
    assert.equal(out.browser, undefined);
    assert.equal(out.note, undefined);
    assert.equal(fs.readFileSync(path.join(out.runDir, 'tests.yaml'), 'utf8'), fs.readFileSync(file, 'utf8'));
    assert.equal(fs.readFileSync(path.join(out.runDir, 'checklist.txt'), 'utf8'), '☐ the checklist\n');
  } finally {
    await qa(['stop'], env);
  }
});

test('start --only keeps those tests and drops empty groups; --continues is recorded', async () => {
  const dir = tmp('start-only');
  const fake = path.join(dir, 'jev.json');
  fs.writeFileSync(fake, '[]');
  const file = groupedSuiteFile(dir);
  const env = cliEnv(path.join(dir, 'state'), path.join(dir, 'out'), fake);
  const earlier = path.join(dir, 'earlier run');
  fs.mkdirSync(earlier);
  const started = await qa(['start', file, '--session', 'x', '--only', 'C,B', '--continues', earlier], env);
  assert.equal(started.code, 0, started.out);
  try {
    const out = JSON.parse(started.out);
    assert.deepEqual(out.scenarios, ['B', 'C']);
    assert.deepEqual(out.groups, [{ id: 'g1', needs: 'Flag ON', scenarios: ['C'] }, { id: 'g2', needs: 'Flag OFF', scenarios: ['B'] }]);
    assert.equal(JSON.parse(fs.readFileSync(path.join(out.runDir, 'run.json'), 'utf8')).continuesFrom, earlier);
    await qa(['stop'], env);
    const only = JSON.parse((await qa(['start', file, '--session', 'x', '--only', 'B'], env)).out);
    assert.deepEqual(only.groups, [{ id: 'g2', needs: 'Flag OFF', scenarios: ['B'] }]);
    assert.equal(JSON.parse(fs.readFileSync(path.join(only.runDir, 'run.json'), 'utf8')).continuesFrom, null);
    await qa(['stop'], env);
    const bad = await qa(['start', file, '--session', 'x', '--only', 'B,Z'], env);
    assert.notEqual(bad.code, 0);
    assert.match(bad.out, /unknown scenario id.*Z/);
  } finally {
    await qa(['stop'], env);
  }
});

test('skip marks a never-started test skipped; skipping a started test is refused', async () => {
  const { d, runDir } = await inProcess([{ operation: 'done' }]);
  try {
    assert.equal((await cmd(d, 'run', { id: 'S1' })).body.result.status, 'completed');
    const refused = await cmd(d, 'skip', { id: 'S1', reason: 'not needed' });
    assert.equal(refused.body.ok, false);
    assert.equal(refused.body.error, 'scenario S1 already started');
    const noReason = await cmd(d, 'skip', { id: 'S2' });
    assert.equal(noReason.body.ok, false);
    assert.match(noReason.body.error ?? '', /--reason/);
    const ok = await cmd(d, 'skip', { id: 'S2', reason: 'flag is off' });
    assert.equal(ok.body.ok, true, JSON.stringify(ok.body));
    assert.equal(ok.body.result.status, 'skipped');
    const run = JSON.parse(fs.readFileSync(path.join(runDir, 'run.json'), 'utf8'));
    assert.equal(run.scenarios.S2.status, 'skipped');
    assert.equal(run.scenarios.S2.skipReason, 'flag is off');
    assert.equal((await cmd(d, 'skip', { id: 'S2', reason: 'again' })).body.error, 'scenario S2 already started');
  } finally {
    await d.close();
  }
});

test('after the daemon stops, run says to reopen; reopen reconnects and does not re-run finished tests', async () => {
  const dir = tmp('reopen');
  const fake = path.join(dir, 'jev.json');
  fs.writeFileSync(fake, JSON.stringify([{ operation: 'done' }, { operation: 'done' }]));
  const env = cliEnv(path.join(dir, 'state'), path.join(dir, 'out'), fake);
  const s = JSON.parse((await qa(['start', suiteFile(dir), '--session', 'x'], env)).out);
  try {
    assert.equal(JSON.parse((await qa(['run', 'S1'], env)).out).status, 'completed');
    const alive = JSON.parse((await qa(['reopen'], env)).out);
    assert.deepEqual(alive, { reopened: false, alive: true, runDir: s.runDir });
    const current = JSON.parse(fs.readFileSync(path.join(dir, 'state', 'current-run.json'), 'utf8'));
    process.kill(current.pid, 'SIGKILL');
    await new Promise((res) => setTimeout(res, 500));
    const down = await qa(['run', 'S2'], env);
    assert.notEqual(down.code, 0);
    assert.match(JSON.parse(down.out).error, /qa reopen/);
    const re = await qa(['reopen'], env);
    assert.equal(re.code, 0, re.out);
    assert.deepEqual(JSON.parse(re.out), { reopened: true, runDir: s.runDir });
    const starts = () => fs.readFileSync(path.join(s.runDir, 'events.jsonl'), 'utf8').split('\n').filter((l) => l.includes('"scenario_start"') && l.includes('"S1"')).length;
    const before = starts();
    const again = JSON.parse((await qa(['run', 'S1'], env)).out);
    assert.equal(again.status, 'completed');
    assert.equal(again.id, 'S1');
    assert.equal(starts(), before, 'no new scenario_start for S1');
    const second = await qa(['run', 'S2'], env);
    assert.equal(second.code, 0, second.out);
    assert.equal(JSON.parse(second.out).status, 'completed');
  } finally {
    await qa(['stop'], env);
  }
});
