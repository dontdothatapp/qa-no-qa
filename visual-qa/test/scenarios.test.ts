import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { groupOrder, loadSuite, resolveStartUrl, SuiteError } from '../src/scenarios.ts';

function writeYaml(content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vqa-scn-'));
  const file = path.join(dir, 'suite.yaml');
  fs.writeFileSync(file, content);
  return file;
}

const SPEC_EXAMPLE = `
topic: Checkout flow
base_url: https://staging.example.com
judge_model: haiku
scenarios:
  - id: CO-01
    title: Guest can reach the payment step
    start: /products/backpack
    steps:
      - Click "Add to cart"
      - Open the cart and click "Checkout"
    values:
      Full name: Test User
      Postcode: 10115
    expected: Payment form is visible with card fields
  - id: CO-02
    title: Logged-in user sees account
    start: https://other.example.com/account
    steps: [Open "Account"]
    expected: Account page shows the user's name
`;

function problemsOf(yaml: string): string[] {
  try {
    loadSuite(writeYaml(yaml));
  } catch (e) {
    assert.ok(e instanceof SuiteError, `expected SuiteError, got ${e}`);
    return e.problems;
  }
  assert.fail('expected loadSuite to throw');
}

test('valid file: parses topic, judge model and scenarios', () => {
  const suite = loadSuite(writeYaml(SPEC_EXAMPLE));
  assert.equal(suite.topic, 'Checkout flow');
  assert.equal(suite.scenarios.length, 2);
  assert.equal(suite.judgeModel, 'haiku');
});

test('defaults: allowHosts, viewport, judgeModel', () => {
  const suite = loadSuite(writeYaml(`
topic: T
base_url: https://staging.example.com:8443/app
scenarios:
  - id: A
    title: a
    start: /
    steps: [x]
    expected: y
`));
  assert.deepEqual(suite.allowHosts, ['staging.example.com:8443']);
  assert.deepEqual(suite.viewport, { width: 1280, height: 800 });
  assert.equal(suite.judgeModel, 'sonnet');
  assert.deepEqual(suite.scenarios[0].values, {});
});

test('numeric YAML values become strings', () => {
  const suite = loadSuite(writeYaml(SPEC_EXAMPLE));
  assert.equal(suite.scenarios[0].values.Postcode, '10115');
});

test('resolveStartUrl joins paths to base_url and keeps full URLs', () => {
  const suite = loadSuite(writeYaml(SPEC_EXAMPLE));
  assert.equal(resolveStartUrl(suite, suite.scenarios[0]), 'https://staging.example.com/products/backpack');
  assert.equal(resolveStartUrl(suite, suite.scenarios[1]), 'https://other.example.com/account');
});

test('all problems are reported together with exact messages', () => {
  const problems = problemsOf(`
topic: T
base_url: not a url
scenarios:
  - id: CO-01
    title: a
    start: /
    steps: [x]
    expected: y
  - id: CO-01
    title: dup
    start: /
    steps: [x]
    expected: y
  - id: CO-02
    title: b
    start: /
    steps: [x]
  - id: CO-03
    title: c
    start: /
    steps: []
    expected: z
  - id: "bad id!"
    title: d
    start: /
    steps: [x]
    expected: z
`);
  assert.ok(problems.includes('base_url: not a valid URL'), problems.join('\n'));
  assert.ok(problems.includes('CO-01: duplicate id'), problems.join('\n'));
  assert.ok(problems.includes('CO-02: missing "expected"'), problems.join('\n'));
  assert.ok(problems.includes('CO-03: steps must be a non-empty list'), problems.join('\n'));
  assert.ok(problems.includes('bad id!: id may only contain letters, digits, - and _'), problems.join('\n'));
});

test('missing scenarios list is a problem', () => {
  const problems = problemsOf('topic: T\nbase_url: https://a.example\n');
  assert.ok(problems.includes('scenarios: must be a non-empty list'), problems.join('\n'));
});

test('allow_hosts always keeps the base_url host (M5)', () => {
  const suite = loadSuite(writeYaml(`
topic: T
base_url: https://staging.example.com
allow_hosts: [auth.example.com]
scenarios:
  - {id: A, title: a, start: /, steps: [x], expected: y}
`));
  assert.deepEqual(suite.allowHosts, ['staging.example.com', 'auth.example.com']);
});

test('judge_model is validated (M8)', () => {
  const problems = problemsOf(`
topic: T
base_url: https://a.example
judge_model: gpt-9
scenarios:
  - {id: A, title: a, start: /, steps: [x], expected: y}
`);
  assert.ok(problems.includes('judge_model: must be sonnet, haiku, opus or a claude-… model id'), problems.join('\n'));
});

