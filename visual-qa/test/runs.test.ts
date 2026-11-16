import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findLatestUnfinishedRun } from '../src/runs.ts';

type Status = 'not_started' | 'completed' | 'skipped';

function fakeRun(root: string, name: string, startedAt: string, statuses: Record<string, Status>, groups: Array<{ id: string; needs: string }> = [], groupOf: Record<string, string> = {}): string {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  const scenarios = Object.keys(statuses).map((id) => ({ id, title: id, start: '/', steps: ['x'], values: {}, expected: 'y', group: groupOf[id] ?? null, source: null, reliesOn: [], loggedOut: false }));
  const records = Object.fromEntries(Object.entries(statuses).map(([id, status]) => [id, { status }]));
  fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ suite: { topic: name, baseUrl: 'https://a.example', groups, scenarios, sourcePath: '/x' }, sessionId: null, startedAt, madeUpCache: {}, scenarios: records }));
  return dir;
}

test('findLatestUnfinishedRun picks the newest run with not-started tests and lists only those', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
  fakeRun(root, 'old', '2026-01-01T10:00:00Z', { A: 'not_started' });
  const middle = fakeRun(root, 'middle', '2026-01-02T10:00:00Z', { A: 'completed', B: 'not_started', C: 'skipped', D: 'not_started' },
    [{ id: 'g1', needs: 'Flag ON' }, { id: 'g2', needs: 'Flag OFF' }], { A: 'g1', B: 'g1', C: 'g2', D: 'g1' });
  fakeRun(root, 'newest', '2026-01-03T10:00:00Z', { A: 'completed', B: 'skipped' });
  fs.mkdirSync(path.join(root, 'no-run-json'));
  const found = findLatestUnfinishedRun(root);
  assert.deepEqual(found, {
    runDir: middle,
    testsFile: path.join(middle, 'tests.yaml'),
    groups: [{ id: 'g1', needs: 'Flag ON', scenarios: ['B', 'D'] }],
  });
});

test('findLatestUnfinishedRun returns null when nothing is unfinished or the folder is missing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
  fakeRun(root, 'done', '2026-01-01T10:00:00Z', { A: 'completed' });
  assert.equal(findLatestUnfinishedRun(root), null);
  assert.equal(findLatestUnfinishedRun(path.join(root, 'missing')), null);
});
