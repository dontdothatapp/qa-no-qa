import { findTypeSafeKey } from './config.ts';
import { classifyError } from './jev-client.ts';
import { CHROME_OFF_MESSAGE } from './chrome.ts';

export type DoctorCheck = { name: string; ok: boolean; level: 'error' | 'warning'; detail: string };
export type DoctorDeps = {
  env: Record<string, string | undefined>;
  nodeVersion: string;
  chromiumPath: () => string;
  fileExists: (p: string) => boolean;
  pingJev: (key: string) => Promise<void>;
  /** The user's Chrome remote-debugging endpoint, or null when it is switched off. */
  chromeEndpoint: () => string | null;
};

function nodeOk(version: string): boolean {
  const [maj, min] = version.replace(/^v/, '').split('.').map(Number);
  return maj > 22 || (maj === 22 && min >= 18);
}

/** Preflight checks. Never includes key values in its output. */
export async function runDoctor(d: DoctorDeps): Promise<{ ok: boolean; checks: DoctorCheck[] }> {
  const checks: DoctorCheck[] = [];
  checks.push({ name: 'node', level: 'error', ok: nodeOk(d.nodeVersion), detail: `${d.nodeVersion} (needs ≥ 22.18)` });

  let chromium = '';
  try {
    chromium = d.chromiumPath();
  } catch {
    // reported below
  }
  const hasChromium = !!chromium && d.fileExists(chromium);
  checks.push({ name: 'chromium', level: 'error', ok: hasChromium, detail: hasChromium ? 'installed' : 'missing — run: npx playwright install chromium' });

  const key = findTypeSafeKey(d.env);
  checks.push({
    name: 'typesafe_key', level: 'error', ok: !!key,
    detail: key ? `found (${key.source})` : 'not found — put TYPESAFE_API_KEY=... in the project .visual-qa/.env or ~/.visual-qa/.env',
  });

  if (key) {
    try {
      await d.pingJev(key.key);
      checks.push({ name: 'jev_reachable', level: 'error', ok: true, detail: 'ok' });
    } catch (e) {
      checks.push({ name: 'jev_reachable', level: 'error', ok: false, detail: `${classifyError(e)} error` });
    }
  } else {
    checks.push({ name: 'jev_reachable', level: 'error', ok: false, detail: 'skipped: no key' });
  }

  const chromeOn = !!d.chromeEndpoint();
  checks.push({ name: 'chrome_remote_debugging', level: 'warning', ok: chromeOn, detail: chromeOn ? 'on' : CHROME_OFF_MESSAGE });

  const apiKeySet = !!d.env.ANTHROPIC_API_KEY;
  checks.push({
    name: 'anthropic_api_key', level: 'warning', ok: !apiKeySet,
    detail: apiKeySet ? 'ANTHROPIC_API_KEY is set — Claude Code may bill the API instead of your subscription; check /status' : 'not set (subscription billing)',
  });

  return { ok: checks.every((c) => c.ok || c.level === 'warning'), checks };
}
