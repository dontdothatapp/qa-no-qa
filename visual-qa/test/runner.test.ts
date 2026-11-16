import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openLoggedOutScenario, runJev, type ScenarioState } from '../src/scenario-runner.ts';
import { openEventLog } from '../src/events.ts';
import { performAction } from '../src/actions.ts';
import { createScriptedClient, JevError, type JevAnswer } from '../src/jev-client.ts';
import { takeSnapshot } from '../src/snapshot.ts';
import type { Scenario, Suite } from '../src/types.ts';
import { useBrowserAndFixtures } from './helpers.ts';

const fx = useBrowserAndFixtures();
const FAST = { navTimeoutMs: 3000, actionTimeoutMs: 3000, settleMs: 50 };

function scenario(p: Partial<Scenario>): Scenario {
  return { id: 'S1', title: 't', start: '/index.html', steps: ['step'], values: {}, expected: 'e', group: null, source: null, reliesOn: [], loggedOut: true, ...p };
}

function suiteFor(s: Scenario, allowHosts?: string[]): Suite {
  return { topic: 'T', baseUrl: fx.baseUrl() + '/', viewport: { width: 1280, height: 800 }, allowHosts: allowHosts ?? [new URL(fx.baseUrl()).host], judgeModel: 'sonnet', notes: null, groups: [], scenarios: [s], sourcePath: '/x.yaml' };
}

async function start(s: Scenario, allowHosts?: string[]): Promise<{ state: ScenarioState; runDir: string }> {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vqa-run-'));
  const state = await openLoggedOutScenario(fx.browser(), suiteFor(s, allowHosts), s, {}, FAST);
  return { state, runDir };
}

async function refOf(state: ScenarioState, name: string): Promise<number> {
  const snap = await takeSnapshot(state.page, { frames: false, maxTextChars: 100 });
  const c = snap.controls.find((x) => x.name === name);
  assert.ok(c, `control "${name}" exists`);
  return c.ref;
}

async function run(state: ScenarioState, runDir: string, answers: Array<Partial<JevAnswer> | JevError>) {
  const events = openEventLog(path.join(runDir, 'events.jsonl'));
  const result = await runJev(state, { jev: createScriptedClient(answers), events, runDir, ...FAST });
  return { result, events };
}

test('happy path: type, press Enter, done → completed with evidence', async () => {
  const { state, runDir } = await start(scenario({ start: '/search.html', steps: ['Search for "espresso"'] }));
  const { result } = await run(state, runDir, [{ operation: 'type', target: 1 }, { operation: 'press_enter', target: 1 }, { operation: 'done' }]);
  assert.equal(result.status, 'completed');
  assert.equal(result.jevActions, 2);
  const ev = state.evidence;
  assert.ok(ev);
  assert.ok(fs.existsSync(ev.viewportShot) && fs.existsSync(ev.fullPageShot));
  assert.match(fs.readFileSync(ev.textFile, 'utf8'), /Espresso — strong Italian coffee/);
  assert.equal(ev.httpStatus, 200);
});

test('press_enter without a target goes to the last typed field', async () => {
  const { state, runDir } = await start(scenario({ start: '/search.html', steps: ['Search for "espresso"'] }));
  const { result } = await run(state, runDir, [{ operation: 'type', target: 1 }, { operation: 'press_enter', target: null, targetConfidence: 0.06 }, { operation: 'done' }]);
  assert.equal(result.status, 'completed');
  assert.match(fs.readFileSync(state.evidence!.textFile, 'utf8'), /Espresso machine/);
});

test('low confidence → hand back, browser still usable', async () => {
  const { state, runDir } = await start(scenario({ start: '/shop.html' }));
  const { result } = await run(state, runDir, [{ operation: 'click', target: 1, opConfidence: 0.4 }]);
  assert.equal(result.status, 'handback');
  assert.equal(result.reason, 'low_confidence');
  assert.equal(result.stepText, 'step');
  assert.equal(await state.page.title(), 'Shop');
});

