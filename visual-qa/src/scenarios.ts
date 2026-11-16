import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { DEFAULTS } from './config.ts';
import type { Group, RelyItem, Scenario, Suite, Viewport } from './types.ts';

const BROWSER_GONE = 'no longer supported — tests always run in your Chrome (use logged_out: true for signed-out tests)';
const SESSION_GONE = 'no longer supported — tests use your Chrome sign-ins (use logged_out: true for signed-out tests)';

export class SuiteError extends Error {
  problems: string[];
  constructor(problems: string[]) {
    super(`Invalid scenario file:\n- ${problems.join('\n- ')}`);
    this.name = 'SuiteError';
    this.problems = problems;
  }
}

type Raw = Record<string, unknown>;
const isObject = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null =>
  typeof v === 'string' ? v.trim() || null : typeof v === 'number' ? String(v) : null;

function validUrl(v: string | null): URL | null {
  if (!v) return null;
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u : null;
  } catch {
    return null;
  }
}

export function loadSuite(file: string): Suite {
  const problems: string[] = [];
  let doc: unknown;
  try {
    doc = parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new SuiteError([`file: ${(e as Error).message}`]);
  }
  if (!isObject(doc)) throw new SuiteError(['file: expected a YAML mapping at the top level']);

  const topic = str(doc.topic);
  if (!topic) problems.push('topic: missing');
  const baseUrlRaw = str(doc.base_url);
  const baseUrl = validUrl(baseUrlRaw);
  if (!baseUrl) problems.push('base_url: not a valid URL');

  let viewport: Viewport = { ...DEFAULTS.viewport };
  if (doc.viewport !== undefined) {
    const v = doc.viewport;
    if (isObject(v) && Number.isInteger(v.width) && Number.isInteger(v.height)) {
      viewport = { width: v.width as number, height: v.height as number };
    } else {
      problems.push('viewport: needs integer width and height');
    }
  }

  let allowHosts: string[] = baseUrl ? [baseUrl.host] : [];
  if (doc.allow_hosts !== undefined) {
    if (Array.isArray(doc.allow_hosts) && doc.allow_hosts.every((h) => typeof h === 'string')) {
      allowHosts = [...new Set([...allowHosts, ...(doc.allow_hosts as string[])])];
    } else {
      problems.push('allow_hosts: must be a list of host names');
    }
  }

  if (doc.browser !== undefined) problems.push(`browser: ${BROWSER_GONE}`);
  if (doc.session !== undefined) problems.push(`session: ${SESSION_GONE}`);
  const notes = str(doc.notes);

  const groups: Group[] = [];
  if (doc.groups !== undefined) {
    if (!Array.isArray(doc.groups)) {
      problems.push('groups: must be a list of {id, needs}');
    } else {
      doc.groups.forEach((g: unknown, i: number) => {
        if (!isObject(g)) {
          problems.push(`groups[${i}]: must be a mapping`);
          return;
        }
        const gid = str(g.id);
        const needs = str(g.needs);
        if (!gid) problems.push(`groups[${i}]: missing "id"`);
        else if (groups.some((x) => x.id === gid)) problems.push(`groups[${i}]: duplicate id "${gid}"`);
        if (!needs) problems.push(`groups[${i}]: missing "needs"`);
        if (gid) groups.push({ id: gid, needs: needs ?? '' });
      });
    }
  }
  const judgeModel = str(doc.judge_model) ?? 'sonnet';
  if (!/^(sonnet|haiku|opus|inherit|claude-[a-z0-9.-]+)$/.test(judgeModel)) {
    problems.push('judge_model: must be sonnet, haiku, opus or a claude-… model id');
  }

  const scenarios: Scenario[] = [];
  if (!Array.isArray(doc.scenarios) || doc.scenarios.length === 0) {
    problems.push('scenarios: must be a non-empty list');
  } else {
    const seen = new Set<string>();
    doc.scenarios.forEach((raw: unknown, i: number) => {
      if (!isObject(raw)) {
        problems.push(`scenarios[${i}]: must be a mapping`);
        return;
      }
      const id = str(raw.id) ?? `scenarios[${i}]`;
      if (!str(raw.id)) problems.push(`${id}: missing "id"`);
      else if (!/^[A-Za-z0-9_-]+$/.test(id)) problems.push(`${id}: id may only contain letters, digits, - and _`);
      if (seen.has(id)) problems.push(`${id}: duplicate id`);
      seen.add(id);

      const title = str(raw.title);
      if (!title) problems.push(`${id}: missing "title"`);
      const start = str(raw.start);
      if (!start) problems.push(`${id}: missing "start"`);
      const expected = str(raw.expected);
      if (!expected) problems.push(`${id}: missing "expected"`);

      const steps = Array.isArray(raw.steps) ? raw.steps.map(str) : null;
      if (!steps || steps.length === 0 || steps.some((s) => s === null)) {
        problems.push(`${id}: steps must be a non-empty list`);
      }

      const values: Record<string, string> = {};
      if (raw.values !== undefined) {
        if (isObject(raw.values)) {
          for (const [k, v] of Object.entries(raw.values)) {
            const s = str(v);
            if (/\b(pass(word|code|phrase)?|pwd|pw|pin)\b/i.test(k.replace(/[_-]+/g, ' '))) {
              problems.push(`${id}: passwords are not supported in values ("${k}") — use a signed-in browser session`);
            } else if (s === null) problems.push(`${id}: value for "${k}" must be text or a number`);
            else values[k] = s;
          }
        } else {
          problems.push(`${id}: values must be a mapping of field label to value`);
        }
      }

      if (raw.session !== undefined) problems.push(`${id}: session: ${SESSION_GONE}`);
      if (raw.browser !== undefined) problems.push(`${id}: browser: ${BROWSER_GONE}`);

      let group: string | null = null;
      if (groups.length > 0) {
        group = str(raw.group);
        if (!group) problems.push(`${id}: missing "group" (every scenario needs one when groups are defined)`);
        else if (!groups.some((g) => g.id === group)) problems.push(`${id}: group "${group}" is not defined in groups`);
      } else if (raw.group !== undefined) {
        group = str(raw.group);
        problems.push(`${id}: group "${group}" is not defined in groups`);
      }

      const reliesOn: RelyItem[] = [];
      if (raw.relies_on !== undefined) {
        if (!Array.isArray(raw.relies_on)) {
          problems.push(`${id}: relies_on must be a list`);
        } else {
          raw.relies_on.forEach((r: unknown, j: number) => {
            if (!isObject(r)) {
              problems.push(`${id}: relies_on[${j}] must be a mapping`);
              return;
            }
            const what = str(r.what);
            if (!what) problems.push(`${id}: relies_on[${j}]: missing "what"`);
            let afterStep: number | null = null;
            if (r.after_step !== undefined && r.after_step !== null) {
              const n = r.after_step;
              const max = steps?.length ?? 0;
              if (typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= max) afterStep = n;
              else problems.push(`${id}: relies_on[${j}].after_step must be a step number from 1 to ${max}`);
            }
            if (what) reliesOn.push({ what, afterStep });
          });
        }
      }

      let loggedOut = false;
      if (raw.logged_out !== undefined) {
        if (typeof raw.logged_out === 'boolean') loggedOut = raw.logged_out;
        else problems.push(`${id}: logged_out must be true or false`);
      }

      scenarios.push({
        id,
        title: title ?? '',
        start: start ?? '/',
        steps: (steps ?? []).filter((s): s is string => s !== null),
        values,
        expected: expected ?? '',
        group,
        source: str(raw.source),
        reliesOn,
        loggedOut,
      });
    });
  }

  if (problems.length) throw new SuiteError(problems);
  return {
    topic: topic as string,
    baseUrl: (baseUrl as URL).href,
    viewport,
    allowHosts,
    judgeModel,
    notes,
    groups,
    scenarios,
    sourcePath: path.resolve(file),
  };
}

export function resolveStartUrl(suite: Suite, s: Scenario): string {
  return new URL(s.start, suite.baseUrl).href;
}

export function groupOrder(suite: Suite): Array<{ id: string; needs: string | null; scenarios: string[] }> {
  if (suite.groups.length === 0) return [{ id: 'default', needs: null, scenarios: suite.scenarios.map((s) => s.id) }];
  return suite.groups.map((g) => ({
    id: g.id,
    needs: g.needs,
    scenarios: suite.scenarios.filter((s) => s.group === g.id).map((s) => s.id),
  }));
}
