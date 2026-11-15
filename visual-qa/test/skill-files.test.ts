import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { COMMANDS } from '../bin/qa.ts';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

function split(md: string): { front: Record<string, unknown>; body: string } {
  const m = md.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  assert.ok(m, 'SKILL.md starts with YAML frontmatter');
  return { front: parse(m[1]), body: m[2] };
}

test('frontmatter: manual-only, runs on sonnet, named visual-qa', () => {
  const { front } = split(read('SKILL.md'));
  assert.equal(front.name, 'visual-qa');
  assert.equal(front['disable-model-invocation'], true);
  assert.equal(front.model, 'sonnet');
  assert.match(String(front['allowed-tools']), /Bash\(node \$\{CLAUDE_SKILL_DIR\}\/bin\/qa\.ts \*\)/);
});

test('body passes the session id and uses the attribution descriptions', () => {
  const { body } = split(read('SKILL.md'));
  assert.ok(body.includes('${CLAUDE_SESSION_ID}'));
  assert.ok(body.includes('QA takeover <id>'));
  assert.ok(body.includes('QA judge <id>'));
});

test('every qa command the skill and briefs use exists in the CLI', () => {
  const used = new Set<string>();
  for (const f of ['SKILL.md', 'reference/takeover.md', 'reference/judge.md']) {
    for (const m of read(f).matchAll(/qa\.ts ([a-z][a-z-]*)/g)) used.add(m[1]);
    for (const m of read(f).matchAll(/\{\{QA\}\} ([a-z][a-z-]*)/g)) used.add(m[1]);
  }
  assert.ok(used.size >= 8, [...used].join(','));
  for (const c of used) assert.ok((COMMANDS as readonly string[]).includes(c), `unknown command "${c}"`);
});

test('the judge brief never mentions how the steps were executed', () => {
  assert.doesNotMatch(read('reference/judge.md'), /jev|takeover|action log/i);
});

test('SKILL.md body stays short', () => {
  assert.ok(split(read('SKILL.md')).body.split('\n').length < 120);
});
