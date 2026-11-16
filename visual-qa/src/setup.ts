import fs from 'node:fs';
import path from 'node:path';
import { findTypeSafeKey } from './config.ts';
import { CHROME_OFF_MESSAGE } from './chrome-endpoint.ts';

// Built-ins and sibling built-in-only modules only: setup must run before `npm install`.

export type SetupItemName = 'node' | 'packages' | 'typesafe_key' | 'chrome' | 'anthropic_api_key';
export type SetupItem = {
  name: SetupItemName;
  ok: boolean;
  level: 'error' | 'warning';
  detail: string;
  /** Plain words for the person. */
  fix: string | null;
  /** What the agent runs next. */
  command: string | null;
};
export type SetupDeps = {
  env: Record<string, string | undefined>;
  nodeVersion: string;
  pluginRoot: string;
  packagesPresent: () => boolean;
  /** Rejects when Jev cannot be reached; the error's `kind` ('fatal' | 'transient' | 'request') says why. */
  pingJev: (key: string) => Promise<void>;
  chromeEndpoint: () => string | null;
  chromeMajorVersion: () => number | null;
};

export const TYPESAFE_KEY_URL = 'https://console.typesafe.ai/keys';
export const PRIVACY_NOTE =
  "While tests run, page text is sent to TypeSafe (Jev's provider) so Jev can choose the next step — including text from pages you're signed in to. Tests act in your real accounts; they never submit, buy or delete anything unless a check asks for it.";
export const UPDATES_NOTE = 'To get updates automatically: type /plugin, open Marketplaces, choose qa-no-qa and turn on auto-update.';

export const MIN_CHROME_MAJOR = 144;

function nodeOk(version: string): boolean {
  const [maj, min] = version.replace(/^v/, '').split('.').map(Number);
  return maj > 22 || (maj === 22 && min >= 18);
}

/** Setup checks, in the order the person has to fix them. Never includes key values in its output. */
export async function runSetupChecks(d: SetupDeps): Promise<{ ok: boolean; items: SetupItem[]; next: SetupItem | null }> {
  const cmd = (flag: string) => `node ${d.pluginRoot}/bin/setup.ts ${flag}`;
  const items: SetupItem[] = [];

  const nodeGood = nodeOk(d.nodeVersion);
  items.push({
    name: 'node', level: 'error', ok: nodeGood,
    detail: `${d.nodeVersion} (needs 22.18 or newer)`,
    fix: nodeGood ? null : 'Node.js is too old. Install the current LTS version from https://nodejs.org, then run setup again.',
    command: null,
  });

  const havePackages = d.packagesPresent();
  items.push({
    name: 'packages', level: 'error', ok: havePackages,
    detail: havePackages ? 'installed' : 'the runner\'s npm packages are missing',
    fix: havePackages ? null : 'The runner needs to download its packages (one time, about a minute).',
    command: havePackages ? null : `npm install --omit=dev --prefix ${d.pluginRoot}`,
  });

  const key = findTypeSafeKey(d.env);
  let keyItem: SetupItem;
  if (!key) {
    keyItem = {
      name: 'typesafe_key', level: 'error', ok: false,
      detail: 'no TypeSafe key found',
      fix: `Paste your TypeSafe key after "TYPESAFE_API_KEY=" in the file that opens, save it, then run setup again. Get a key at ${TYPESAFE_KEY_URL}`,
      command: cmd('--open-key-file'),
    };
  } else if (!havePackages) {
    keyItem = { name: 'typesafe_key', level: 'error', ok: true, detail: `found (${key.source}); not tested yet — packages missing`, fix: null, command: null };
  } else {
    try {
      await d.pingJev(key.key);
      keyItem = { name: 'typesafe_key', level: 'error', ok: true, detail: `found (${key.source}) and accepted by Jev`, fix: null, command: null };
    } catch (e) {
      const kind = (e as { kind?: string })?.kind ?? 'unknown';
      keyItem = {
        name: 'typesafe_key', level: 'error', ok: false,
        detail: `found (${key.source}) but Jev could not be reached: ${kind} error`,
        fix: kind === 'fatal'
          ? `TypeSafe did not accept the key. Paste a fresh key in the file that opens (get one at ${TYPESAFE_KEY_URL}), save it, then run setup again.`
          : 'Jev could not be reached just now. Check your internet connection and run setup again.',
        command: kind === 'fatal' ? cmd('--open-key-file') : null,
      };
    }
  }
  items.push(keyItem);

  const major = d.chromeMajorVersion();
  const endpoint = major !== null && major >= MIN_CHROME_MAJOR ? d.chromeEndpoint() : null;
  if (major === null) {
    items.push({ name: 'chrome', level: 'error', ok: false, detail: 'Google Chrome not found', fix: 'Install Google Chrome from https://www.google.com/chrome, then run setup again.', command: null });
  } else if (major < MIN_CHROME_MAJOR) {
    items.push({ name: 'chrome', level: 'error', ok: false, detail: `Chrome ${major} (needs ${MIN_CHROME_MAJOR} or newer)`, fix: 'Please update Chrome (Chrome menu > Help > About Google Chrome), then run setup again.', command: null });
  } else if (!endpoint) {
    items.push({
      name: 'chrome', level: 'error', ok: false, detail: `Chrome ${major}: ${CHROME_OFF_MESSAGE}`,
      fix: 'In the Chrome page that opens, switch on remote debugging (the toggle near the top).',
      command: cmd('--open-chrome'),
    });
  } else {
    items.push({ name: 'chrome', level: 'error', ok: true, detail: `Chrome ${major}, remote debugging on`, fix: null, command: null });
  }

  const apiKeySet = !!d.env.ANTHROPIC_API_KEY;
  items.push({
    name: 'anthropic_api_key', level: 'warning', ok: !apiKeySet,
    detail: apiKeySet ? 'ANTHROPIC_API_KEY is set — Claude Code may bill the API instead of your subscription; check /status' : 'not set (subscription billing)',
    fix: apiKeySet ? 'Type /status in Claude Code to see how it is billed.' : null,
    command: null,
  });

  const next = items.find((i) => !i.ok && i.level === 'error') ?? null;
  return { ok: next === null, items, next };
}

const KEY_LINE = /^\s*(?:export\s+)?TYPESAFE_API_KEY\s*=/m;

/** Makes sure the file has a `TYPESAFE_API_KEY=` line (mode 600) without touching any other line. */
export function ensureKeyFile(file: string): { created: boolean } {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    // new file
  }
  const has = KEY_LINE.test(text);
  if (!has) {
    const sep = text === '' || text.endsWith('\n') ? '' : '\n';
    fs.appendFileSync(file, `${sep}TYPESAFE_API_KEY=\n`, { mode: 0o600 });
  }
  fs.chmodSync(file, 0o600);
  return { created: !has };
}
