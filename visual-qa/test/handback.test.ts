import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, effectiveOperation, type DecisionContext } from '../src/handback.ts';
import type { JevAnswer } from '../src/jev-client.ts';
import type { Control } from '../src/snapshot.ts';

const button = (name = 'Continue', isSubmit = false): Control => ({ ref: 3, frame: 0, role: 'button', name, inputType: null, value: null, state: null, context: null, inViewport: true, isPassword: false, isSubmit, formSubmitLabel: null });
const field = (name = 'Name', isPassword = false, formSubmitLabel: string | null = null): Control => ({ ref: 4, frame: 0, role: 'textbox', name, inputType: isPassword ? 'password' : 'text', value: '', state: null, context: null, inViewport: true, isPassword, isSubmit: false, formSubmitLabel });

function answer(p: Partial<JevAnswer>): JevAnswer {
  return { operation: 'click', opConfidence: 0.95, opProbabilities: {}, target: 3, targetConfidence: 0.95, usage: { inputTokens: 1, outputTokens: 1 }, latencyMs: 1, ...p };
}

function ctx(p: Partial<DecisionContext>): DecisionContext {
  return { answer: answer({}), target: button(), enterField: null, stepText: 'Click "Continue"', stepActions: 0, scenarioActions: 0, unchangedAfterLastTwo: false, sameActionThreeTimes: false, valueAvailable: true, ...p };
}

test('confident click proceeds', () => assert.equal(evaluate(ctx({})), null));
test('blocked → jev_blocked', () => assert.equal(evaluate(ctx({ answer: answer({ operation: 'blocked', target: null }), target: null }))?.handback, 'jev_blocked'));
test('blocked wins over low confidence', () =>
  assert.equal(evaluate(ctx({ answer: answer({ operation: 'blocked', opConfidence: 0.2 }) }))?.handback, 'jev_blocked'));
test('low op confidence → low_confidence', () => assert.equal(evaluate(ctx({ answer: answer({ opConfidence: 0.5 }) }))?.handback, 'low_confidence'));
test('low target confidence on a click → low_confidence', () =>
  assert.equal(evaluate(ctx({ answer: answer({ targetConfidence: 0.4 }) }))?.handback, 'low_confidence'));
test('low target confidence ignored for done', () =>
  assert.equal(evaluate(ctx({ answer: answer({ operation: 'done', target: null, targetConfidence: 0.1 }), target: null })), null));
test('low confidence done → low_confidence', () =>
  assert.equal(evaluate(ctx({ answer: answer({ operation: 'done', opConfidence: 0.45, target: null }), target: null }))?.handback, 'low_confidence'));
test('click without target → low_confidence', () =>
  assert.equal(evaluate(ctx({ answer: answer({ target: null }), target: null }))?.handback, 'low_confidence'));
test('press_enter needs no target', () =>
  assert.equal(evaluate(ctx({ answer: answer({ operation: 'press_enter', target: null, targetConfidence: 0.06 }), target: null, stepText: 'Search for "x"' })), null));
test('press_enter in a step that never asks to enter/submit → risky_target (C2)', () =>
  assert.equal(evaluate(ctx({ answer: answer({ operation: 'press_enter', target: null }), target: null, enterField: field('Coupon'), stepText: 'Fill the coupon field' }))?.handback, 'risky_target'));
test('press_enter that would submit a "Place order" form → risky_target (C2)', () =>
  assert.equal(evaluate(ctx({ answer: answer({ operation: 'press_enter', target: null }), target: null, enterField: field('Coupon', false, 'Place order'), stepText: 'Enter "SAVE10" in the coupon field' }))?.handback, 'risky_target'));
test('press_enter submitting a search form → proceed', () =>
  assert.equal(evaluate(ctx({ answer: answer({ operation: 'press_enter', target: 4 }), target: field('Search', false, 'Go'), enterField: field('Search', false, 'Go'), stepText: 'Search for "espresso"' })), null));
test('clicking a submit button the step did not ask for → risky_target (I11)', () =>
  assert.equal(evaluate(ctx({ target: button('Send', true), stepText: 'Fill the contact form' }))?.handback, 'risky_target'));
test('clicking the submit button the step names → proceed', () =>
  assert.equal(evaluate(ctx({ target: button('Send', true), stepText: 'Click "Send"' })), null));
test('typing into a "Confirm email" field is not risky (M2)', () =>
  assert.equal(evaluate(ctx({ answer: answer({ operation: 'type', target: 4 }), target: field('Confirm email'), stepText: 'Fill the form' })), null));
test('type without a value → needs_text', () =>
  assert.equal(evaluate(ctx({ answer: answer({ operation: 'type', target: 4 }), target: field(), valueAvailable: false }))?.handback, 'needs_text'));
test('password field without a value → needs_text', () =>
  assert.equal(evaluate(ctx({ answer: answer({ operation: 'type', target: 4 }), target: field('Password', true), valueAvailable: false }))?.handback, 'needs_text'));
test('risky target not asked for → risky_target', () =>
  assert.equal(evaluate(ctx({ target: button('Place order'), stepText: 'Click "Continue"' }))?.handback, 'risky_target'));
test('risky target the step asks for → proceed', () =>
  assert.equal(evaluate(ctx({ target: button('Delete account'), stepText: 'Click Delete account' })), null));
test('no progress → no_progress', () => {
  assert.equal(evaluate(ctx({ unchangedAfterLastTwo: true }))?.handback, 'no_progress');
  assert.equal(evaluate(ctx({ sameActionThreeTimes: true }))?.handback, 'no_progress');
});
test('budgets', () => {
  assert.equal(evaluate(ctx({ stepActions: 8 }))?.handback, 'step_budget');
  assert.equal(evaluate(ctx({ stepActions: 1, scenarioActions: 40 }))?.handback, 'scenario_budget');
});
test('done is exempt from no-progress and budgets', () =>
  assert.equal(evaluate(ctx({ answer: answer({ operation: 'done', target: null }), target: null, stepActions: 8, unchangedAfterLastTwo: true })), null));

test('click/type split on a text field merges into a confident type', () => {
  const a = answer({ operation: 'type', opConfidence: 0.47, opProbabilities: { click: 0.46, type: 0.54 }, target: 4, targetConfidence: 1 });
  assert.deepEqual(effectiveOperation(a, field()), { operation: 'type', confidence: 1 });
  assert.equal(evaluate(ctx({ answer: a, target: field() })), null);
});
test('click on a button is never turned into type', () => {
  const a = answer({ operation: 'click', opConfidence: 0.47, opProbabilities: { click: 0.53, type: 0.47 } });
  assert.deepEqual(effectiveOperation(a, button()), { operation: 'click', confidence: 0.47 });
});
