#!/usr/bin/env node
/**
 * Throwaway spike (plan 2026-11-16, Task 0a): does Playwright's newContext() over the user's real Chrome
 * (remote debugging switched on at chrome://inspect) give a separate signed-out window that closes cleanly?
 * Run: node visual-qa/spike/pm-ux-spike.ts   — then click "Allow" in Chrome.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { connectChrome, findChromeEndpoint } from '../src/chrome.ts';

const out: Record<string, unknown> = {};
const endpoint = findChromeEndpoint();
if (!endpoint) {
  console.log(JSON.stringify({ error: 'remote debugging is off (no DevToolsActivePort)' }));
  process.exit(1);
}
process.stderr.write('Click "Allow" in Chrome…\n');
const t0 = Date.now();
const browser = await connectChrome(endpoint, 100_000);
out.connectedAfterMs = Date.now() - t0;
const userCtx = browser.contexts()[0];
out.userTabsBefore = userCtx.pages().length;
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  out.newContextOk = true;
  const page = await ctx.newPage();
  await page.goto('https://example.com', { waitUntil: 'domcontentloaded', timeout: 15000 });
  out.title = await page.title();
  out.cookiesInNewContext = (await ctx.cookies()).length;
  out.viewport = await page.evaluate(() => [window.innerWidth, window.innerHeight]);
  const shot = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pm-ux-spike-')), 'logged-out.jpg');
  await page.screenshot({ path: shot, type: 'jpeg', quality: 70 });
  out.screenshotBytes = fs.statSync(shot).size;
  await new Promise((r) => setTimeout(r, 2500)); // long enough for the person to see the window
  await ctx.close();
  out.contextClosedOk = true;
} catch (e) {
  out.error = (e as Error).message.split('\n')[0];
}
out.userTabsAfter = userCtx.pages().length;
await browser.close(); // disconnects only
out.disconnectedOk = true;
console.log(JSON.stringify(out));
