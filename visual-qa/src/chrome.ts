import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright';

type Env = Record<string, string | undefined>;

export const CHROME_OFF_MESSAGE =
  'remote debugging is off in Chrome — open chrome://inspect/#remote-debugging and switch it on (or set browser: isolated)';

/**
 * Where to reach the user's running Chrome. Chrome ≥ 144 writes DevToolsActivePort (port, path)
 * into its data directory once remote debugging is switched on at chrome://inspect/#remote-debugging.
 */
export function findChromeEndpoint(env: Env = process.env): string | null {
  if (env.VISUAL_QA_CHROME_ENDPOINT) return env.VISUAL_QA_CHROME_ENDPOINT;
  const dir = env.VISUAL_QA_CHROME_DATA_DIR ?? path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome');
  try {
    const [port, wsPath] = fs.readFileSync(path.join(dir, 'DevToolsActivePort'), 'utf8').trim().split('\n');
    if (!/^\d+$/.test(port ?? '') || !wsPath?.startsWith('/')) return null;
    return `ws://127.0.0.1:${port}${wsPath}`;
  } catch {
    return null;
  }
}

/**
 * Connects to the running Chrome (Chrome asks the user to click Allow). `browser.close()` later only disconnects.
 * `noDefaults` is essential: without it Playwright applies browser-wide overrides to the user's profile
 * (download redirection into a temp dir that is deleted on disconnect, forced light colour scheme and
 * no reduced motion in every open tab).
 */
export function connectChrome(endpoint: string, timeoutMs = 100_000): Promise<Browser> {
  return chromium.connectOverCDP(endpoint, { timeout: timeoutMs, noDefaults: true });
}
