import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkReliedOn, computeVerdict, parseJudgeOutput, normalizeForQuote, type DueRely, type JudgeOutput, type KeyPoint } from '../src/verdict.ts';

const met = (point: string, evidence: string, source: KeyPoint['source'] = 'text'): KeyPoint => ({ point, status: 'met', evidence, source });
const judge = (keyPoints: KeyPoint[], verdict: JudgeOutput['verdict'] = 'pass', reason = 'judge reason', reliesOn: JudgeOutput['reliesOn'] = []): JudgeOutput => ({ keyPoints, reliesOn, verdict, reason });
const PAGE = 'Pricing\nAnnual plan  SAVE    20%\n$96 per year';

test('gave up as app_problem → fail with the gave-up reason', () => {
  const v = computeVerdict({ judge: null, pageText: '', gaveUp: { class: 'app_problem', reason: 'Checkout button missing' }, skipped: null, reliesOn: [] });
  assert.deepEqual([v.verdict, v.reason], ['fail', 'Checkout button missing']);
});

test('gave up as tooling_or_environment → needs_review', () => {
  assert.equal(computeVerdict({ judge: null, pageText: '', gaveUp: { class: 'tooling_or_environment', reason: 'captcha' }, skipped: null, reliesOn: [] }).verdict, 'needs_review');
});

test('missing judge → needs_review', () => {
  const v = computeVerdict({ judge: null, pageText: PAGE, gaveUp: null, skipped: null, reliesOn: [] });
  assert.deepEqual([v.verdict, v.reason], ['needs_review', 'judge output missing or invalid']);
});

test('no key points → needs_review', () => {
  assert.equal(computeVerdict({ judge: judge([]), pageText: PAGE, gaveUp: null, skipped: null, reliesOn: [] }).verdict, 'needs_review');
});

test('any not_met → fail, even if the judge said pass', () => {
  const v = computeVerdict({
    judge: judge([met('price', '$96'), { point: 'badge', status: 'not_met', evidence: 'no badge visible', source: 'screenshot' }], 'pass', 'Badge missing'),
    pageText: PAGE, gaveUp: null, skipped: null, reliesOn: [],
  });
  assert.deepEqual([v.verdict, v.reason], ['fail', 'Badge missing']);
});

test('any unclear → needs_review', () => {
  const v = computeVerdict({ judge: judge([met('price', '$96'), { point: 'badge', status: 'unclear', evidence: '', source: 'screenshot' }]), pageText: PAGE, gaveUp: null, skipped: null, reliesOn: [] });
  assert.equal(v.verdict, 'needs_review');
});

test('all met with quotes found (case/whitespace-insensitive) → pass', () => {
  const v = computeVerdict({ judge: judge([met('badge', 'Save 20%'), met('layout', 'two columns', 'screenshot')]), pageText: PAGE, gaveUp: null, skipped: null, reliesOn: [] });
  assert.equal(v.verdict, 'pass');
  assert.deepEqual(v.quoteProblems, []);
});

test('a met text quote not on the page → needs_review with the quote listed', () => {
  const v = computeVerdict({ judge: judge([met('badge', 'Save 25% today')]), pageText: PAGE, gaveUp: null, skipped: null, reliesOn: [] });
  assert.equal(v.verdict, 'needs_review');
  assert.deepEqual(v.quoteProblems, ['Save 25% today']);
});

test('all points met but the judge says fail → needs_review, never pass (C1)', () => {
  const v = computeVerdict({ judge: judge([met('cart', 'Cart')], 'fail', 'Cart still shows 0 items'), pageText: 'Cart: 0', gaveUp: null, skipped: null, reliesOn: [] });
  assert.equal(v.verdict, 'needs_review');
  assert.match(v.reason, /disagrees/);
});

