import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadSuite, resolveStartUrl, SuiteError } from '../src/scenarios.ts';

function writeYaml(content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vqa-scn-'));
  const file = path.join(dir, 'suite.yaml');
  fs.writeFileSync(file, content);
  return file;
}

const SPEC_EXAMPLE = `
topic: Checkout flow
base_url: https://staging.example.com
session: staging-user
judge_model: haiku
scenarios:
  - id: CO-01
    title: Guest can reach the payment step
    session: none
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

test('valid file: session none maps to null, file session is inherited', () => {
  const suite = loadSuite(writeYaml(SPEC_EXAMPLE));
  assert.equal(suite.topic, 'Checkout flow');
  assert.equal(suite.scenarios[0].session, null);
  assert.equal(suite.scenarios[1].session, 'staging-user');
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
  assert.equal(suite.scenarios[0].session, null);
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

test('judge_model and session names are validated (M8)', () => {
  const problems = problemsOf(`
topic: T
base_url: https://a.example
judge_model: gpt-9
scenarios:
  - {id: A, title: a, start: /, steps: [x], expected: y, session: ../etc}
`);
  assert.ok(problems.includes('judge_model: must be sonnet, haiku, opus or a claude-… model id'), problems.join('\n'));
  assert.ok(problems.includes('A: session name may only contain letters, digits, - and _'), problems.join('\n'));
});
