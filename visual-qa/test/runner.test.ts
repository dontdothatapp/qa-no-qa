import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openScenario, runJev, type ScenarioState } from '../src/scenario-runner.ts';
import { openEventLog } from '../src/events.ts';
import { createScriptedClient, JevError, type JevAnswer } from '../src/jev-client.ts';
import { takeSnapshot } from '../src/snapshot.ts';
import type { Scenario, Suite } from '../src/types.ts';
import { useBrowserAndFixtures } from './helpers.ts';

const fx = useBrowserAndFixtures();
const FAST = { navTimeoutMs: 3000, actionTimeoutMs: 3000, settleMs: 50 };

function scenario(p: Partial<Scenario>): Scenario {
  return { id: 'S1', title: 't', session: null, start: '/index.html', steps: ['step'], values: {}, expected: 'e', ...p };
}

function suiteFor(s: Scenario): Suite {
  return { topic: 'T', baseUrl: fx.baseUrl() + '/', viewport: { width: 1280, height: 800 }, allowHosts: [new URL(fx.baseUrl()).host], judgeModel: 'sonnet', scenarios: [s], sourcePath: '/x.yaml' };
}

async function start(s: Scenario): Promise<{ state: ScenarioState; runDir: string }> {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vqa-run-'));
  const state = await openScenario(fx.browser(), suiteFor(s), s, null, {}, FAST);
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
  assert.deepEqual(result.missingFields, ['Name', 'Email', 'Postcode', 'Password']);
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

test('typing a password from values logs the source, never the value', async () => {
  const { state, runDir } = await start(scenario({ start: '/form.html', steps: ['Fill the password'], values: { Password: 'hunter2' } }));
  const ref = await refOf(state, 'Password');
  const { result } = await run(state, runDir, [{ operation: 'type', target: ref }, { operation: 'done' }]);
  assert.equal(result.status, 'completed');
  const log = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8');
  assert.match(log, /"valueSource":"scenario"/);
  assert.ok(!log.includes('hunter2'));
});

test('jev_decision events carry usage', async () => {
  const { state, runDir } = await start(scenario({ start: '/thanks.html' }));
  const { events } = await run(state, runDir, [{ operation: 'done', usage: { inputTokens: 555, outputTokens: 95 } }]);
  const d = events.read().find((e) => e.type === 'jev_decision');
  assert.deepEqual(d?.usage, { inputTokens: 555, outputTokens: 95 });
  assert.equal(d?.id, 'S1');
});
