import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { claudeTokens, jevTokens } from '../src/tokens.ts';

const CONFIG = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'transcripts');
const SINCE = '2026-11-15T10:00:00.000Z';
const SONNET = 'claude-sonnet-5-5';
const HAIKU = 'claude-haiku-5-5';

test('orchestration de-duplicates by message.id and skips lines before the run', () => {
  const t = claudeTokens('sess-123', SINCE, CONFIG);
  assert.ok(t.available);
  // main: m1 once + m2; plus unattributed subagent a3
  assert.deepEqual(t.orchestration[SONNET], { input: 10 + 5 + 1, cacheWrite: 100 + 0 + 1, cacheRead: 1000 + 2000 + 1, output: 50 + 20 + 1 });
});

test('subagents are attributed to scenarios by description', () => {
  const t = claudeTokens('sess-123', SINCE, CONFIG);
  assert.ok(t.available);
  assert.deepEqual(t.byScenario['CO-01'], { [SONNET]: { input: 3, cacheWrite: 500, cacheRead: 0, output: 200 } });
  assert.deepEqual(t.byScenario['CO-02'], { [HAIKU]: { input: 7, cacheWrite: 300, cacheRead: 600, output: 90 } });
});

test('totals sum orchestration and scenarios per model', () => {
  const t = claudeTokens('sess-123', SINCE, CONFIG);
  assert.ok(t.available);
  assert.deepEqual(t.total[SONNET], { input: 19, cacheWrite: 601, cacheRead: 3001, output: 271 });
  assert.deepEqual(t.total[HAIKU], { input: 7, cacheWrite: 300, cacheRead: 600, output: 90 });
});

test('unknown session → unavailable, without throwing', () => {
  const t = claudeTokens('no-such-session', SINCE, CONFIG);
  assert.equal(t.available, false);
  assert.ok(!t.available && /not found/.test(t.error));
});

test('jevTokens sums jev_decision usage per scenario', () => {
  const j = jevTokens([
    { type: 'jev_decision', id: 'A', usage: { inputTokens: 600, outputTokens: 100 } },
    { type: 'jev_decision', id: 'A', usage: { inputTokens: 700, outputTokens: 110 } },
    { type: 'jev_decision', id: 'B', usage: { inputTokens: 50, outputTokens: 5 } },
    { type: 'action', id: 'A' },
  ]);
  assert.deepEqual(j.byScenario.A, { input: 1300, output: 210 });
  assert.deepEqual(j.total, { input: 1350, output: 215 });
});
