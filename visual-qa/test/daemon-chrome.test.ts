import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { startDaemon, createRunFolder } from '../src/daemon.ts';
import { connectChrome, CHROME_OFF_MESSAGE } from '../src/chrome.ts';
import { createScriptedClient } from '../src/jev-client.ts';
import { loadSuite } from '../src/scenarios.ts';
import { serveFixtures } from './fixtures/serve.ts';
import { launchStandInChrome } from './helpers.ts';

const exec = promisify(execFile);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(ROOT, 'bin', 'qa.ts');
const TMP = path.join(ROOT, 'test', '.tmp');

let server: Awaited<ReturnType<typeof serveFixtures>>;
before(async () => { server = await serveFixtures(); fs.mkdirSync(TMP, { recursive: true }); });
after(async () => { await server.close(); });

const tmp = (n: string) => fs.mkdtempSync(path.join(TMP, `${n}-`));
function suiteFile(dir: string, extra = ''): string {
  const file = path.join(dir, 'suite.yaml');
  fs.writeFileSync(file, `topic: Chrome test
base_url: ${server.url}/
${extra}scenarios:
  - id: S1
    title: Search
    start: /search.html
    steps: ['Search for "espresso"']
    expected: Results mention espresso
  - id: S2
    title: Thanks
    start: /thanks.html
    steps: [Look]
    expected: Thanks
`);
  return file;
}

async function cmd(d: { port: number; token: string }, name: string, args: Record<string, unknown> = {}) {
  const res = await fetch(`http://127.0.0.1:${d.port}/cmd`, {
    method: 'POST', headers: { authorization: `Bearer ${d.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ name, args }),
  });
  return (await res.json()) as { ok: boolean; result?: any; error?: string };
}

const SEARCH = [{ operation: 'type' as const, target: 1 }, { operation: 'press_enter' as const, target: 1 }, { operation: 'done' as const }];

test('chrome mode runs in the user browser and never closes it or the user tab', async () => {
  const chrome = await launchStandInChrome();
  const user = await connectChrome(chrome.endpoint, 10_000);
  const userTab = await user.contexts()[0].newPage();
  let tabsOpenedInUserChrome = 0;
  user.contexts()[0].on('page', () => { tabsOpenedInUserChrome++; });
  try {
    const dir = tmp('chrome-run');
    const env = { ...process.env, VISUAL_QA_OUTPUT_DIR: dir, VISUAL_QA_CHROME_ENDPOINT: chrome.endpoint };
    const runDir = createRunFolder(loadSuite(suiteFile(dir)), 's', new Date(), env);
    const d = await startDaemon(runDir, { jev: createScriptedClient(SEARCH), env, settleMs: 50 });
    const r = await cmd(d, 'run', { id: 'S1' });
    assert.equal(r.result.status, 'completed', JSON.stringify(r));
    assert.ok(tabsOpenedInUserChrome >= 1, 'the scenario ran as a tab in the user Chrome');
    assert.equal((await cmd(d, 'stop')).ok, true);
    await d.close();
    await new Promise((res) => setTimeout(res, 300));
    assert.equal(chrome.launched.isConnected(), true, 'Chrome keeps running');
    assert.equal(userTab.isClosed(), false, 'the user tab is untouched');
    assert.equal(user.contexts()[0].pages().length, 1, 'only the user tab is left');
  } finally {
    await user.close();
    await chrome.close();
  }
});

test('Chrome closing mid-run → clear error, and the report still works', async () => {
  const chrome = await launchStandInChrome();
  const dir = tmp('chrome-gone');
  const env = { ...process.env, VISUAL_QA_OUTPUT_DIR: dir, VISUAL_QA_CHROME_ENDPOINT: chrome.endpoint };
  const runDir = createRunFolder(loadSuite(suiteFile(dir)), 's', new Date(), env);
  const d = await startDaemon(runDir, { jev: createScriptedClient(SEARCH), env, settleMs: 50 });
  try {
    assert.equal((await cmd(d, 'run', { id: 'S1' })).result.status, 'completed');
    await chrome.close();
    await new Promise((res) => setTimeout(res, 500));
    const r = await cmd(d, 'run', { id: 'S2' });
    assert.equal(r.ok, false);
    assert.match(r.error ?? '', /connection to the browser was lost/);
    const sd = await cmd(d, 'step-done', { id: 'S1' });
    assert.match(sd.error ?? '', /connection to the browser was lost/, 'step-done refuses before changing state (M8)');
    const rep = await cmd(d, 'report');
    assert.equal(rep.ok, true);
  } finally {
    await d.close();
  }
});

async function qa(args: string[], env: NodeJS.ProcessEnv) {
  try {
    const { stdout } = await exec(process.execPath, [BIN, ...args], { env, timeout: 60000 });
    return { code: 0, out: stdout };
  } catch (e) {
    const err = e as { code: number; stdout: string };
    return { code: err.code, out: err.stdout };
  }
}

test('qa start with remote debugging off fails with the fix, leaving no daemon', async () => {
  const dir = tmp('chrome-off');
  const env = { ...process.env, VISUAL_QA_STATE_DIR: path.join(dir, 'state'), VISUAL_QA_OUTPUT_DIR: path.join(dir, 'out'), VISUAL_QA_CHROME_DATA_DIR: dir, VISUAL_QA_CHROME_ENDPOINT: '' };
  const r = await qa(['start', suiteFile(dir), '--session', 'x'], env);
  assert.notEqual(r.code, 0);
  assert.equal(JSON.parse(r.out).error, CHROME_OFF_MESSAGE);
  const ps = await exec('ps', ['-axo', 'command']);
  assert.ok(!ps.stdout.includes(path.join(dir, 'out')));
});
