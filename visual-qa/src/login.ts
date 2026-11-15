import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { DEFAULTS, stateDir } from './config.ts';

/**
 * Opens a visible browser at `url`; the user signs in themselves and closes the window.
 * The session (cookies + storage) is saved to <stateDir>/sessions/<name>.json with mode 600.
 */
export async function login(name: string, url: string, env: Record<string, string | undefined> = process.env): Promise<{ saved: string }> {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error('session name may only contain letters, digits, - and _');
  const dir = path.join(stateDir(env), 'sessions');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const target = path.join(dir, `${name}.json`);
  const temp = `${target}.tmp`;

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: DEFAULTS.viewport });
  const page = await context.newPage();
  await page.goto(url);
  process.stderr.write('Sign in, then close the browser window.\n');

  let saved = false;
  const save = async () => {
    try {
      await context.storageState({ path: temp });
      saved = true;
    } catch {
      // context already closing: keep the last good save
    }
  };
  const timer = setInterval(() => { void save(); }, 2000);
  await new Promise<void>((resolve) => {
    page.on('close', () => { void save().then(resolve); });
    browser.on('disconnected', () => resolve());
  });
  clearInterval(timer);
  await browser.close().catch(() => {});
  if (!saved || !fs.existsSync(temp)) throw new Error('no session was captured — keep the window open until you are signed in');
  fs.renameSync(temp, target);
  fs.chmodSync(target, 0o600);
  return { saved: target };
}
