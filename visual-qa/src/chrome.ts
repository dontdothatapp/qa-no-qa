import { chromium, type Browser } from 'playwright';

export { CHROME_OFF_MESSAGE, findChromeEndpoint } from './chrome-endpoint.ts';

/**
 * Connects to the running Chrome (Chrome asks the user to click Allow). `browser.close()` later only disconnects.
 * `noDefaults` is essential: without it Playwright applies browser-wide overrides to the user's profile
 * (download redirection into a temp dir that is deleted on disconnect, forced light colour scheme and
 * no reduced motion in every open tab).
 */
export function connectChrome(endpoint: string, timeoutMs = 100_000): Promise<Browser> {
  return chromium.connectOverCDP(endpoint, { timeout: timeoutMs, noDefaults: true });
}

/** Turns a connectOverCDP failure into what the user should do about it. */
export function explainConnectError(e: unknown, timeoutMs: number): string {
  const m = (e as Error)?.message ?? String(e);
  if (/ECONNREFUSED/.test(m)) {
    return 'Chrome is not reachable on its remote-debugging port — is Chrome running with remote debugging on (chrome://inspect/#remote-debugging)?';
  }
  if (/Timeout .*exceeded|timed out/i.test(m)) {
    return `Chrome did not allow the connection within ${Math.round(timeoutMs / 1000)} s — click "Allow" in Chrome when it asks, then start again`;
  }
  if (/\b403\b|refused|closed|socket hang up|ECONNRESET|WebSocket error|Unexpected status/i.test(m)) {
    return 'Chrome refused the connection (was "Allow" declined?) — start again and click "Allow" in Chrome';
  }
  return `could not connect to Chrome: ${m.split('\n')[0]}`;
}