test('password values are rejected: passwords are not supported', () => {
  const problems = problemsOf(`
topic: T
base_url: https://a.example
scenarios:
  - {id: A, title: a, start: /, steps: [x], expected: y, values: {Password: hunter2, PIN code: "1234", Name: ok}}
`);
  assert.ok(problems.includes('A: passwords are not supported in values ("Password") — use a signed-in browser session'), problems.join('\n'));
  assert.ok(problems.includes('A: passwords are not supported in values ("PIN code") — use a signed-in browser session'), problems.join('\n'));
  assert.equal(problems.length, 2);
});

const BASE = 'topic: T\nbase_url: https://a.example\n';

test('parses notes, groups, source, relies_on and logged_out', () => {
  const suite = loadSuite(writeYaml(`
topic: T
base_url: https://a.example
notes: "PBSA IDs: a, b"
groups:
  - {id: g1, needs: Flag ON}
  - {id: g2, needs: Flag OFF}
scenarios:
  - id: A
    title: a
    group: g1
    source: "☐ French listing → address shows"
    logged_out: true
    start: /
    steps: [x, y]
    relies_on:
      - {what: The listing is in France, after_step: 1}
      - {what: Shown on the final page}
    expected: z
  - {id: B, title: b, group: g2, start: /, steps: [x], expected: z}
`));
  assert.equal(suite.notes, 'PBSA IDs: a, b');
  assert.deepEqual(suite.groups, [{ id: 'g1', needs: 'Flag ON' }, { id: 'g2', needs: 'Flag OFF' }]);
  const s = suite.scenarios[0];
  assert.equal(s.group, 'g1');
  assert.equal(s.source, '☐ French listing → address shows');
  assert.deepEqual(s.reliesOn, [
    { what: 'The listing is in France', afterStep: 1 },
    { what: 'Shown on the final page', afterStep: null },
  ]);
  assert.equal(s.loggedOut, true);
});

test('defaults: no notes, no groups, no relies_on, signed in', () => {
  const suite = loadSuite(writeYaml(`${BASE}scenarios:\n  - {id: A, title: a, start: /, steps: [x], expected: y}\n`));
  assert.equal(suite.notes, null);
  assert.deepEqual(suite.groups, []);
  const s = suite.scenarios[0];
  assert.equal(s.group, null);
  assert.equal(s.source, null);
  assert.deepEqual(s.reliesOn, []);
  assert.equal(s.loggedOut, false);
});

test('groupOrder: declared groups in order; no groups → one default group', () => {
  const grouped = loadSuite(writeYaml(`${BASE}groups:
  - {id: g1, needs: Flag ON}
  - {id: g2, needs: Flag OFF}
scenarios:
  - {id: A, title: a, group: g2, start: /, steps: [x], expected: y}
  - {id: B, title: b, group: g1, start: /, steps: [x], expected: y}
  - {id: C, title: c, group: g2, start: /, steps: [x], expected: y}
`));
  assert.deepEqual(groupOrder(grouped), [
    { id: 'g1', needs: 'Flag ON', scenarios: ['B'] },
    { id: 'g2', needs: 'Flag OFF', scenarios: ['A', 'C'] },
  ]);
  const plain = loadSuite(writeYaml(`${BASE}scenarios:
  - {id: A, title: a, start: /, steps: [x], expected: y}
  - {id: B, title: b, start: /, steps: [x], expected: y}
`));
  assert.deepEqual(groupOrder(plain), [{ id: 'default', needs: null, scenarios: ['A', 'B'] }]);
});

test('old fields are rejected with what replaced them', () => {
  const problems = problemsOf(`topic: T
base_url: https://a.example
browser: isolated
session: staging-user
scenarios:
  - {id: A, title: a, start: /, steps: [x], expected: y, session: none}
`);
  assert.ok(problems.includes('browser: no longer supported — tests always run in your Chrome (use logged_out: true for signed-out tests)'), problems.join('\n'));
  assert.ok(problems.includes('session: no longer supported — tests use your Chrome sign-ins (use logged_out: true for signed-out tests)'), problems.join('\n'));
  assert.ok(problems.includes('A: session: no longer supported — tests use your Chrome sign-ins (use logged_out: true for signed-out tests)'), problems.join('\n'));
});

test('invalid groups and relies_on are reported together', () => {
  const problems = problemsOf(`${BASE}groups:
  - {id: g1}
  - {id: g1, needs: dup}
scenarios:
  - id: S1
    title: a
    group: g9
    start: /
    steps: [x, y]
    relies_on:
      - {what: ok, after_step: 5}
      - {after_step: 1}
    expected: z
  - {id: S2, title: b, start: /, steps: [x], expected: z}
`);
  for (const p of [
    'S1: group "g9" is not defined in groups',
    'S2: missing "group" (every scenario needs one when groups are defined)',
    'S1: relies_on[0].after_step must be a step number from 1 to 2',
    'S1: relies_on[1]: missing "what"',
    'groups[1]: duplicate id "g1"',
    'groups[0]: missing "needs"',
  ]) assert.ok(problems.includes(p), `${p}\n${problems.join('\n')}`);
});
