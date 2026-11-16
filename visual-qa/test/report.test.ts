import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildReportModel, renderReport, summaryLine } from '../src/report.ts';

const TRANSCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'transcripts');
const fakeImage = () => Buffer.from('fake-jpeg-bytes');

function scenario(id: string, title: string) {
  return { id, title, session: null, start: '/', steps: ['Open the page', 'Click "Go"'], values: {}, expected: `${id} expected result` };
}

function evidence(runDir: string, id: string, text: string) {
  const dir = path.join(runDir, 'scenarios', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(runDir, 'screenshots'), { recursive: true });
  const textFile = path.join(dir, 'page-text.txt');
  fs.writeFileSync(textFile, text);
  const viewportShot = path.join(runDir, 'screenshots', `${id}-viewport.jpg`);
  const fullPageShot = path.join(runDir, 'screenshots', `${id}-full.jpg`);
  fs.writeFileSync(viewportShot, 'x');
  fs.writeFileSync(fullPageShot, 'x');
  return { url: `https://a.example/${id}`, title: id, httpStatus: 200, consoleErrors: [], textFile, viewportShot, fullPageShot, errorPhrase: null };
}

function record(status: string, extra: Record<string, unknown> = {}) {
  return { status, currentStep: 2, jevActions: 3, claudeActions: 1, elapsedMs: 4200, handbacks: [], madeUp: {}, gaveUp: null, evidence: null, ...extra };
}

function syntheticRun(sessionId: string, browser?: 'chrome' | 'isolated'): string {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vqa-report-'));
  const suite = {
    topic: 'Checkout flow', ...(browser ? { browser } : {}), baseUrl: 'https://a.example/', viewport: { width: 1280, height: 800 }, allowHosts: ['a.example'], judgeModel: 'sonnet',
    scenarios: [scenario('P1', 'Passing one'), scenario('F1', 'Failing <script>alert(1)</script>'), scenario('G1', 'Gave up')], sourcePath: '/s.yaml',
  };
  const run = {
    suite, sessionId, startedAt: '2026-11-15T10:00:00.000Z', madeUpCache: { Street: '1 Test Street' },
    scenarios: {
      P1: record('completed', { evidence: evidence(runDir, 'P1', 'Order summary: 1 item') }),
      F1: record('completed', {
        evidence: evidence(runDir, 'F1', 'Payment'),
        madeUp: { Street: '1 Test Street' },
        handbacks: [{ step: 1, reason: 'needs_text', detail: 'no value for "Street"' }],
      }),
      G1: record('gave_up', { gaveUp: { class: 'tooling_or_environment', reason: 'captcha shown' } }),
    },
  };
  fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify(run));
  fs.writeFileSync(path.join(runDir, 'scenarios', 'P1', 'judge.json'), JSON.stringify({
    keyPoints: [{ point: 'summary shows 1 item', status: 'met', evidence: '1 item', source: 'text' }], verdict: 'pass', reason: 'Summary shows 1 item',
  }));
  fs.writeFileSync(path.join(runDir, 'scenarios', 'F1', 'judge.json'), JSON.stringify({
    keyPoints: [{ point: 'card fields visible', status: 'not_met', evidence: 'no card fields', source: 'screenshot' }], verdict: 'fail', reason: 'Card fields missing',
  }));
  fs.writeFileSync(path.join(runDir, 'events.jsonl'), [
    { type: 'jev_decision', id: 'P1', usage: { inputTokens: 600, outputTokens: 100 }, ts: '2026-11-15T10:00:05.000Z' },
    { type: 'jev_decision', id: 'F1', usage: { inputTokens: 700, outputTokens: 120 }, ts: '2026-11-15T10:01:30.000Z' },
  ].map((e) => JSON.stringify(e)).join('\n') + '\n');
  return runDir;
}

test('verdicts, ordering and summary', () => {
  const m = buildReportModel(syntheticRun('none'), { configDir: TRANSCRIPTS });
  assert.deepEqual(m.rows.map((r) => [r.id, r.verdict]), [['F1', 'fail'], ['G1', 'needs_review'], ['P1', 'pass']]);
  assert.equal(summaryLine(m.counts), '1 pass · 1 fail · 1 needs review');
  assert.equal(summaryLine({ pass: 3, fail: 0, needs_review: 0 }), '3 pass');
  assert.equal(summaryLine({ pass: 0, fail: 2, needs_review: 0 }), '0 pass · 2 fail');
  assert.deepEqual(m.rows.find((r) => r.id === 'P1')?.jevTokens, { input: 600, output: 100 });
});

