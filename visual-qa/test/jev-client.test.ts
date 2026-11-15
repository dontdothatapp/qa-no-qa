import { test } from 'node:test';
import assert from 'node:assert/strict';
import { choice } from '@typesafe-ai/sdk';
import { createTypeSafeClient, createScriptedClient, JevError } from '../src/jev-client.ts';

const REQ = {
  state: { url: 'u' },
  questions: { operation: choice('Which?', { click: null, done: null }), target: choice('Which control?', { none: null, '7': null }) },
};

test('a request the SDK rejects locally → request JevError, nothing sent', async () => {
  const f = fakeFetch([{ status: 200, body: {} }]);
  const client = createTypeSafeClient({ fetch: f.fn, apiKey: 'test-key' });
  await assert.rejects(client.decide({ state: {}, questions: {} }), (e: unknown) => e instanceof JevError && e.kind === 'request');
  assert.equal(f.calls.length, 0);
});

function fakeFetch(responses: Array<{ status: number; body: unknown }>) {
  const calls: number[] = [];
  const fn = async (_input: unknown, _init?: unknown) => {
    const r = responses[Math.min(calls.length, responses.length - 1)];
    calls.push(r.status);
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
  };
  return { fn: fn as unknown as typeof fetch, calls };
}

const OK_BODY = {
  model: 'jev-1.13.0',
  answers: {
    operation: { type: 'choice', choice: 'click', confidence: 0.93, probabilities: { click: 0.95, done: 0.05 } },
    target: { type: 'choice', choice: '7', confidence: 0.88, probabilities: { '7': 0.9, none: 0.1 } },
  },
  usage: { input_tokens: 428, output_tokens: 73 },
};

const FAST = { backoffInitialMs: 1, backoffMaxMs: 2, backoffJitter: 0 };

test('401 → fatal JevError after one call', async () => {
  const f = fakeFetch([{ status: 401, body: { error: 'bad key' } }]);
  const client = createTypeSafeClient({ fetch: f.fn, apiKey: 'test-key', retry: FAST });
  await assert.rejects(client.decide(REQ), (e: unknown) => e instanceof JevError && e.kind === 'fatal');
  assert.equal(f.calls.length, 1);
});

test('529 three times → transient JevError after 3 calls', async () => {
  const f = fakeFetch([{ status: 529, body: { error: 'overloaded' } }]);
  const client = createTypeSafeClient({ fetch: f.fn, apiKey: 'test-key', retry: FAST });
  await assert.rejects(client.decide(REQ), (e: unknown) => e instanceof JevError && e.kind === 'transient');
  assert.equal(f.calls.length, 3);
});

test('422 → request JevError, not retried', async () => {
  const f = fakeFetch([{ status: 422, body: { error: 'missing field' } }]);
  const client = createTypeSafeClient({ fetch: f.fn, apiKey: 'test-key', retry: FAST });
  await assert.rejects(client.decide(REQ), (e: unknown) => e instanceof JevError && e.kind === 'request');
  assert.equal(f.calls.length, 1);
});

test('200 response maps to a JevAnswer with usage', async () => {
  const f = fakeFetch([{ status: 200, body: OK_BODY }]);
  const client = createTypeSafeClient({ fetch: f.fn, apiKey: 'test-key', retry: FAST });
  const a = await client.decide(REQ);
  assert.equal(a.operation, 'click');
  assert.equal(a.target, 7);
  assert.equal(a.opConfidence, 0.93);
  assert.equal(a.targetConfidence, 0.88);
  assert.deepEqual(a.usage, { inputTokens: 428, outputTokens: 73 });
  assert.ok(a.latencyMs >= 0);
});

test('target "none" maps to null', async () => {
  const body = structuredClone(OK_BODY);
  body.answers.operation.choice = 'done';
  body.answers.target.choice = 'none';
  const f = fakeFetch([{ status: 200, body }]);
  const a = await createTypeSafeClient({ fetch: f.fn, apiKey: 'test-key', retry: FAST }).decide(REQ);
  assert.equal(a.operation, 'done');
  assert.equal(a.target, null);
});

test('scripted client returns answers in order, records requests, throws when exhausted', async () => {
  const c = createScriptedClient([{ operation: 'click', target: 3 }, new JevError('down', 'fatal')]);
  const a = await c.decide(REQ);
  assert.equal(a.operation, 'click');
  assert.equal(a.target, 3);
  assert.equal(a.opConfidence, 1);
  await assert.rejects(c.decide(REQ), (e: unknown) => e instanceof JevError && e.kind === 'fatal');
  await assert.rejects(c.decide(REQ), /exhausted/);
  assert.equal(c.requests.length, 3);
});
