import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findTypeSafeKey, runFolderName, sanitizeTopic, DEFAULTS } from '../src/config.ts';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vqa-config-'));
}

function writeEnv(dir: string, content: string): void {
  fs.mkdirSync(path.join(dir, '.visual-qa'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.visual-qa', '.env'), content);
}

test('key from env wins over files', () => {
  const project = tempDir();
  writeEnv(project, 'TYPESAFE_API_KEY=from-project\n');
  const found = findTypeSafeKey({ TYPESAFE_API_KEY: 'k1', VISUAL_QA_PROJECT_ROOT: project, HOME: tempDir() });
  assert.equal(found?.source, 'env');
  assert.equal(found?.key, 'k1');
});

test('key from project .env when env is empty', () => {
  const project = tempDir();
  writeEnv(project, '# comment\nOTHER=x\nTYPESAFE_API_KEY="from-project"\n');
  const found = findTypeSafeKey({ VISUAL_QA_PROJECT_ROOT: project, HOME: tempDir() });
  assert.equal(found?.source, 'project');
  assert.equal(found?.key, 'from-project');
});

test('key from home .env when project has none', () => {
  const home = tempDir();
  writeEnv(home, "TYPESAFE_API_KEY='from-home'\n");
  const found = findTypeSafeKey({ VISUAL_QA_PROJECT_ROOT: tempDir(), HOME: home });
  assert.equal(found?.source, 'home');
  assert.equal(found?.key, 'from-home');
});

test('no key anywhere → null', () => {
  assert.equal(findTypeSafeKey({ VISUAL_QA_PROJECT_ROOT: tempDir(), HOME: tempDir() }), null);
});

test('runFolderName uses date + sanitized topic', () => {
  const p = runFolderName('Checkout: flow/v2', new Date('2026-11-15T14:30'), () => false);
  assert.equal(path.basename(p), '2026-11-15 Checkout- flow-v2');
  assert.ok(path.isAbsolute(p));
});

test('runFolderName appends HH-MM when folder exists', () => {
  const p = runFolderName('Checkout', new Date('2026-11-15T14:30'), (q) => q.endsWith('Checkout'));
  assert.equal(path.basename(p), '2026-11-15 Checkout 14-30');
});

test('runFolderName adds seconds when the HH-MM folder also exists', () => {
  const p = runFolderName('Checkout', new Date('2026-11-15T14:30:07'), () => true);
  assert.equal(path.basename(p), '2026-11-15 Checkout 14-30-07');
});

test('sanitizeTopic replaces path-unsafe characters', () => {
  assert.equal(sanitizeTopic('  a\\b*c?d"e<f>g|h  '), 'a-b-c-d-e-f-g-h');
});

test('DEFAULTS carry the spec values', () => {
  assert.equal(DEFAULTS.confidenceThreshold, 0.7);
  assert.equal(DEFAULTS.stepBudget, 8);
  assert.equal(DEFAULTS.scenarioBudget, 40);
  assert.equal(DEFAULTS.takeoverBudget, 25);
  assert.deepEqual(DEFAULTS.viewport, { width: 1280, height: 800 });
  assert.equal(DEFAULTS.maxTargets, 254);
  assert.equal(DEFAULTS.jevModel, 'jev-latest');
});
