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
  return { id, title, start: '/', steps: ['Open the page', 'Click "Go"'], values: {}, expected: `${id} expected result` };
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

function syntheticRun(sessionId: string): string {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vqa-report-'));
  const suite = {
    topic: 'Checkout flow', baseUrl: 'https://a.example/', viewport: { width: 1280, height: 800 }, allowHosts: ['a.example'], judgeModel: 'sonnet',
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
  assert.equal(summaryLine({ pass: 3, fail: 0, needs_review: 0, not_run: 0 }), '3 pass');
  assert.equal(summaryLine({ pass: 0, fail: 2, needs_review: 0, not_run: 0 }), '0 pass · 2 fail');
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

test('a never-run scenario is NOT RUN (paused before this group), with no image', () => {
  const runDir = checklistRun([{ id: 'A', group: 'g1' }, { id: 'B', group: 'g2' }], { A: record('not_started'), B: record('not_started') });
  const m = buildReportModel(runDir, { configDir: TRANSCRIPTS });
  assert.deepEqual(m.rows.map((r) => [r.id, r.verdict, r.reason]), [['A', 'not_run', 'paused before this group'], ['B', 'not_run', 'paused before this group']]);
  const html = renderReport(m, fakeImage);
  assert.ok(html.includes('NOT RUN'));
  assert.ok(!html.includes('data:image/jpeg'));
});

test('the header always says Ran in your Chrome (your sign-ins)', () => {
  const html = renderReport(buildReportModel(syntheticRun('none'), { configDir: TRANSCRIPTS }), fakeImage);
  assert.ok(html.includes('· Ran in your Chrome (your sign-ins)'));
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

// ---- checklist-aware runs ----
function checklistRun(
  list: Array<{ id: string; group?: string | null; source?: string | null; reliesOn?: Array<{ what: string; afterStep: number | null }> }>,
  records: Record<string, unknown>,
  extra: { groups?: Array<{ id: string; needs: string }>; checklist?: string; continuesFrom?: string } = {},
): string {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vqa-report-'));
  const suite = {
    topic: 'T', baseUrl: 'https://a.example/', viewport: { width: 1280, height: 800 }, allowHosts: ['a.example'], judgeModel: 'sonnet', notes: null,
    groups: extra.groups ?? [],
    scenarios: list.map((l) => ({ ...scenario(l.id, `Title ${l.id}`), group: l.group ?? null, source: l.source ?? null, reliesOn: l.reliesOn ?? [], loggedOut: false })),
    sourcePath: '/s.yaml',
  };
  fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify({ suite, sessionId: null, startedAt: '2026-11-15T10:00:00.000Z', continuesFrom: extra.continuesFrom ?? null, madeUpCache: {}, scenarios: records }));
  if (extra.checklist !== undefined) fs.writeFileSync(path.join(runDir, 'checklist.txt'), extra.checklist);
  fs.writeFileSync(path.join(runDir, 'events.jsonl'), '');
  return runDir;
}

function judge(runDir: string, id: string, out: unknown) {
  fs.mkdirSync(path.join(runDir, 'scenarios', id), { recursive: true });
  fs.writeFileSync(path.join(runDir, 'scenarios', id, 'judge.json'), JSON.stringify(out));
}

const passJudge = { keyPoints: [{ point: 'p', status: 'met', evidence: 'Hello', source: 'text' }], verdict: 'pass', reason: 'ok' };

test('rows are grouped under their needs line, in file order', () => {
  const runDir = checklistRun(
    [{ id: 'A1', group: 'second' }, { id: 'B1', group: 'first' }, { id: 'B2', group: 'first' }],
    { A1: record('skipped', { skipReason: 'x' }), B1: record('completed', { evidence: evidence(fs.mkdtempSync(path.join(os.tmpdir(), 'vqa-e-')), 'B1', 'Hello') }), B2: record('skipped', { skipReason: 'y' }) },
    { groups: [{ id: 'first', needs: 'Signed in as admin' }, { id: 'second', needs: 'Empty cart' }] },
  );
  judge(runDir, 'B1', passJudge);
  const m = buildReportModel(runDir, { configDir: TRANSCRIPTS });
  assert.deepEqual(m.groups, [{ id: 'first', needs: 'Signed in as admin' }, { id: 'second', needs: 'Empty cart' }]);
  assert.deepEqual(m.rows.map((r) => r.id), ['B2', 'B1', 'A1'], 'group order first, then not_run before pass');
  const html = renderReport(m, fakeImage);
  const first = html.indexOf('<h2>Signed in as admin</h2>');
  const second = html.indexOf('<h2>Empty cart</h2>');
  assert.ok(first > 0 && first < html.indexOf('data-verdict="pass"') && html.indexOf('data-verdict="pass"') < second);
  assert.equal(html.match(/<section>/g)?.length, 2);
});

test('the checklist line is shown above the title and escaped', () => {
  const runDir = checklistRun([{ id: 'A', source: 'Check <b>cart</b> total' }], { A: record('skipped', { skipReason: 'r' }) });
  const html = renderReport(buildReportModel(runDir, { configDir: TRANSCRIPTS }), fakeImage);
  const q = html.indexOf('<blockquote class="source">Check &lt;b&gt;cart&lt;/b&gt; total</blockquote>');
  assert.ok(q > 0 && q < html.indexOf('<h3>Title A</h3>'));
  assert.ok(!html.includes('<b>cart</b>'));
});

test('a skipped test is NOT RUN with its reason and counted in the summary', () => {
  const runDir = checklistRun([{ id: 'A' }, { id: 'B' }], {
    A: record('completed', { evidence: evidence(fs.mkdtempSync(path.join(os.tmpdir(), 'vqa-e-')), 'A', 'Hello') }),
    B: record('skipped', { skipReason: 'Signed-in setup was skipped' }),
  });
  judge(runDir, 'A', passJudge);
  const m = buildReportModel(runDir, { configDir: TRANSCRIPTS });
  assert.equal(summaryLine(m.counts), '1 pass · 1 not run');
  const b = m.rows.find((r) => r.id === 'B')!;
  assert.deepEqual([b.verdict, b.reason], ['not_run', 'Signed-in setup was skipped']);
  const html = renderReport(m, fakeImage);
  assert.ok(html.includes('data-verdict="not_run"') && html.includes('Signed-in setup was skipped') && html.includes('NOT RUN'));
  assert.ok(html.includes('data-f="not_run"') && html.includes('--nr-bg'));
});

function relyRun(judgeReliesOn: unknown[]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vqa-e-'));
  const ev = evidence(dir, 'A', 'Final page text');
  const cpText = path.join(dir, 'cp.txt');
  const cpShot = path.join(dir, 'cp.jpg');
  fs.writeFileSync(cpText, 'Account settings page');
  fs.writeFileSync(cpShot, 'x');
  const runDir = checklistRun(
    [{ id: 'A', reliesOn: [{ what: 'on the settings page', afterStep: 1 }] }],
    { A: record('completed', { evidence: ev, checkpoints: [{ step: 1, url: 'https://a.example/s', viewportShot: cpShot, textFile: cpText }] }) },
  );
  judge(runDir, 'A', { keyPoints: [{ point: 'p', status: 'met', evidence: 'Final page', source: 'text' }], reliesOn: judgeReliesOn, verdict: 'pass', reason: 'ok' });
  return { runDir, cpShot };
}

test('relies_on results show under "Ran on the right page?" with the checkpoint thumbnail inlined as a data URI', () => {
  const { runDir, cpShot } = relyRun([{ what: 'on the settings page', status: 'met', evidence: 'Account settings', source: 'text' }]);
  const m = buildReportModel(runDir, { configDir: TRANSCRIPTS });
  assert.equal(m.rows[0].verdict, 'pass');
  assert.deepEqual(m.rows[0].checkpointShots, { 'on the settings page': cpShot });
  const html = renderReport(m, (p) => (p === cpShot ? Buffer.from('CHECKPOINT') : Buffer.from('other')));
  const at = html.indexOf('Ran on the right page?');
  assert.ok(at > 0);
  const part = html.slice(at);
  assert.ok(part.includes('on the settings page') && part.includes('Account settings'));
  assert.ok(part.includes(`data:image/jpeg;base64,${Buffer.from('CHECKPOINT').toString('base64')}`));
});

test('a completed test whose judge confirms key points but not relies_on is NEEDS REVIEW in the model', () => {
  for (const reliesOn of [[], [{ what: 'on the settings page', status: 'unclear', evidence: '', source: 'text' }]]) {
    const { runDir } = relyRun(reliesOn);
    const row = buildReportModel(runDir, { configDir: TRANSCRIPTS }).rows[0];
    assert.equal(row.verdict, 'needs_review');
    assert.match(row.reason, /right page: on the settings page/);
    assert.equal(row.reliesOn[0].status, 'unclear', 'a missing entry is shown as unclear');
  }
});

test('Your checklist section renders checklist.txt escaped; absent file → no section', () => {
  const withFile = checklistRun([{ id: 'A' }], { A: record('skipped', { skipReason: 'r' }) }, { checklist: '- check <script>x</script>\n- two' });
  const html = renderReport(buildReportModel(withFile, { configDir: TRANSCRIPTS }), fakeImage);
  assert.ok(html.includes('<details class="checklist"><summary>Your checklist</summary><pre>- check &lt;script&gt;x&lt;/script&gt;\n- two</pre></details>'));
  const without = checklistRun([{ id: 'A' }], { A: record('skipped', { skipReason: 'r' }) });
  assert.ok(!renderReport(buildReportModel(without, { configDir: TRANSCRIPTS }), fakeImage).includes('Your checklist'));
});

test('continuesFrom adds a link to the earlier report', () => {
  const runDir = checklistRun([{ id: 'A' }], { A: record('skipped', { skipReason: 'r' }) }, { continuesFrom: '/runs/earlier run' });
  const m = buildReportModel(runDir, { configDir: TRANSCRIPTS });
  assert.equal(m.continuesFrom, '/runs/earlier run');
  assert.ok(renderReport(m, fakeImage).includes('Continues <a href="file:///runs/earlier%20run/report.html">the earlier run</a>'));
  const none = checklistRun([{ id: 'A' }], { A: record('skipped', { skipReason: 'r' }) });
  assert.ok(!renderReport(buildReportModel(none, { configDir: TRANSCRIPTS }), fakeImage).includes('Continues'));
});
