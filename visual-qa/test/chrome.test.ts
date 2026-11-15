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
  assert.match(CHROME_OFF_MESSAGE, /browser: isolated/);
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
