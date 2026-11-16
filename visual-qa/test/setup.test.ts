import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ensureKeyFile, runSetupChecks, PRIVACY_NOTE, UPDATES_NOTE, TYPESAFE_KEY_URL, type SetupDeps } from '../src/setup.ts';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function deps(p: Partial<SetupDeps> = {}): SetupDeps {
  return {
    env: { TYPESAFE_API_KEY: 'sk-SENTINEL' },
    nodeVersion: 'v22.22.3',
    pluginRoot: '/fake/root',
    packagesPresent: () => true,
    pingJev: async () => {},
    chromeEndpoint: () => 'ws://127.0.0.1:9222/devtools/browser/x',
    chromeMajorVersion: () => 157,
    ...p,
  };
}

const item = (r: Awaited<ReturnType<typeof runSetupChecks>>, name: string) => r.items.find((i) => i.name === name);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'vqa-setup-'));

test('all good → ok, no next', async () => {
  const r = await runSetupChecks(deps());
  assert.equal(r.ok, true);
  assert.equal(r.next, null);
  assert.ok(r.items.every((i) => i.ok));
});

test('ANTHROPIC_API_KEY set → still ok, with a warning mentioning /status', async () => {
  const r = await runSetupChecks(deps({ env: { TYPESAFE_API_KEY: 'sk-SENTINEL', ANTHROPIC_API_KEY: 'sk-ant-SENTINEL' } }));
  assert.equal(r.ok, true);
  const w = item(r, 'anthropic_api_key');
  assert.equal(w?.ok, false);
  assert.equal(w?.level, 'warning');
  assert.match(w?.detail ?? '', /\/status/);
  assert.equal(r.next, null);
});

test('no TypeSafe key → not ok, next is typesafe_key with the open-key-file command', async () => {
  const r = await runSetupChecks(deps({ env: { HOME: '/nonexistent' } }));
  assert.equal(r.ok, false);
  assert.equal(r.next?.name, 'typesafe_key');
  assert.equal(r.next?.command, 'node /fake/root/bin/setup.ts --open-key-file');
  assert.ok(r.next?.fix);
});

test('Jev ping fails with a fatal error → not ok, detail names the kind', async () => {
  const r = await runSetupChecks(deps({ pingJev: async () => { throw Object.assign(new Error('bad key'), { kind: 'fatal' }); } }));
  assert.equal(r.ok, false);
  assert.equal(r.next?.name, 'typesafe_key');
  assert.match(r.next?.detail ?? '', /fatal/);
});

test('old Node → next is node', async () => {
  const r = await runSetupChecks(deps({ nodeVersion: 'v22.10.0' }));
  assert.equal(r.ok, false);
  assert.equal(r.next?.name, 'node');
  assert.match(r.next?.detail ?? '', /22\.18/);
});

test('output never contains key values', async () => {
  const r = await runSetupChecks(deps({ env: { TYPESAFE_API_KEY: 'sk-SENTINEL', ANTHROPIC_API_KEY: 'sk-ant-SENTINEL' }, pingJev: async (k) => { throw new Error(`rejected ${k}`); } }));
  assert.ok(!JSON.stringify(r).includes('SENTINEL'));
});

test('Chrome remote debugging off → chrome item with the open-chrome command; on → ok', async () => {
  const off = await runSetupChecks(deps({ chromeEndpoint: () => null }));
  assert.equal(off.ok, false);
  assert.equal(off.next?.name, 'chrome');
  assert.equal(off.next?.command, 'node /fake/root/bin/setup.ts --open-chrome');
  assert.match(off.next?.fix ?? '', /remote debugging/);
  const on = await runSetupChecks(deps());
  assert.equal(item(on, 'chrome')?.ok, true);
});

test('missing packages → next is packages, and the key ping is skipped', async () => {
  let pinged = false;
  const r = await runSetupChecks(deps({ packagesPresent: () => false, pingJev: async () => { pinged = true; } }));
  assert.equal(r.next?.name, 'packages');
  assert.equal(pinged, false);
  assert.equal(item(r, 'typesafe_key')?.ok, true, 'presence is still reported');
});

test('Chrome older than 144 → chrome item says to update Chrome', async () => {
  const r = await runSetupChecks(deps({ chromeMajorVersion: () => 143 }));
  assert.equal(r.next?.name, 'chrome');
  assert.match(r.next?.fix ?? '', /update Chrome/i);
});

test('Chrome missing → chrome item says to install Chrome', async () => {
  const r = await runSetupChecks(deps({ chromeMajorVersion: () => null }));
  assert.equal(r.next?.name, 'chrome');
  assert.match(r.next?.fix ?? '', /install/i);
});

test('next is the first failing error item, in order', async () => {
  const all = await runSetupChecks(deps({ nodeVersion: 'v20.0.0', packagesPresent: () => false, env: { HOME: '/nonexistent' }, chromeEndpoint: () => null }));
  assert.deepEqual(all.items.map((i) => i.name), ['node', 'packages', 'typesafe_key', 'chrome', 'anthropic_api_key']);
  assert.equal(all.next?.name, 'node');
  const noNode = await runSetupChecks(deps({ packagesPresent: () => false, env: { HOME: '/nonexistent' }, chromeEndpoint: () => null }));
  assert.equal(noNode.next?.name, 'packages');
  const noKey = await runSetupChecks(deps({ env: { HOME: '/nonexistent' }, chromeEndpoint: () => null }));
  assert.equal(noKey.next?.name, 'typesafe_key');
  const noChrome = await runSetupChecks(deps({ chromeEndpoint: () => null }));
  assert.equal(noChrome.next?.name, 'chrome');
});

