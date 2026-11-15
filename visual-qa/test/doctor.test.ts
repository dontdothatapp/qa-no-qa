import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runDoctor, type DoctorDeps } from '../src/doctor.ts';
import { JevError } from '../src/jev-client.ts';

function deps(p: Partial<DoctorDeps> = {}): DoctorDeps {
  return {
    env: { TYPESAFE_API_KEY: 'sk-SENTINEL' },
    nodeVersion: 'v22.22.3',
    chromiumPath: () => '/fake/chromium',
    fileExists: () => true,
    pingJev: async () => {},
    ...p,
  };
}

test('all good → ok', async () => {
  const r = await runDoctor(deps());
  assert.equal(r.ok, true);
  assert.ok(r.checks.every((c) => c.ok));
});

test('ANTHROPIC_API_KEY set → ok with a warning mentioning /status', async () => {
  const r = await runDoctor(deps({ env: { TYPESAFE_API_KEY: 'sk-SENTINEL', ANTHROPIC_API_KEY: 'sk-ant-SENTINEL' } }));
  assert.equal(r.ok, true);
  const w = r.checks.find((c) => c.name === 'anthropic_api_key');
  assert.equal(w?.ok, false);
  assert.equal(w?.level, 'warning');
  assert.match(w?.detail ?? '', /\/status/);
});

test('no TypeSafe key → not ok', async () => {
  const r = await runDoctor(deps({ env: { VISUAL_QA_PROJECT_ROOT: '/nonexistent', HOME: '/nonexistent' } }));
  assert.equal(r.ok, false);
  assert.equal(r.checks.find((c) => c.name === 'typesafe_key')?.ok, false);
});

test('Jev ping fails with a fatal error → not ok, detail names the kind', async () => {
  const r = await runDoctor(deps({ pingJev: async () => { throw new JevError('bad key', 'fatal'); } }));
  assert.equal(r.ok, false);
  assert.match(r.checks.find((c) => c.name === 'jev_reachable')?.detail ?? '', /fatal/);
});

test('old Node and missing Chromium are errors', async () => {
  const r = await runDoctor(deps({ nodeVersion: 'v22.10.0', fileExists: () => false }));
  assert.equal(r.ok, false);
  assert.equal(r.checks.find((c) => c.name === 'node')?.ok, false);
  assert.match(r.checks.find((c) => c.name === 'chromium')?.detail ?? '', /npx playwright install chromium/);
});

test('output never contains key values', async () => {
  const r = await runDoctor(deps({ env: { TYPESAFE_API_KEY: 'sk-SENTINEL', ANTHROPIC_API_KEY: 'sk-ant-SENTINEL' } }));
  assert.ok(!JSON.stringify(r).includes('SENTINEL'));
});
