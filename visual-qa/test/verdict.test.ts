import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeVerdict, parseJudgeOutput, normalizeForQuote, type JudgeOutput, type KeyPoint } from '../src/verdict.ts';

const met = (point: string, evidence: string, source: KeyPoint['source'] = 'text'): KeyPoint => ({ point, status: 'met', evidence, source });
const judge = (keyPoints: KeyPoint[], verdict: JudgeOutput['verdict'] = 'pass', reason = 'judge reason'): JudgeOutput => ({ keyPoints, verdict, reason });
const PAGE = 'Pricing\nAnnual plan  SAVE    20%\n$96 per year';

test('gave up as app_problem → fail with the gave-up reason', () => {
  const v = computeVerdict({ judge: null, pageText: '', gaveUp: { class: 'app_problem', reason: 'Checkout button missing' } });
  assert.deepEqual([v.verdict, v.reason], ['fail', 'Checkout button missing']);
});

test('gave up as tooling_or_environment → needs_review', () => {
  assert.equal(computeVerdict({ judge: null, pageText: '', gaveUp: { class: 'tooling_or_environment', reason: 'captcha' } }).verdict, 'needs_review');
});

test('missing judge → needs_review', () => {
  const v = computeVerdict({ judge: null, pageText: PAGE, gaveUp: null });
  assert.deepEqual([v.verdict, v.reason], ['needs_review', 'judge output missing or invalid']);
});

test('no key points → needs_review', () => {
  assert.equal(computeVerdict({ judge: judge([]), pageText: PAGE, gaveUp: null }).verdict, 'needs_review');
});

test('any not_met → fail, even if the judge said pass', () => {
  const v = computeVerdict({
    judge: judge([met('price', '$96'), { point: 'badge', status: 'not_met', evidence: 'no badge visible', source: 'screenshot' }], 'pass', 'Badge missing'),
    pageText: PAGE, gaveUp: null,
  });
  assert.deepEqual([v.verdict, v.reason], ['fail', 'Badge missing']);
});

test('any unclear → needs_review', () => {
  const v = computeVerdict({ judge: judge([met('price', '$96'), { point: 'badge', status: 'unclear', evidence: '', source: 'screenshot' }]), pageText: PAGE, gaveUp: null });
  assert.equal(v.verdict, 'needs_review');
});

test('all met with quotes found (case/whitespace-insensitive) → pass', () => {
  const v = computeVerdict({ judge: judge([met('badge', 'Save 20%'), met('layout', 'two columns', 'screenshot')]), pageText: PAGE, gaveUp: null });
  assert.equal(v.verdict, 'pass');
  assert.deepEqual(v.quoteProblems, []);
});

test('a met text quote not on the page → needs_review with the quote listed', () => {
  const v = computeVerdict({ judge: judge([met('badge', 'Save 25% today')]), pageText: PAGE, gaveUp: null });
  assert.equal(v.verdict, 'needs_review');
  assert.deepEqual(v.quoteProblems, ['Save 25% today']);
});

test('a met point with no evidence → needs_review', () => {
  assert.equal(computeVerdict({ judge: judge([met('badge', '  ', 'screenshot')]), pageText: PAGE, gaveUp: null }).verdict, 'needs_review');
});

test('normalizeForQuote folds case, whitespace, curly quotes and zero-width chars', () => {
  assert.equal(normalizeForQuote('  “Save”​  20%\n'), '"save" 20%');
});

test('parseJudgeOutput rejects invalid JSON and bad shapes', () => {
  assert.equal(parseJudgeOutput('not json'), null);
  assert.equal(parseJudgeOutput('{"keyPoints": "x"}'), null);
  assert.equal(parseJudgeOutput(JSON.stringify({ keyPoints: [{ point: 'a', status: 'maybe', evidence: '', source: 'text' }], verdict: 'pass', reason: '' })), null);
  const ok = parseJudgeOutput(JSON.stringify(judge([met('a', 'b')])));
  assert.equal(ok?.keyPoints.length, 1);
});