test('a met text point whose evidence wraps the exact quote in a description → pass (SRCH-01)', () => {
  const v = computeVerdict({ judge: judge([met('badge', 'Page text lists "Save 20%"; the screenshot shows it under the price.')]), pageText: PAGE, gaveUp: null, skipped: null, reliesOn: [] });
  assert.equal(v.verdict, 'pass');
});

test('a wrapped quote that is not on the page → still needs_review', () => {
  const v = computeVerdict({ judge: judge([met('badge', 'Page text lists "Save 25%" near the price')]), pageText: PAGE, gaveUp: null, skipped: null, reliesOn: [] });
  assert.equal(v.verdict, 'needs_review');
});

test('a met point with no evidence → needs_review', () => {
  assert.equal(computeVerdict({ judge: judge([met('badge', '  ', 'screenshot')]), pageText: PAGE, gaveUp: null, skipped: null, reliesOn: [] }).verdict, 'needs_review');
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

const REL_PAGE = 'Listing\nLocated in France\n$96 per year';
const rel = (what: string, evidence: string, status: 'met' | 'not_met' | 'unclear' = 'met', source: 'text' | 'screenshot' = 'text') => ({ what, status, evidence, source });
const due: DueRely[] = [{ what: 'The listing is in France', pageText: REL_PAGE }];
const okPoints = [met('price', '$96')];
const completed = (j: JudgeOutput | null, reliesOn = due, pageText = PAGE) => computeVerdict({ judge: j, pageText, gaveUp: null, skipped: null, reliesOn });

test('skipped → not_run with the skip reason', () => {
  const v = computeVerdict({ judge: null, pageText: '', gaveUp: null, skipped: 'Depends on S1, which failed', reliesOn: [] });
  assert.deepEqual([v.verdict, v.reason], ['not_run', 'Depends on S1, which failed']);
});

test('no_matching_page → needs_review', () => {
  const v = computeVerdict({ judge: null, pageText: '', gaveUp: { class: 'no_matching_page', reason: 'no listing in France' }, skipped: null, reliesOn: [] });
  assert.deepEqual([v.verdict, v.reason], ['needs_review', "Couldn't find a page that matches: no listing in France"]);
});

test('completed, all key points met, relies_on met with a real quote → pass', () => {
  const v = completed(judge(okPoints, 'pass', 'ok', [rel('The listing is in France', 'Located in France')]));
  assert.equal(v.verdict, 'pass');
});

test('completed, key points met, relies_on not_met → needs_review', () => {
  const v = completed(judge(okPoints, 'pass', 'ok', [rel('The listing is in France', 'Located in France', 'not_met')]));
  assert.deepEqual([v.verdict, v.reason], ['needs_review', "Couldn't confirm the test ran on the right page: The listing is in France"]);
});

const CANT = "Couldn't confirm the test ran on the right page: The listing is in France";
test('completed, judge left out the relies_on entry → needs_review', () => {
  const v = completed(judge(okPoints));
  assert.deepEqual([v.verdict, v.reason], ['needs_review', CANT]);
});

test('completed, judge renamed the relies_on what → needs_review', () => {
  const v = completed(judge(okPoints, 'pass', 'ok', [rel('The listing is in Spain', 'Located in France')]));
  assert.deepEqual([v.verdict, v.reason], ['needs_review', CANT]);
});

test('completed, relies_on quote not on that checkpoint page → needs_review and in quoteProblems', () => {
  const v = completed(judge(okPoints, 'pass', 'ok', [rel('The listing is in France', 'Located in Spain')]), due, PAGE);
  assert.equal(v.verdict, 'needs_review');
  assert.deepEqual(v.quoteProblems, ['Located in Spain']);
});

test('completed, relies_on matched ignoring case and spacing', () => {
  const v = completed(judge(okPoints, 'pass', 'ok', [rel('  the listing IS in france ', 'located   in france')]));
  assert.equal(v.verdict, 'pass');
});

test('completed, relies_on unconfirmed but a key point not_met → still needs_review, never fail', () => {
  const v = completed(judge([{ point: 'badge', status: 'not_met', evidence: 'none', source: 'screenshot' }], 'fail', 'Badge missing'));
  assert.equal(v.verdict, 'needs_review');
});

test('completed, relies_on met with screenshot source needs evidence text only', () => {
  assert.equal(completed(judge(okPoints, 'pass', 'ok', [rel('The listing is in France', 'flag shown', 'met', 'screenshot')])).verdict, 'pass');
  assert.equal(completed(judge(okPoints, 'pass', 'ok', [rel('The listing is in France', ' ', 'met', 'screenshot')])).verdict, 'needs_review');
});

test('app_problem, no items due → fail', () => {
  const v = computeVerdict({ judge: null, pageText: '', gaveUp: { class: 'app_problem', reason: 'Button missing' }, skipped: null, reliesOn: [] });
  assert.deepEqual([v.verdict, v.reason], ['fail', 'Button missing']);
});

test('app_problem, due item met → fail', () => {
  const v = computeVerdict({ judge: judge([], 'needs_review', '', [rel('The listing is in France', 'Located in France')]), pageText: '', gaveUp: { class: 'app_problem', reason: 'Button missing' }, skipped: null, reliesOn: due });
  assert.deepEqual([v.verdict, v.reason], ['fail', 'Button missing']);
});

test('app_problem, due item unclear → needs_review', () => {
  const v = computeVerdict({ judge: judge([], 'needs_review', '', [rel('The listing is in France', '', 'unclear')]), pageText: '', gaveUp: { class: 'app_problem', reason: 'Button missing' }, skipped: null, reliesOn: due });
  assert.deepEqual([v.verdict, v.reason], ['needs_review', 'Stopped on a page that may not be the right one: The listing is in France']);
});

test('parseJudgeOutput: missing reliesOn reads as []; malformed reliesOn entry → null', () => {
  assert.deepEqual(parseJudgeOutput('{"keyPoints":[],"verdict":"pass","reason":""}')?.reliesOn, []);
  assert.equal(parseJudgeOutput('{"keyPoints":[],"reliesOn":[{"what":"x","status":"bogus","source":"text"}],"verdict":"pass"}'), null);
  const ok = parseJudgeOutput('{"keyPoints":[],"reliesOn":[{"what":"x","status":"met","evidence":"e","source":"text"}],"verdict":"pass"}');
  assert.deepEqual(ok?.reliesOn, [{ what: 'x', status: 'met', evidence: 'e', source: 'text' }]);
});

const dupFr = rel('The listing is in France', 'Located in France');
const dupNo = rel('the listing IS in france', 'Located in Germany', 'not_met');
test('contradicting duplicate relies_on entries never confirm, in either order', () => {
  assert.equal(completed(judge(okPoints, 'pass', 'ok', [dupFr, dupNo])).verdict, 'needs_review');
  assert.equal(completed(judge(okPoints, 'pass', 'ok', [dupNo, dupFr])).verdict, 'needs_review');
  assert.equal(completed(judge(okPoints, 'pass', 'ok', [dupFr, rel('the listing is in france', 'Located in France')])).verdict, 'pass');
});

test('relies_on quote only on the final page, not on the item page → needs_review and quoteProblems', () => {
  const v = completed(judge(okPoints, 'pass', 'ok', [rel('The listing is in France', 'Final only text')]), due, PAGE + '\nFinal only text');
  assert.equal(v.verdict, 'needs_review');
  assert.deepEqual(v.quoteProblems, ['Final only text']);
});

test('zero-width-only evidence is empty for relies_on and key points', () => {
  assert.equal(completed(judge(okPoints, 'pass', 'ok', [rel('The listing is in France', '\u200B\u200D', 'met', 'screenshot')])).verdict, 'needs_review');
  const v = computeVerdict({ judge: judge([met('price', '\u200B', 'screenshot')]), pageText: PAGE, gaveUp: null, skipped: null, reliesOn: [] });
  assert.deepEqual([v.verdict, v.reason], ['needs_review', 'no evidence given for: price']);
});

test("a judge verdict of not_run is coerced to needs_review (runner-only value)", () => {
  assert.equal(parseJudgeOutput('{"keyPoints":[],"verdict":"not_run","reason":""}')?.verdict, 'needs_review');
});

test('app_problem with a failing relies_on quote fills quoteProblems', () => {
  const v = computeVerdict({ judge: judge([], 'needs_review', '', [rel('The listing is in France', 'Located in Spain')]), pageText: '', gaveUp: { class: 'app_problem', reason: 'x' }, skipped: null, reliesOn: due });
  assert.equal(v.verdict, 'needs_review');
  assert.deepEqual(v.quoteProblems, ['Located in Spain']);
});

test('app_problem with null judge and items due → needs_review', () => {
  const v = computeVerdict({ judge: null, pageText: '', gaveUp: { class: 'app_problem', reason: 'x' }, skipped: null, reliesOn: due });
  assert.deepEqual([v.verdict, v.reason], ['needs_review', 'Stopped on a page that may not be the right one: The listing is in France']);
});

// ---- an item whose snapshot was never captured (pageText null) can never be confirmed ----
const noSnap: DueRely[] = [{ what: 'The listing is in France', pageText: null }];
const screenshotMet = [rel('The listing is in France', 'French flag next to the address', 'met', 'screenshot')];

test('completed, relies_on item without a snapshot → needs_review even if the judge says met from a screenshot', () => {
  const v = completed(judge(okPoints, 'pass', 'ok', screenshotMet), noSnap);
  assert.deepEqual([v.verdict, v.reason, v.quoteProblems], ['needs_review', CANT, []]);
});

test('app_problem, due item without a snapshot → needs_review, never fail, whatever the judge says', () => {
  for (const j of [null, judge([], 'needs_review', '', screenshotMet), judge([], 'needs_review', '', [rel('The listing is in France', 'Located in France')])]) {
    const v = computeVerdict({ judge: j, pageText: '', gaveUp: { class: 'app_problem', reason: 'Button missing' }, skipped: null, reliesOn: noSnap });
    assert.deepEqual([v.verdict, v.reason, v.quoteProblems], ['needs_review', 'Stopped on a page that may not be the right one: The listing is in France', []]);
  }
});

test('checkReliedOn: confirmed, quote problem, no snapshot, missing entry', () => {
  const ok = checkReliedOn(due[0], judge(okPoints, 'pass', 'ok', [rel('the listing is in france', 'Located in France')]));
  assert.deepEqual(ok, { confirmed: true, shown: rel('the listing is in france', 'Located in France'), problem: null, quoteProblems: [] });
  const badQuote = checkReliedOn(due[0], judge(okPoints, 'pass', 'ok', [rel('The listing is in France', 'Located in Spain')]));
  assert.deepEqual(badQuote, { confirmed: false, shown: rel('The listing is in France', 'Located in Spain', 'unclear'), problem: 'quoted text is not on that page', quoteProblems: ['Located in Spain'] });
  const missing = checkReliedOn(noSnap[0], judge(okPoints, 'pass', 'ok', screenshotMet));
  assert.deepEqual(missing, { confirmed: false, shown: { ...screenshotMet[0], status: 'unclear' }, problem: 'no snapshot of this page was captured', quoteProblems: [] });
  const none = checkReliedOn(due[0], judge(okPoints));
  assert.deepEqual(none, { confirmed: false, shown: { what: 'The listing is in France', status: 'unclear', evidence: '', source: 'text' }, problem: 'not checked', quoteProblems: [] });
  const notMet = checkReliedOn(due[0], judge(okPoints, 'pass', 'ok', [rel('The listing is in France', 'Located in Germany', 'not_met')]));
  assert.deepEqual([notMet.confirmed, notMet.shown.status, notMet.problem], [false, 'not_met', null]);
});
