import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { COMMANDS } from '../bin/qa.ts';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const TEST_SKILL = 'skills/test/SKILL.md';
const SETUP_SKILL = 'skills/setup/SKILL.md';

function split(md: string): { front: Record<string, unknown>; body: string } {
  const m = md.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  assert.ok(m, 'SKILL.md starts with YAML frontmatter');
  return { front: parse(m[1]), body: m[2] };
}

test('test skill frontmatter: named test, runs on sonnet, model invocation on, plugin-root qa command allowed', () => {
  const { front } = split(read(TEST_SKILL));
  assert.equal(front.name, 'test');
  assert.equal(front.model, 'sonnet');
  assert.ok(!('disable-model-invocation' in front));
  assert.match(String(front['allowed-tools']), /Bash\(node \$\{CLAUDE_PLUGIN_ROOT\}\/bin\/qa\.ts \*\)/);
});

test('body passes the session id and uses the attribution descriptions', () => {
  const { body } = split(read(TEST_SKILL));
  assert.ok(body.includes('${CLAUDE_SESSION_ID}'));
  assert.ok(body.includes('QA takeover <id>'));
  assert.ok(body.includes('QA judge <id>'));
});

test('every qa command the skill and briefs use exists in the CLI', () => {
  const used = new Set<string>();
  for (const f of [TEST_SKILL, SETUP_SKILL, 'reference/takeover.md', 'reference/judge.md', 'reference/intake.md']) {
    for (const m of read(f).matchAll(/qa\.ts ([a-z][a-z-]*)/g)) used.add(m[1]);
    for (const m of read(f).matchAll(/\{\{QA\}\} ([a-z][a-z-]*)/g)) used.add(m[1]);
  }
  assert.ok(used.size >= 8, [...used].join(','));
  for (const c of used) assert.ok((COMMANDS as readonly string[]).includes(c), `unknown command "${c}"`);
});

test('the judge brief never mentions how the steps were executed', () => {
  assert.doesNotMatch(read('reference/judge.md'), /jev|takeover|action log/i);
});

test('test skill body stays short', () => {
  assert.ok(split(read(TEST_SKILL)).body.split('\n').length < 120);
});

test('judge brief: login walls and blank pages are unclear, not failures (I6)', () => {
  const j = read('reference/judge.md');
  assert.match(j, /login wall[^\n]*unclear/i);
  assert.match(j, /blank page[^\n]*unclear/i);
});

test('takeover brief covers side effects and the risky/host hand-backs (I10)', () => {
  const t = read('reference/takeover.md');
  assert.match(t, /do not submit, buy, delete/i);
  assert.match(t, /risky_target/);
  assert.match(t, /left_allowed_hosts/);
});

test('test skill says what to do on runner errors (I12)', () => {
  const { body } = split(read(TEST_SKILL));
  assert.ok(body.includes('{"error"'));
  assert.match(body, /already active/);
  assert.match(body, /including the current one/);
});

test('judge brief: text evidence is only the copied words', () => {
  assert.match(read('reference/judge.md'), /only the exact words/i);
});

test('test skill reminds about Allow; the privacy note moved to setup', () => {
  const { body } = split(read(TEST_SKILL));
  assert.match(body, /Allow/);
  assert.doesNotMatch(body, /signed-in pages/);
  assert.doesNotMatch(body, /real accounts/);
});

test('test skill continues paused runs, reopens a stopped run and skips tests', () => {
  const { body } = split(read(TEST_SKILL));
  for (const c of ['qa.ts remaining', 'qa.ts reopen', 'qa.ts skip']) assert.ok(body.includes(c), c);
});

test('marketplace and plugin manifests name qa-no-qa and visual-qa, and the source points at ./visual-qa', () => {
  const market = JSON.parse(read('../.claude-plugin/marketplace.json'));
  assert.equal(market.name, 'qa-no-qa');
  assert.equal(market.plugins.length, 1);
  assert.equal(market.plugins[0].name, 'visual-qa');
  assert.equal(market.plugins[0].source, './visual-qa');
  const plugin = JSON.parse(read('.claude-plugin/plugin.json'));
  assert.equal(plugin.name, 'visual-qa');
  assert.equal(plugin.description, market.plugins[0].description);
  assert.ok(!('version' in plugin));
});

test('setup skill never asks for the key in chat', () => {
  const { front, body } = split(read(SETUP_SKILL));
  assert.equal(front.name, 'setup');
  assert.match(body, /never ask for the key in chat/i);
});

const section = (body: string, heading: string) => {
  const start = body.indexOf(heading);
  assert.ok(start >= 0, heading);
  const next = body.indexOf('\n## ', start + heading.length);
  return body.slice(start, next < 0 ? undefined : next);
};

test('test skill pins the start flags for new and continued runs', () => {
  const { body } = split(read(TEST_SKILL));
  assert.match(body, /`qa\.ts start <file> --session \$\{CLAUDE_SESSION_ID\}`/);
  assert.match(body, /`qa\.ts start <testsFile> --session \$\{CLAUDE_SESSION_ID\} --only <[^>]+> --continues <runDir>`/);
});

test('test skill sends the Allow line before qa.ts start, and judges + reports before the pause message', () => {
  const { body } = split(read(TEST_SKILL));
  const start = section(body, '## 4. Start');
  assert.ok(start.indexOf('**Allow**') >= 0 && start.indexOf('**Allow**') < start.indexOf('qa.ts start'), 'Allow line before start');
  const groups = section(body, '## 5.');
  const pause = groups.indexOf('Say go');
  assert.ok(pause > 0, 'pause message');
  assert.ok(groups.indexOf('Judge the tests finished so far') >= 0 && groups.indexOf('Judge the tests finished so far') < pause, 'judge before pause');
  assert.ok(groups.indexOf('qa.ts report') >= 0 && groups.indexOf('qa.ts report') < pause, 'report before pause');
});

