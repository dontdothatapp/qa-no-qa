import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildJevRequest } from '../src/decide.ts';
import type { Control, Snapshot } from '../src/snapshot.ts';

function control(ref: number, inViewport: boolean, name = `Item ${ref}`): Control {
  return { ref, frame: 0, role: 'link', name, inputType: null, value: null, state: null, context: null, inViewport, isPassword: false, isSubmit: false, formSubmitLabel: null };
}

function snapshot(controls: Control[], text = 'hello'): Snapshot {
  return { url: 'https://a.example/', title: 'A', controls, text, hash: 'h' };
}

type Criteria = Record<string, unknown>;
const targetCriteria = (req: ReturnType<typeof buildJevRequest>) =>
  (req.questions.target as { criteria: Criteria }).criteria;

test('target choice is capped at 254 controls + none, in-viewport first', () => {
  // 300 controls; only refs 291..300 are in the viewport (worst case: at the end)
  const controls = Array.from({ length: 300 }, (_, i) => control(i + 1, i >= 290));
  const req = buildJevRequest(snapshot(controls), 'Open item 295', []);
  const keys = Object.keys(targetCriteria(req));
  assert.equal(keys.length, 255);
  assert.ok(keys.includes('none'));
  for (let r = 291; r <= 300; r++) assert.ok(keys.includes(String(r)), `in-viewport ref ${r} kept`);
  assert.equal((req.state.controls as string[]).length, 254);
});

test('page text is trimmed to 3000 chars and non-ASCII is untouched', () => {
  const req = buildJevRequest(snapshot([control(1, true, 'Straße')], 'x'.repeat(5000)), 'Fill Straße', ['typed "a"']);
  assert.ok((req.state.page_text as string).length <= 3000);
  assert.ok((req.state.controls as string[])[0].includes('Straße'));
  assert.equal(req.state.step_goal, 'Fill Straße');
  assert.deepEqual(req.state.actions_so_far, ['typed "a"']);
});

test('operation choice offers exactly the eight operations', () => {
  const req = buildJevRequest(snapshot([control(1, true)]), 'Click Item 1', []);
  const op = req.questions.operation as { type: string; criteria: Criteria };
  assert.equal(op.type, 'choice');
  assert.deepEqual(Object.keys(op.criteria).sort(), ['blocked', 'click', 'done', 'press_enter', 'scroll', 'select', 'type', 'wait']);
});
