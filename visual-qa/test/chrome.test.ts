import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findChromeEndpoint, connectChrome, CHROME_OFF_MESSAGE } from '../src/chrome.ts';
import { launchStandInChrome } from './helpers.ts';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'vqa-chrome-'));

test('VISUAL_QA_CHROME_ENDPOINT wins', () => {
  assert.equal(findChromeEndpoint({ VISUAL_QA_CHROME_ENDPOINT: 'http://127.0.0.1:9999', VISUAL_QA_CHROME_DATA_DIR: tmp() }), 'http://127.0.0.1:9999');
});

test('DevToolsActivePort becomes a ws endpoint', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'DevToolsActivePort'), '9444\n/devtools/browser/abc\n');
  assert.equal(findChromeEndpoint({ VISUAL_QA_CHROME_DATA_DIR: dir }), 'ws://127.0.0.1:9444/devtools/browser/abc');
});

test('no DevToolsActivePort → null, and the off message says how to fix it', () => {
  assert.equal(findChromeEndpoint({ VISUAL_QA_CHROME_DATA_DIR: tmp() }), null);
  assert.match(CHROME_OFF_MESSAGE, /chrome:\/\/inspect\/#remote-debugging/);
  assert.doesNotMatch(CHROME_OFF_MESSAGE, /isolated/);
});

test('connectChrome attaches to a running browser', async () => {
  const chrome = await launchStandInChrome();
  try {
    const browser = await connectChrome(chrome.endpoint, 10_000);
    assert.equal(browser.contexts().length, 1);
    await browser.close(); // disconnect
    assert.equal(chrome.launched.isConnected(), true, 'the browser itself keeps running');
  } finally {
    await chrome.close();
  }
});

test('connecting leaves the user tabs alone (no dark-mode / download overrides) (C1)', async () => {
  const chrome = await launchStandInChrome();
  const { chromium } = await import('playwright');
  const user = await chromium.connectOverCDP(chrome.endpoint, { noDefaults: true });
  try {
    const tab = await user.contexts()[0].newPage();
    await tab.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    const before = await tab.evaluate(() => [matchMedia('(prefers-color-scheme: dark)').matches, matchMedia('(prefers-reduced-motion: reduce)').matches]);
    assert.deepEqual(before, [true, true]);
    const ours = await connectChrome(chrome.endpoint, 10_000);
    await new Promise((r) => setTimeout(r, 300));
    const during = await tab.evaluate(() => [matchMedia('(prefers-color-scheme: dark)').matches, matchMedia('(prefers-reduced-motion: reduce)').matches]);
    assert.deepEqual(during, [true, true], 'the user tab keeps its own settings while we are connected');
    await ours.close();
  } finally {
    await user.close();
    await chrome.close();
  }
});