test('continue starts the run before offering go/skip, and a failed reopen ends the run instead of looping', () => {
  const { body } = split(read(TEST_SKILL));
  const cont = section(body, '## 2. Continue');
  assert.doesNotMatch(cont, /say go, or skip/i);
  assert.match(cont, /before the first group too/);
  assert.match(body, /`qa\.ts reopen` itself fails/);
  assert.match(body, /remote debugging is off/);
});

test('test skill tells Claude how to resolve the plugin folder in the setup file it reads', () => {
  const { body } = split(read(TEST_SKILL));
  assert.match(body, /`CLAUDE_PLUGIN_ROOT` variable/);
  assert.match(body, /Skip its step 1/);
});

test('setup skill waits for Chrome with a number of seconds and stops instead of looping', () => {
  const { body } = split(read(SETUP_SKILL));
  assert.match(body, /--wait-chrome \d+/);
  assert.doesNotMatch(body, /--wait-chrome(?! \d)/);
  assert.match(body, /same `detail`/);
});

test('scenario format and intake examples use block-style list items, never {...}', () => {
  for (const f of ['reference/scenario-format.md', 'reference/intake.md']) {
    for (const block of read(f).matchAll(/```yaml\n([\s\S]*?)```/g)) assert.doesNotMatch(block[1], /^\s*- \{/m, f);
  }
});

test('chrome-mode wording: sign-in advice, connection errors, tabs come to the front', () => {
  assert.match(read('reference/takeover.md'), /sign in to the site in your Chrome/);
  const { body } = split(read(TEST_SKILL));
  assert.match(body, /did not allow the connection/);
  assert.match(body, /come to the front/);
  assert.doesNotMatch(body, /110 s/);
});

test("intake brief: one message for all questions, relies_on with after_step, source verbatim, groups as instructions, won't test, file paths", () => {
  const i = read('reference/intake.md');
  for (const re of [/one message/i, /relies_on/, /after_step/, /verbatim/i, /won't test/i, /~\/QA\/scenarios\/<topic>\.yaml/, /\.checklist\.txt/, /logged_out: true/]) {
    assert.match(i, re);
  }
});

test('judge brief: judges reliesOn with the same quoting rule and supports relies_on_only', () => {
  const j = read('reference/judge.md');
  assert.match(j, /reliesOn/);
  assert.match(j, /relies_on_only/);
  assert.match(j, /copy .*what.* exactly/i);
});

test('takeover brief: has {{NOTES}}, no_matching_page, and no qa login', () => {
  const t = read('reference/takeover.md');
  assert.match(t, /\{\{NOTES\}\}/);
  assert.match(t, /no_matching_page/);
  assert.doesNotMatch(t, /qa login/);
});

test('briefs: relies_on_only gives empty keyPoints, takeover has Background, intake numbers questions and forbids asking what pages show', () => {
  assert.match(read('reference/judge.md'), /relies_on_only[^\n]*keyPoints":\[\]|keyPoints":\[\][^\n]*relies_on_only/);
  assert.match(read('reference/takeover.md'), /## Background/);
  const i = read('reference/intake.md');
  assert.match(i, /numbered/i);
  assert.match(i, /never ask what a page shows/i);
  assert.match(i, /make that link the scenario's `start`/i);
});

test("group loop: a skipped test moves on, pauses count only tests that will run, and an all-won't-test group doesn't pause", () => {
  const groups = section(split(read(TEST_SKILL)).body, '## 5.');
  assert.match(groups, /`"status":"skipped"` → next test/);
  assert.match(groups, /N counts only the tests that will run/);
  assert.match(groups, /only won't-test checks[^\n]*no pause/i);
});

test('intake uses the checklist from the message when $ARGUMENTS is empty or a summary, and saves their own words', () => {
  const intake = section(split(read(TEST_SKILL)).body, '## 3. Intake');
  assert.doesNotMatch(intake, /Nothing was pasted → ask/);
  assert.match(intake, /`\$ARGUMENTS` is empty or a summary/);
  assert.match(intake, /ask only if there is none/);
  assert.match(intake, /verbatim, not a paraphrase/);
});

test('scenario format: notes go to takeovers, not the report', () => {
  const line = read('reference/scenario-format.md').split('\n').find((l) => l.startsWith('notes:'))!;
  assert.doesNotMatch(line, /shown in the report/);
  assert.match(line, /takes? over/);
});

test('key wording: paste right after TYPESAFE_API_KEY=, on the same line (setup skill and README)', () => {
  assert.match(split(read(SETUP_SKILL)).body, /right after `TYPESAFE_API_KEY=`, on the same line/);
  assert.match(read('../README.md'), /right after `TYPESAFE_API_KEY=`, on the same line/);
});

test('README: the install line is in a four-backtick text copy box, verbatim, with the slash-command fallback under it', () => {
  const readme = read('../README.md');
  const line = "Install Visual QA: if Node.js 22.18 or newer isn't installed, install it. Then run `claude plugin marketplace add dontdothatapp/qa-no-qa` and `claude plugin install visual-qa@qa-no-qa`, and tell me to type /reload-plugins and then /visual-qa:setup.";
  assert.ok(readme.includes(`\`\`\`\`text\n${line}\n\`\`\`\`\n`), 'copy box');
  assert.ok(readme.includes("If Claude says the `claude` command isn't found (e.g. in the desktop app), type `/plugin marketplace add dontdothatapp/qa-no-qa` and then `/plugin install visual-qa@qa-no-qa` yourself, then continue with `/reload-plugins`."));
});
