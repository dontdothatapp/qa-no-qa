#!/usr/bin/env node
/**
 * setup — checks what the runner needs and prints the one next thing the person must do.
 * One JSON line on stdout. No third-party static imports: it must run before `npm install`.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { findChromeEndpoint } from '../src/chrome-endpoint.ts';
import { keyFile, pluginRoot } from '../src/config.ts';
import { ensureKeyFile, PRIVACY_NOTE, runSetupChecks, TYPESAFE_KEY_URL, UPDATES_NOTE } from '../src/setup.ts';

const CHROME_PLIST = '/Applications/Google Chrome.app/Contents/Info.plist';
const CHROME_ADDRESS = 'chrome://inspect/#remote-debugging';
const root = pluginRoot();

function packagesPresent(): boolean {
  try {
    for (const name of ['playwright', 'yaml', '@typesafe-ai/sdk']) import.meta.resolve(name);
    return true;
  } catch {
    return false;
  }
}

function chromeMajorVersion(): number | null {
  if (process.env.VISUAL_QA_CHROME_VERSION !== undefined) {
    const n = parseInt(process.env.VISUAL_QA_CHROME_VERSION, 10);
    return Number.isFinite(n) ? n : null;
  }
  try {
    const v = execFileSync('plutil', ['-extract', 'CFBundleShortVersionString', 'raw', CHROME_PLIST], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

async function pingJev(key: string): Promise<void> {
  if (process.env.VISUAL_QA_FAKE_PING === 'ok') return;
  if (process.env.VISUAL_QA_FAKE_PING === 'fatal') throw Object.assign(new Error('fake'), { kind: 'fatal' });
  const sdk = await import('@typesafe-ai/sdk');
  const { classifyError } = await import('../src/jev-client.ts');
  try {
    const client = new sdk.TypeSafeClient({ apiKey: key, logLevel: 'off', retry: { maxRetries: 0 } } as ConstructorParameters<typeof sdk.TypeSafeClient>[0]);
    await client.systemOne({ state: 'ping', questions: { ok: sdk.noul('Is this a test message?') } } as Parameters<typeof client.systemOne>[0]);
  } catch (e) {
    throw Object.assign(new Error('Jev ping failed'), { kind: classifyError(e) }); // drops the SDK message
  }
}

const print = (v: unknown) => process.stdout.write(`${JSON.stringify(v)}\n`);

async function main(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: { check: { type: 'boolean' }, 'open-key-file': { type: 'boolean' }, 'open-chrome': { type: 'boolean' }, 'wait-chrome': { type: 'string' } },
    allowPositionals: false,
  });

  if (values['open-key-file']) {
    const file = keyFile();
    ensureKeyFile(file);
    spawnSync('open', [TYPESAFE_KEY_URL], { stdio: 'ignore' });
    spawnSync('open', ['-e', file], { stdio: 'ignore' });
    print({ opened: file });
    return 0;
  }

  if (values['open-chrome']) {
    const r = spawnSync('open', ['-a', 'Google Chrome', CHROME_ADDRESS], { stdio: 'ignore' });
    print(r.status === 0 ? { opened: true } : { opened: false, address: CHROME_ADDRESS });
    return 0;
  }

  if (values['wait-chrome'] !== undefined) {
    const seconds = Number(values['wait-chrome'] || 180);
    const until = Date.now() + (Number.isFinite(seconds) ? seconds : 180) * 1000;
    let on = !!findChromeEndpoint();
    while (!on && Date.now() < until) {
      await new Promise((r) => setTimeout(r, 1000));
      on = !!findChromeEndpoint();
    }
    print({ on });
    return 0;
  }

  const r = await runSetupChecks({
    env: process.env,
    nodeVersion: process.version,
    pluginRoot: root,
    packagesPresent,
    pingJev,
    chromeEndpoint: () => findChromeEndpoint(),
    chromeMajorVersion,
  });
  print(r.ok ? { ...r, notes: [PRIVACY_NOTE, UPDATES_NOTE] } : r);
  return r.ok ? 0 : 1;
}

main(process.argv.slice(2)).then(
  (code) => { process.exitCode = code; },
  (e) => { print({ error: (e as Error).message }); process.exitCode = 1; },
);
