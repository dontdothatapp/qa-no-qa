import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Browser, BrowserContext, Page } from 'playwright';
import { connectChrome } from '../src/chrome.ts';
import { openScenarioInContext, openLoggedOutScenario, closeScenario, runJev, markStepDone } from '../src/scenario-runner.ts';
import { performAction } from '../src/actions.ts';
import { openEventLog } from '../src/events.ts';
import { createScriptedClient, type JevClient } from '../src/jev-client.ts';
import type { Scenario, Suite } from '../src/types.ts';
import { serveFixtures } from './fixtures/serve.ts';
import { launchStandInChrome } from './helpers.ts';

const FAST = { navTimeoutMs: 5000, actionTimeoutMs: 3000, settleMs: 50 };
let chrome: Awaited<ReturnType<typeof launchStandInChrome>>;
let server: Awaited<ReturnType<typeof serveFixtures>>;
let browser: Browser;
let ctx: BrowserContext;
let userTab: Page;

before(async () => {
  server = await serveFixtures();
  chrome = await launchStandInChrome();
  browser = await connectChrome(chrome.endpoint, 10_000);
  ctx = browser.contexts()[0];
  userTab = await ctx.newPage(); // the user's own tab, open before the run
  await userTab.goto(`${server.url}/index.html`);
});
after(async () => {
  await browser.close();
  await chrome.close();
  await server.close();
});

const scenario = (p: Partial<Scenario>): Scenario => ({ id: 'C1', title: 't', start: '/thanks.html', steps: ['step'], values: {}, expected: 'e', group: null, source: null, reliesOn: [], loggedOut: false, ...p });
const suite = (s: Scenario): Suite => ({
  topic: 'T', baseUrl: server.url + '/', viewport: { width: 1280, height: 800 },
  allowHosts: [new URL(server.url).host], judgeModel: 'sonnet', notes: null, groups: [], scenarios: [s], sourcePath: '/x.yaml',
});
const deps = (jev: JevClient) => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vqa-chrome-run-'));
  return { jev, events: openEventLog(path.join(runDir, 'events.jsonl')), runDir, ...FAST };
};

test('a scenario runs in its own tab at the suite viewport; closing leaves the user tab alone', async () => {
  const startTabs = ctx.pages().length;
  const s = scenario({});
  const state = await openScenarioInContext(ctx, suite(s), s, {}, FAST);
  assert.equal(ctx.pages().length, startTabs + 1);
  assert.deepEqual(await state.page.evaluate(() => [window.innerWidth, window.innerHeight]), [1280, 800]);
  const r = await runJev(state, deps(createScriptedClient([{ operation: 'done' }])));
  assert.equal(r.status, 'completed');
  await closeScenario(state);
  assert.equal(ctx.pages().length, startTabs);
  assert.equal(userTab.isClosed(), false);
});

test('a tab the user opens mid-run does not cause a new_tab hand-back', async () => {
  const s = scenario({});
  const state = await openScenarioInContext(ctx, suite(s), s, {}, FAST);
  let userOpened: Page | null = null;
  const jev: JevClient = {
    async decide() {
      userOpened = await ctx.newPage();
      await new Promise((res) => setTimeout(res, 200));
      return { operation: 'done', opConfidence: 1, opProbabilities: {}, target: null, targetConfidence: 1, usage: { inputTokens: 1, outputTokens: 1 }, latencyMs: 1 };
    },
  };
  const r = await runJev(state, deps(jev));
  assert.equal(r.status, 'completed');
  await closeScenario(state);
  assert.equal((userOpened as Page | null)?.isClosed(), false, 'the user tab is not ours to close');
  await (userOpened as Page | null)?.close();
});

test('a popup from the scenario tab is a new_tab hand-back, and switch_tab only sees our tabs', async () => {
  const s = scenario({ start: '/popup.html' });
  const state = await openScenarioInContext(ctx, suite(s), s, {}, FAST);
  const r = await runJev(state, deps(createScriptedClient([{ operation: 'click', target: 1 }])));
  assert.equal(r.reason, 'new_tab');
  assert.equal(state.ownPages.length, 2);
  const res = await performAction(state, state.lastSnapshot!, { op: 'switch_tab', value: '1' }, FAST);
  assert.equal(res.ok, true);
  assert.match(state.page.url(), /thanks\.html/);
  const bad = await performAction(state, state.lastSnapshot!, { op: 'switch_tab', value: '2' }, FAST);
  assert.equal(bad.ok, false, 'the user tab is not reachable');
  const before = ctx.pages().length;
  await closeScenario(state);
  assert.equal(ctx.pages().length, before - 2);
  assert.equal(userTab.isClosed(), false);
});

test('a logged-out test gets its own context with no cookies, and closing it leaves the user\'s tabs alone', async () => {
  await ctx.addCookies([{ name: 'sid', value: 'user', url: server.url }]);
  const s = scenario({ loggedOut: true });
  const state = await openLoggedOutScenario(browser, suite(s), s, {}, FAST);
  try {
    assert.equal((await state.context.cookies()).length, 0);
    assert.notEqual(state.context, ctx);
    assert.equal(state.ownsContext, true);
  } finally {
    await closeScenario(state);
    await ctx.clearCookies();
  }
  assert.equal(userTab.isClosed(), false);
  assert.ok(ctx.pages().includes(userTab));
});

test('closing the logged-out window mid-test hands back with error', async () => {
  const s = scenario({ loggedOut: true });
  const state = await openLoggedOutScenario(browser, suite(s), s, {}, FAST);
  await state.context.close();
  const r = await runJev(state, deps(createScriptedClient([{ operation: 'done' }])));
  assert.equal(r.status, 'handback');
  assert.equal(r.reason, 'error');
});

test('a relies_on item with after_step 1 gets a checkpoint after step 1', async () => {
  const s = scenario({ steps: ['one', 'two'], reliesOn: [{ what: 'x', afterStep: 1 }] });
  const state = await openScenarioInContext(ctx, suite(s), s, {}, FAST);
  const d = deps(createScriptedClient([{ operation: 'done' }, { operation: 'done' }]));
  const r = await runJev(state, d);
  assert.equal(r.status, 'completed');
  assert.equal(state.checkpoints.length, 1);
  assert.equal(state.checkpoints[0].step, 1);
  assert.ok(fs.existsSync(state.checkpoints[0].viewportShot));
  assert.ok(fs.existsSync(state.checkpoints[0].textFile));
  assert.equal(path.basename(state.checkpoints[0].textFile), 'checkpoint-1.txt');
  await closeScenario(state);
});

test('a failed checkpoint capture does not stop the step', async () => {
  const s = scenario({ steps: ['one', 'two'], reliesOn: [{ what: 'x', afterStep: 1 }] });
  const state = await openScenarioInContext(ctx, suite(s), s, {}, FAST);
  const d = deps(createScriptedClient([]));
  await markStepDone(state, d.events, d.runDir, 'claude', async () => { throw new Error('boom'); });
  assert.equal(state.currentStep, 1);
  assert.equal(state.checkpoints.length, 0);
  const failed = d.events.read().find((e) => e.type === 'checkpoint_failed');
  assert.equal(failed?.step, 1);
  assert.equal(failed?.error, 'boom');
  await closeScenario(state);
});
