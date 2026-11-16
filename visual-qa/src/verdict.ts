export type Verdict = 'pass' | 'fail' | 'needs_review' | 'not_run';
export type KeyPoint = { point: string; status: 'met' | 'not_met' | 'unclear'; evidence: string; source: 'text' | 'screenshot' };
export type RelyResult = { what: string; status: 'met' | 'not_met' | 'unclear'; evidence: string; source: 'text' | 'screenshot' };
export type JudgeOutput = { keyPoints: KeyPoint[]; reliesOn: RelyResult[]; verdict: Verdict; reason: string };
export type GaveUpInfo = { class: 'app_problem' | 'tooling_or_environment' | 'no_matching_page'; reason: string };

const STATUSES = new Set(['met', 'not_met', 'unclear']);
const SOURCES = new Set(['text', 'screenshot']);
// not_run is runner-only: the judge can never produce it
const VERDICTS = new Set(['pass', 'fail', 'needs_review']);

/** Parses the judge's JSON file; null when it is not valid JSON of the expected shape. */
export function parseJudgeOutput(raw: string): JudgeOutput | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  if (!Array.isArray(o.keyPoints)) return null;
  const keyPoints: KeyPoint[] = [];
  for (const k of o.keyPoints) {
    if (typeof k !== 'object' || k === null) return null;
    const p = k as Record<string, unknown>;
    if (typeof p.point !== 'string' || !STATUSES.has(p.status as string) || !SOURCES.has(p.source as string)) return null;
    keyPoints.push({ point: p.point, status: p.status as KeyPoint['status'], evidence: typeof p.evidence === 'string' ? p.evidence : '', source: p.source as KeyPoint['source'] });
  }
  const reliesOn: RelyResult[] = [];
  if (o.reliesOn !== undefined) {
    if (!Array.isArray(o.reliesOn)) return null;
    for (const r of o.reliesOn) {
      if (typeof r !== 'object' || r === null) return null;
      const p = r as Record<string, unknown>;
      if (typeof p.what !== 'string' || !STATUSES.has(p.status as string) || !SOURCES.has(p.source as string)) return null;
      reliesOn.push({ what: p.what, status: p.status as RelyResult['status'], evidence: typeof p.evidence === 'string' ? p.evidence : '', source: p.source as RelyResult['source'] });
    }
  }
  return {
    keyPoints,
    reliesOn,
    verdict: VERDICTS.has(o.verdict as string) ? (o.verdict as Verdict) : 'needs_review',
    reason: typeof o.reason === 'string' ? o.reason : '',
  };
}

export function normalizeForQuote(s: string): string {
  return s
    .replace(/[​-‍﻿]/g, '')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// judges sometimes wrap the quote in a description ("Page text lists "X""): accept a quoted part found on the page
function quoteFoundOn(pageText: string, evidence: string): boolean {
  const page = normalizeForQuote(pageText);
  if (page.includes(normalizeForQuote(evidence))) return true;
  const quoted = [...evidence.matchAll(/["\u201C\u201D]([^"\u201C\u201D]{3,})["\u201C\u201D]/g)].map((m) => m[1]);
  return quoted.length > 0 && quoted.some((q) => page.includes(normalizeForQuote(q)));
}

/**
 * Final verdict (§6.4). The runner decides; the judge's own `verdict` field is only a consistency check.
 * A false pass is the worst outcome, so anything doubtful becomes needs_review.
 * A wrong page is never pass or fail: every relied-on condition that was due must be confirmed with evidence.
 */
export function computeVerdict(i: {
  judge: JudgeOutput | null;
  pageText: string;
  gaveUp: GaveUpInfo | null;
  skipped: string | null;
  reliesOn: Array<{ what: string; pageText: string }>;
}): { verdict: Verdict; reason: string; quoteProblems: string[] } {
  if (i.skipped !== null) return { verdict: 'not_run', reason: i.skipped, quoteProblems: [] };
  if (i.gaveUp?.class === 'no_matching_page') {
    return { verdict: 'needs_review', reason: `Couldn't find a page that matches: ${i.gaveUp.reason}`, quoteProblems: [] };
  }
  if (i.gaveUp?.class === 'tooling_or_environment') return { verdict: 'needs_review', reason: i.gaveUp.reason, quoteProblems: [] };

  // rule A: confirmed = judge entry with the same (normalized) what, met, evidence present, text quotes found on that page
  const quoteProblems: string[] = [];
  const unconfirmed: string[] = [];
  const isEmpty = (e: string) => !normalizeForQuote(e);
  for (const item of i.reliesOn) {
    const key = normalizeForQuote(item.what);
    // every judge entry for this item must confirm it; a contradicting duplicate means unconfirmed
    const entries = (i.judge?.reliesOn ?? []).filter((e) => normalizeForQuote(e.what) === key);
    let confirmed = entries.length > 0;
    for (const r of entries) {
      if (r.status !== 'met' || isEmpty(r.evidence)) confirmed = false;
      else if (r.source === 'text' && !quoteFoundOn(item.pageText, r.evidence)) {
        confirmed = false;
        if (!quoteProblems.includes(r.evidence)) quoteProblems.push(r.evidence);
      }
    }
    if (!confirmed) unconfirmed.push(item.what);
  }

  if (i.gaveUp?.class === 'app_problem') {
    if (unconfirmed.length === 0) return { verdict: 'fail', reason: i.gaveUp.reason, quoteProblems };
    return { verdict: 'needs_review', reason: `Stopped on a page that may not be the right one: ${unconfirmed[0]}`, quoteProblems };
  }
  if (!i.judge) return { verdict: 'needs_review', reason: 'judge output missing or invalid', quoteProblems: [] };
  if (unconfirmed.length > 0) {
    return { verdict: 'needs_review', reason: `Couldn't confirm the test ran on the right page: ${unconfirmed[0]}`, quoteProblems };
  }
  const points = i.judge.keyPoints;
  if (points.length === 0) return { verdict: 'needs_review', reason: 'judge listed no key points', quoteProblems: [] };
  if (points.some((p) => p.status === 'not_met')) {
    const first = points.find((p) => p.status === 'not_met')!;
    return { verdict: 'fail', reason: i.judge.reason || `not met: ${first.point}`, quoteProblems: [] };
  }
  if (points.some((p) => p.status === 'unclear')) {
    const first = points.find((p) => p.status === 'unclear')!;
    return { verdict: 'needs_review', reason: i.judge.reason || `unclear: ${first.point}`, quoteProblems: [] };
  }
  const bare = points.find((p) => isEmpty(p.evidence));
  if (bare) return { verdict: 'needs_review', reason: `no evidence given for: ${bare.point}`, quoteProblems: [] };
  const keyQuoteProblems = points
    .filter((p) => p.status === 'met' && p.source === 'text' && !isEmpty(p.evidence) && !quoteFoundOn(i.pageText, p.evidence))
    .map((p) => p.evidence);
  if (keyQuoteProblems.length) {
    return { verdict: 'needs_review', reason: `judge quoted text that is not on the page: "${keyQuoteProblems[0]}"`, quoteProblems: keyQuoteProblems };
  }
  if (i.judge.verdict !== 'pass') {
    return { verdict: 'needs_review', reason: `judge's verdict (${i.judge.verdict}) disagrees with its key points: ${i.judge.reason}`, quoteProblems: [] };
  }
  return { verdict: 'pass', reason: i.judge.reason || 'all expected points met', quoteProblems: [] };
}
