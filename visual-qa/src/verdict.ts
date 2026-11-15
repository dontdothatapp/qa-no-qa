export type Verdict = 'pass' | 'fail' | 'needs_review';
export type KeyPoint = { point: string; status: 'met' | 'not_met' | 'unclear'; evidence: string; source: 'text' | 'screenshot' };
export type JudgeOutput = { keyPoints: KeyPoint[]; verdict: Verdict; reason: string };
export type GaveUpInfo = { class: 'app_problem' | 'tooling_or_environment'; reason: string };

const STATUSES = new Set(['met', 'not_met', 'unclear']);
const SOURCES = new Set(['text', 'screenshot']);
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
  return {
    keyPoints,
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

/**
 * Final verdict (§6.4). The runner decides; the judge's own `verdict` field is ignored.
 * A false pass is the worst outcome, so anything doubtful becomes needs_review.
 */
export function computeVerdict(i: { judge: JudgeOutput | null; pageText: string; gaveUp: GaveUpInfo | null }): { verdict: Verdict; reason: string; quoteProblems: string[] } {
  if (i.gaveUp?.class === 'app_problem') return { verdict: 'fail', reason: i.gaveUp.reason, quoteProblems: [] };
  if (i.gaveUp?.class === 'tooling_or_environment') return { verdict: 'needs_review', reason: i.gaveUp.reason, quoteProblems: [] };
  if (!i.judge) return { verdict: 'needs_review', reason: 'judge output missing or invalid', quoteProblems: [] };
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
  const bare = points.find((p) => !p.evidence.trim());
  if (bare) return { verdict: 'needs_review', reason: `no evidence given for: ${bare.point}`, quoteProblems: [] };
  const page = normalizeForQuote(i.pageText);
  const quoteProblems = points
    .filter((p) => p.status === 'met' && p.source === 'text' && p.evidence.trim() && !page.includes(normalizeForQuote(p.evidence)))
    .map((p) => p.evidence);
  if (quoteProblems.length) {
    return { verdict: 'needs_review', reason: `judge quoted text that is not on the page: "${quoteProblems[0]}"`, quoteProblems };
  }
  if (i.judge.verdict !== 'pass') {
    return { verdict: 'needs_review', reason: `judge's verdict (${i.judge.verdict}) disagrees with its key points: ${i.judge.reason}`, quoteProblems: [] };
  }
  return { verdict: 'pass', reason: i.judge.reason || 'all expected points met', quoteProblems: [] };
}