test('needs_text lists every empty field without a value', async () => {
  const { state, runDir } = await start(scenario({ start: '/form.html', steps: ['Fill the form'] }));
  const { result } = await run(state, runDir, [{ operation: 'type', target: 2 }]);
  assert.equal(result.reason, 'needs_text');
  assert.deepEqual(result.missingFields, ['Name', 'Email', 'Postcode']);
});

test('a new tab → new_tab', async () => {
  const { state, runDir } = await start(scenario({ start: '/popup.html' }));
  const { result } = await run(state, runDir, [{ operation: 'click', target: 1 }]);
  assert.equal(result.reason, 'new_tab');
});

test('leaving the allowed hosts → left_allowed_hosts', async () => {
  const { state, runDir } = await start(scenario({ start: '/index.html' }));
  const ref = await refOf(state, 'Other host');
  const { result } = await run(state, runDir, [{ operation: 'click', target: ref }]);
  assert.equal(result.reason, 'left_allowed_hosts');
});

test('a hanging navigation → error hand-back, and the next scenario still completes', async () => {
  const { state, runDir } = await start(scenario({ start: '/index.html' }));
  const ref = await refOf(state, 'Slow page');
  const { result } = await run(state, runDir, [{ operation: 'click', target: ref }]);
  assert.equal(result.status, 'handback');
  assert.equal(result.reason, 'error');
  const second = await start(scenario({ id: 'S2', start: '/thanks.html' }));
  const r2 = await run(second.state, second.runDir, [{ operation: 'done' }]);
  assert.equal(r2.result.status, 'completed');
});

test('Jev auth failure → jev_unavailable', async () => {
  const { state, runDir } = await start(scenario({ start: '/thanks.html' }));
  const { result } = await run(state, runDir, [new JevError('bad key', 'fatal')]);
  assert.equal(result.reason, 'jev_unavailable');
});