test('ensureKeyFile keeps an existing key and other lines', () => {
  const file = path.join(tmp(), '.visual-qa', '.env');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'FOO=1\nTYPESAFE_API_KEY=abc\n');
  const r = ensureKeyFile(file);
  assert.equal(r.created, false);
  assert.equal(fs.readFileSync(file, 'utf8'), 'FOO=1\nTYPESAFE_API_KEY=abc\n');
});

test('ensureKeyFile adds the key line to a file without one, keeping the other lines', () => {
  const file = path.join(tmp(), '.env');
  fs.writeFileSync(file, 'FOO=1');
  assert.equal(ensureKeyFile(file).created, true);
  assert.equal(fs.readFileSync(file, 'utf8'), 'FOO=1\nTYPESAFE_API_KEY=\n');
});

test('ensureKeyFile creates the file with mode 600 and an empty key line', () => {
  const file = path.join(tmp(), 'nested', '.env');
  const r = ensureKeyFile(file);
  assert.equal(r.created, true);
  assert.equal(fs.readFileSync(file, 'utf8'), 'TYPESAFE_API_KEY=\n');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test('notes and URL are the agreed text', () => {
  assert.equal(PRIVACY_NOTE, "While tests run, page text is sent to TypeSafe (Jev's provider) so Jev can choose the next step — including text from pages you're signed in to. Tests act in your real accounts; they never submit, buy or delete anything unless a check asks for it.");
  assert.equal(UPDATES_NOTE, 'To get updates automatically: type /plugin, open Marketplaces, choose qa-no-qa and turn on auto-update.');
  assert.match(TYPESAFE_KEY_URL, /^https:\/\/console\.typesafe\.ai\/keys$/);
});

function cli(args: string[], env: Record<string, string>) {
  const clean = { ...process.env };
  delete clean.TYPESAFE_API_KEY;
  delete clean.ANTHROPIC_API_KEY;
  const r = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'setup.ts'), ...args], { env: { ...clean, ...env }, encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr, json: r.stdout.trim() ? JSON.parse(r.stdout.trim().split('\n').pop()!) : null };
}

test('CLI --check prints notes only when ok and never prints the key', () => {
  const home = tmp();
  const base = { HOME: home, VISUAL_QA_FAKE_PING: 'ok', VISUAL_QA_CHROME_ENDPOINT: 'ws://127.0.0.1:1/x', VISUAL_QA_CHROME_VERSION: '157' };
  const ok = cli(['--check'], { ...base, TYPESAFE_API_KEY: 'sk-SENTINEL-CLI' });
  assert.equal(ok.code, 0);
  assert.equal(ok.json.ok, true);
  assert.deepEqual(ok.json.notes, [PRIVACY_NOTE, UPDATES_NOTE]);
  assert.ok(!ok.out.includes('SENTINEL') && !ok.err.includes('SENTINEL'));

  const bad = cli([], { ...base, VISUAL_QA_CHROME_VERSION: '120', TYPESAFE_API_KEY: 'sk-SENTINEL-CLI' });
  assert.equal(bad.code, 1);
  assert.equal(bad.json.ok, false);
  assert.equal(bad.json.next.name, 'chrome');
  assert.equal(bad.json.notes, undefined);
  assert.ok(!bad.out.includes('SENTINEL'));
});

test('CLI --check with no key reports typesafe_key as next and exits 1', () => {
  const r = cli(['--check'], { HOME: tmp(), VISUAL_QA_FAKE_PING: 'ok', VISUAL_QA_CHROME_ENDPOINT: 'ws://127.0.0.1:1/x', VISUAL_QA_CHROME_VERSION: '157' });
  assert.equal(r.code, 1);
  assert.equal(r.json.next.name, 'typesafe_key');
});

test('CLI --wait-chrome returns on:true once an endpoint exists', () => {
  const r = cli(['--wait-chrome', '2'], { HOME: tmp(), VISUAL_QA_CHROME_ENDPOINT: 'ws://127.0.0.1:1/x' });
  assert.equal(r.code, 0);
  assert.deepEqual(r.json, { on: true });
});

test('CLI --wait-chrome returns on:false after the timeout', () => {
  const r = cli(['--wait-chrome', '1'], { HOME: tmp(), VISUAL_QA_CHROME_DATA_DIR: tmp() });
  assert.deepEqual(r.json, { on: false });
});

test('setup.ts imports nothing third-party statically', () => {
  for (const f of ['bin/setup.ts', 'src/setup.ts', 'src/config.ts', 'src/chrome-endpoint.ts']) {
    const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const m of text.matchAll(/^\s*(?:import|export)\b[^'"\n]*?from\s+['"]([^'"]+)['"]/gm)) {
      assert.match(m[1], /^(node:|\.)/, `${f} statically imports ${m[1]}`);
    }
    for (const m of text.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)) {
      assert.match(m[1], /^(node:|\.)/, `${f} statically imports ${m[1]}`);
    }
  }
});