test('rendered HTML: FAIL before NEEDS REVIEW before PASS, self-contained images', () => {
  const html = renderReport(buildReportModel(syntheticRun('none'), { configDir: TRANSCRIPTS }), fakeImage);
  const fail = html.indexOf('data-verdict="fail"');
  const review = html.indexOf('data-verdict="needs_review"');
  const pass = html.indexOf('data-verdict="pass"');
  assert.ok(fail > 0 && fail < review && review < pass, `${fail} ${review} ${pass}`);
  assert.ok(html.includes('data:image/jpeg;base64,'));
  assert.doesNotMatch(html, /src="https?:/);
  assert.doesNotMatch(html, /href="https?:/);
});

test('made-up values and hand-backs appear in the failing row', () => {
  const html = renderReport(buildReportModel(syntheticRun('none'), { configDir: TRANSCRIPTS }), fakeImage);
  const row = html.slice(html.indexOf('data-verdict="fail"'), html.indexOf('data-verdict="needs_review"'));
  assert.ok(row.includes('1 Test Street'));
  assert.ok(row.includes('needs_text'));
});

test('a never-run scenario shows "not run" instead of an image', () => {
  const html = renderReport(buildReportModel(syntheticRun('none'), { configDir: TRANSCRIPTS }), fakeImage);
  const row = html.slice(html.indexOf('data-verdict="needs_review"'), html.indexOf('data-verdict="pass"'));
  assert.ok(row.includes('not run'));
  assert.ok(!row.includes('data:image/jpeg'));
});

test('missing Claude transcript → "Claude tokens unavailable", still renders', () => {
  const html = renderReport(buildReportModel(syntheticRun('no-such-session'), { configDir: TRANSCRIPTS }), fakeImage);
  assert.ok(html.includes('Claude tokens unavailable'));
  assert.ok(html.includes('Jev'));
  assert.ok(html.includes('Claude n/a'), 'rows say n/a instead of 0 tok (I5)');
  assert.ok(!html.includes('Claude 0 tok'));
});

test('Claude tokens from transcripts appear in the footer', () => {
  const html = renderReport(buildReportModel(syntheticRun('sess-123'), { configDir: TRANSCRIPTS }), fakeImage);
  assert.ok(html.includes('claude-sonnet-5-5'));
  assert.ok(html.includes('Orchestration'));
});

test('titles are HTML-escaped', () => {
  const html = renderReport(buildReportModel(syntheticRun('none'), { configDir: TRANSCRIPTS }), fakeImage);
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
});

test('failed requests appear under Page checks; older runs without them say "none"', () => {
  const runDir = syntheticRun('none');
  const file = path.join(runDir, 'run.json');
  const run = JSON.parse(fs.readFileSync(file, 'utf8'));
  run.scenarios.P1.evidence.failedRequests = ['403 POST a.example/api/chat — {"errors":[{"code":"recaptcha_unsuccessful"}]}'];
  fs.writeFileSync(file, JSON.stringify(run));
  const html = renderReport(buildReportModel(runDir, { configDir: TRANSCRIPTS }), fakeImage);
  assert.ok(html.includes('Failed requests: 403 POST a.example/api/chat — {&quot;errors&quot;:[{&quot;code&quot;:&quot;recaptcha_unsuccessful&quot;}]}'));
  assert.ok(html.includes('Failed requests: none'), 'F1 has evidence without the field');
});

test('chrome-mode runs say so in the header; isolated runs do not', () => {
  const chrome = renderReport(buildReportModel(syntheticRun('none', 'chrome'), { configDir: TRANSCRIPTS }), fakeImage);
  assert.ok(chrome.includes('Ran in your Chrome (shared sign-ins and state)'));
  const isolated = renderReport(buildReportModel(syntheticRun('none', 'isolated'), { configDir: TRANSCRIPTS }), fakeImage);
  assert.ok(!isolated.includes('Ran in your Chrome'));
});
