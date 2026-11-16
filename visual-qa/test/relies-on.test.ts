import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dueReliesOn } from '../src/relies-on.ts';

const scenario = { reliesOn: [{ what: 'on the search page', afterStep: 1 }, { what: 'on the listing', afterStep: 2 }, { what: 'the final page', afterStep: null }] };
const cp = (step: number) => ({ step, url: 'https://a.example/', viewportShot: `/r/checkpoint-${step}.jpg`, textFile: `/r/checkpoint-${step}.txt` });
const ev = { url: 'https://a.example/', title: 't', httpStatus: 200, consoleErrors: [], failedRequests: [], textFile: '/r/page-text.txt', viewportShot: '/r/viewport.jpg', fullPageShot: '/r/full.jpg', errorPhrase: null };
const rec = (extra: Record<string, unknown>) => ({ status: 'completed' as const, currentStep: 2, gaveUp: null, evidence: ev, checkpoints: [cp(1), cp(2)], ...extra });
const appProblem = { class: 'app_problem' as const, reason: 'broken' };

test('a completed test owes every item: checkpoints for after_step items, the final page otherwise', () => {
  assert.deepEqual(dueReliesOn(scenario, rec({})), [
    { what: 'on the search page', afterStep: 1, viewportShot: '/r/checkpoint-1.jpg', textFile: '/r/checkpoint-1.txt' },
    { what: 'on the listing', afterStep: 2, viewportShot: '/r/checkpoint-2.jpg', textFile: '/r/checkpoint-2.txt' },
    { what: 'the final page', afterStep: null, viewportShot: '/r/viewport.jpg', textFile: '/r/page-text.txt' },
  ]);
});

test('a completed test whose checkpoint capture failed still owes the item, with no files', () => {
  const due = dueReliesOn(scenario, rec({ checkpoints: [cp(2)] }));
  assert.deepEqual(due[0], { what: 'on the search page', afterStep: 1, viewportShot: null, textFile: null });
  assert.equal(due.length, 3);
});

test('an app_problem give-up owes the after_step items whose step was done, with or without a checkpoint', () => {
  assert.deepEqual(dueReliesOn(scenario, rec({ status: 'gave_up', gaveUp: appProblem, currentStep: 1, evidence: ev, checkpoints: [cp(1)] })), [
    { what: 'on the search page', afterStep: 1, viewportShot: '/r/checkpoint-1.jpg', textFile: '/r/checkpoint-1.txt' },
  ]);
  assert.deepEqual(dueReliesOn(scenario, rec({ status: 'gave_up', gaveUp: appProblem, currentStep: 2, checkpoints: [cp(2)] })), [
    { what: 'on the search page', afterStep: 1, viewportShot: null, textFile: null },
    { what: 'on the listing', afterStep: 2, viewportShot: '/r/checkpoint-2.jpg', textFile: '/r/checkpoint-2.txt' },
  ]);
});

test('an app_problem give-up before the first item step owes nothing; it never owes the final-page item', () => {
  assert.deepEqual(dueReliesOn(scenario, rec({ status: 'gave_up', gaveUp: appProblem, currentStep: 0, checkpoints: [] })), []);
});

test('other give-ups, skipped, not started and cut-off tests owe nothing', () => {
  for (const r of [
    rec({ status: 'gave_up', gaveUp: { class: 'tooling_or_environment', reason: 'x' } }),
    rec({ status: 'gave_up', gaveUp: { class: 'no_matching_page', reason: 'x' } }),
    rec({ status: 'skipped', evidence: null }),
    rec({ status: 'not_started', currentStep: 0, evidence: null, checkpoints: [] }),
    rec({ status: 'running' }),
    rec({ status: 'handback' }),
  ]) assert.deepEqual(dueReliesOn(scenario, r), [], r.status);
});
