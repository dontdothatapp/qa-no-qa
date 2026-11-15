import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { DEFAULTS } from './config.ts';
import type { BrowserMode, Scenario, Suite, Viewport } from './types.ts';

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

  const browserRaw = str(doc.browser) ?? 'chrome';
  if (browserRaw !== 'chrome' && browserRaw !== 'isolated') problems.push('browser: must be chrome or isolated');
  const browser = (browserRaw === 'isolated' ? 'isolated' : 'chrome') as BrowserMode;
  const SESSION_NAME = /^[A-Za-z0-9_-]+$/;
  const fileSession = str(doc.session);
  const LOGGED_OUT_IN_CHROME = 'session: none (logged out) cannot run in chrome mode — use browser: isolated for logged-out scenarios';
  if (browser === 'chrome' && fileSession?.toLowerCase() === 'none') problems.push(LOGGED_OUT_IN_CHROME);
  if (fileSession && fileSession.toLowerCase() !== 'none' && !SESSION_NAME.test(fileSession)) {
    problems.push('session: name may only contain letters, digits, - and _');
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

      const ownSession = raw.session === undefined ? fileSession : str(raw.session);
      // in chrome mode every tab carries the user's sign-ins, so "logged out" would silently be false
      if (browser === 'chrome' && raw.session !== undefined && ownSession?.toLowerCase() === 'none') problems.push(`${id}: ${LOGGED_OUT_IN_CHROME}`);
      const session = ownSession && ownSession.toLowerCase() !== 'none' ? ownSession : null;
      if (raw.session !== undefined && session && !SESSION_NAME.test(session)) problems.push(`${id}: session name may only contain letters, digits, - and _`);

      scenarios.push({
        id,
        title: title ?? '',
        session,
        start: start ?? '/',
        steps: (steps ?? []).filter((s): s is string => s !== null),
        values,
        expected: expected ?? '',
      });
    });
  }

  if (problems.length) throw new SuiteError(problems);
  return {
    topic: topic as string,
    browser,
    baseUrl: (baseUrl as URL).href,
    viewport,
    allowHosts,
    judgeModel,
    scenarios,
    sourcePath: path.resolve(file),
  };
}

export function resolveStartUrl(suite: Suite, s: Scenario): string {
  return new URL(s.start, suite.baseUrl).href;
}