test('password fields are never typed into, even when a value matches', async () => {
  const { state, runDir } = await start(scenario({ start: '/form.html', steps: ['Fill the password'], values: { Password: 'hunter2' } }));
  const ref = await refOf(state, 'Password');
  const { result } = await run(state, runDir, [{ operation: 'type', target: ref }]);
  assert.equal(result.status, 'handback');
  assert.equal(result.reason, 'needs_text');
  assert.match(result.detail ?? '', /password fields are never filled/);
  assert.equal(await state.page.inputValue('#pw'), '');
  assert.ok(!fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8').includes('hunter2'));
});

test('jev_decision events carry usage', async () => {
  const { state, runDir } = await start(scenario({ start: '/thanks.html' }));
  const { events } = await run(state, runDir, [{ operation: 'done', usage: { inputTokens: 555, outputTokens: 95 } }]);
  const d = events.read().find((e) => e.type === 'jev_decision');
  assert.deepEqual(d?.usage, { inputTokens: 555, outputTokens: 95 });
  assert.equal(d?.id, 'S1');
});

test('a start page that redirects off-host hands back before Jev acts (M5)', async () => {
  const { state, runDir } = await start(scenario({ start: '/redirect-away.html' }));
  await state.page.waitForURL(/thanks/, { timeout: 5000 });
  const jev = createScriptedClient([{ operation: 'click', target: 1 }]);
  const result = await runJev(state, { jev, events: openEventLog(path.join(runDir, 'events.jsonl')), runDir, ...FAST });
  assert.equal(result.reason, 'left_allowed_hosts');
  assert.equal(jev.requests.length, 0);
});

test('allow_hosts entries without a port match the hostname (M5)', async () => {
  const { state, runDir } = await start(scenario({ start: '/thanks.html' }), ['127.0.0.1']);
  const { result } = await run(state, runDir, [{ operation: 'done' }]);
  assert.equal(result.status, 'completed');
});

test('a page whose main thread is stuck → error hand-back, not a hang (I1)', async () => {
  const { state, runDir } = await start(scenario({ start: '/spin.html' }));
  await new Promise((r) => setTimeout(r, 600));
  const t0 = Date.now();
  const { result } = await run(state, runDir, [{ operation: 'done' }]);
  assert.equal(result.reason, 'error');
  assert.match(result.detail ?? '', /not responding/);
  assert.ok(Date.now() - t0 < 15000);
  await state.context.close();
});

test('a crashed page → error hand-back, not an exception (I2)', async () => {
  const { state, runDir } = await start(scenario({ start: '/thanks.html' }));
  await state.page.goto('chrome://crash').catch(() => {});
  const { result } = await run(state, runDir, [{ operation: 'done' }]);
  assert.equal(result.status, 'handback');
  assert.equal(result.reason, 'error');
});

test('after a failed start page, Jev can resume once Claude fixed it (I3)', async () => {
  const { state, runDir } = await start(scenario({ start: '/hang' }));
  const first = await run(state, runDir, []);
  assert.equal(first.result.reason, 'error');
  await state.page.goto(`${fx.baseUrl()}/thanks.html`);
  const second = await run(state, runDir, [{ operation: 'done' }]);
  assert.equal(second.result.status, 'completed');
});

test('after a new_tab hand-back, resume does not loop on the same flag (M1)', async () => {
  const { state, runDir } = await start(scenario({ start: '/popup.html' }));
  const first = await run(state, runDir, [{ operation: 'click', target: 1 }]);
  assert.equal(first.result.reason, 'new_tab');
  const second = await run(state, runDir, [{ operation: 'done' }]);
  assert.equal(second.result.status, 'completed');
});

test('upload paths in a scenario are relative to the scenario file, so suites work on any machine', async () => {
  const s = scenario({ start: '/upload.html', steps: ['Upload the attachment'] });
  const suite = { ...suiteFor(s), sourcePath: path.join(import.meta.dirname, 'fixtures', 'suite.yaml') };
  const state = await openLoggedOutScenario(fx.browser(), suite, s, {}, FAST);
  const snap = await takeSnapshot(state.page, { frames: false, maxTextChars: 100 });
  const input = snap.controls.find((c) => c.name === 'Attachment');
  assert.ok(input, 'file input exists');
  const res = await performAction(state, snap, { op: 'upload', ref: input.ref, value: 'site/sample.txt' }, FAST);
  assert.deepEqual(res, { ok: true });
  assert.equal(await state.page.textContent('#chosen'), 'Chosen: sample.txt');
});

test('the site refusing a request with a reCAPTCHA 403 ends the scenario as blocked, not as a hand-back', async () => {
  const { state, runDir } = await start(scenario({ start: '/bot-chat.html', steps: ['Click "Send"', 'Wait for the reply'] }));
  const send = await refOf(state, 'Send');
  const { result, events } = await run(state, runDir, [{ operation: 'click', target: send }, { operation: 'done' }, { operation: 'done' }]);
  assert.equal(result.status, 'gave_up');
  assert.equal(result.gaveUp?.class, 'tooling_or_environment');
  assert.match(result.gaveUp?.reason ?? '', /^Blocked by the site's bot protection: POST 127\.0\.0\.1:\d+\/api\/chat returned 403 ".*recaptcha check unsuccessful/);
  assert.doesNotMatch(result.gaveUp?.reason ?? '', /SECRET123/, 'query strings are never recorded');
  assert.equal(state.status, 'gave_up');
  assert.ok(state.evidence && fs.existsSync(state.evidence.viewportShot), 'evidence is captured for the report');
  const logged = events.read();
  assert.ok(logged.some((e) => e.type === 'giveup' && e.actor === 'runner' && e.class === 'tooling_or_environment'));
  assert.ok(!logged.some((e) => e.type === 'jev_decision' && e.step === 1), 'Jev is not asked again after the block');
});

test('ordinary failed requests are recorded as evidence but do not stop the scenario', async () => {
  const { state, runDir } = await start(scenario({ start: '/bot-chat.html', steps: ['Click "Ping"'] }));
  const ping = await refOf(state, 'Ping');
  const { result } = await run(state, runDir, [{ operation: 'click', target: ping }, { operation: 'done' }]);
  assert.equal(result.status, 'completed');
  assert.deepEqual(state.evidence?.failedRequests, [`500 POST ${new URL(fx.baseUrl()).host}/api/broken — {"error":"database timeout"}`]);
});
