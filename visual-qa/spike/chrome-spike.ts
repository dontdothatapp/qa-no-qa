/**
 * Chrome spike (design §12): connect to a running Chrome, open a tab, set its viewport,
 * screenshot it while another tab is in front, close our tabs, disconnect without closing Chrome.
 * Never reads, lists or touches tabs it did not open; prints no cookie values.
 *
 *   node spike/chrome-spike.ts              → the user's Chrome (needs chrome://inspect/#remote-debugging ON + Allow)
 *   node spike/chrome-spike.ts --emulate    → a throwaway headed Chromium with a debug port (no Allow needed)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright';

const out = path.join(os.tmpdir(), 'vqa-chrome-spike');
fs.mkdirSync(out, { recursive: true });
const emulate = process.argv.includes('--emulate');
const target = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:4173/shop.html';
const t0 = Date.now();
const log = (msg: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${msg}`);

let endpoint: string;
let emulated: Browser | null = null;
if (emulate) {
  emulated = await chromium.launch({ headless: false, args: ['--remote-debugging-port=9333'] });
  endpoint = 'http://127.0.0.1:9333';
} else {
  const file = path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome', 'DevToolsActivePort');
  if (!fs.existsSync(file)) {
    console.error('Remote debugging is off: open chrome://inspect/#remote-debugging in Chrome and switch it on.');
    process.exit(1);
  }
  const [port, wsPath] = fs.readFileSync(file, 'utf8').trim().split('\n');
  endpoint = `ws://127.0.0.1:${port}${wsPath}`;
}

log(`connecting (${emulate ? 'emulated Chromium' : 'your Chrome — click Allow in Chrome'})…`);
const browser = await chromium.connectOverCDP(endpoint, { timeout: 120_000 });
log(`connected: Chrome ${browser.version()}, contexts=${browser.contexts().length}`);
const ctx = browser.contexts()[0];
const before = ctx.pages().length;
log(`existing tabs in default context: ${before} (not touched)`);

const page = await ctx.newPage();
await page.setViewportSize({ width: 1280, height: 800 });
await page.goto(target, { waitUntil: 'load', timeout: 20_000 });
log(`opened scenario tab: "${await page.title()}"`);
let popupSeen = false;
page.on('popup', () => { popupSeen = true; });

const front = await ctx.newPage(); // another tab takes the focus
await front.goto('about:blank');
await front.bringToFront();
log('a second tab is now in front; screenshotting the background scenario tab…');
const shot = path.join(out, 'background-tab.jpg');
const s0 = Date.now();
try {
  await page.screenshot({ path: shot, type: 'jpeg', quality: 80, scale: 'css', timeout: 15_000 });
  log(`background screenshot OK in ${Date.now() - s0} ms → ${shot} (${fs.statSync(shot).size} bytes)`);
} catch (e) {
  log(`background screenshot FAILED: ${(e as Error).message.split('\n')[0]}`);
  await page.bringToFront();
  await page.screenshot({ path: shot, type: 'jpeg', quality: 80, scale: 'css', timeout: 15_000 });
  log('screenshot after bringToFront OK');
}
const full = path.join(out, 'background-full.jpg');
await page.screenshot({ path: full, type: 'jpeg', quality: 80, scale: 'css', fullPage: true, timeout: 15_000 }).then(
  () => log('full-page screenshot OK'),
  (e) => log(`full-page screenshot FAILED: ${(e as Error).message.split('\n')[0]}`),
);
const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
log(`tab viewport: ${vp.w}×${vp.h}`);
const cookieCount = (await ctx.cookies(target)).length;
log(`cookies visible for ${new URL(target).host}: ${cookieCount} (values not printed)`);

await front.close();
await page.close();
log(`closed our 2 tabs; tabs now: ${ctx.pages().length} (was ${before})`);
await browser.close(); // for a connected browser this disconnects only
log('disconnected');
if (emulated) {
  await emulated.close();
} else {
  await new Promise((r) => setTimeout(r, 1000));
  const { execFileSync } = await import('node:child_process');
  let running = false;
  try { execFileSync('pgrep', ['-x', 'Google Chrome']); running = true; } catch { /* not running */ }
  log(`your Chrome still running after disconnect: ${running ? 'yes' : 'NO'}`);
}
log(`popup listener attached without error (seen: ${popupSeen})`);
