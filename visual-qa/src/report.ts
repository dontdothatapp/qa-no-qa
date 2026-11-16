import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readRunFile, type ScenarioRecord } from './daemon.ts';
import { openEventLog } from './events.ts';
import { claudeTokens, jevTokens, type ClaudeTokens, type JevTokens, type Usage4 } from './tokens.ts';
import { dueReliesOn } from './relies-on.ts';
import { checkReliedOn, computeVerdict, parseJudgeOutput, type DueRely, type KeyPoint, type RelyResult, type Verdict } from './verdict.ts';

/** A due relies_on item as the report shows it: `met` only when confirmed; `problem` says why one was not. */
export type ReportRely = RelyResult & { problem: string | null };

export type ReportRow = {
  id: string;
  group: string | null;
  /** The checklist line this test came from, verbatim. */
  source: string | null;
  title: string;
  steps: string[];
  expected: string;
  verdict: Verdict;
  reason: string;
  keyPoints: KeyPoint[];
  /** The judge's answer per due relies_on item (items not due are left out); a missing entry is shown as unclear. */
  reliesOn: ReportRely[];
  /** due relies_on item → viewport shot taken at its checkpoint. */
  checkpointShots: Record<string, string>;
  quoteProblems: string[];
  gates: { httpStatus: number | null; consoleErrors: string[]; failedRequests: string[]; errorPhrase: string | null };
  handbacks: Array<{ step: number; reason: string; detail?: string }>;
  madeUp: Record<string, string>;
  jevActions: number;
  claudeActions: number;
  elapsedMs: number;
  url: string | null;
  viewportShot: string | null;
  fullPageShot: string | null;
  jevTokens: { input: number; output: number };
  claudeTokens: Record<string, Usage4>;
};

export type ReportModel = {
  topic: string;
  startedAt: string;
  baseUrl: string;
  groups: Array<{ id: string; needs: string | null }>;
  checklist: string | null;
  continuesFrom: string | null;
  durationMs: number;
  counts: Record<Verdict, number>;
  rows: ReportRow[];
  jev: JevTokens;
  claude: ClaudeTokens;
};

const ORDER: Record<Verdict, number> = { fail: 0, needs_review: 1, not_run: 2, pass: 3 };

function readText(file: string | undefined | null): string {
  try {
    return file ? fs.readFileSync(file, 'utf8') : '';
  } catch {
    return '';
  }
}

export function buildReportModel(runDir: string, opts: { configDir?: string } = {}): ReportModel {
  const run = readRunFile(runDir);
  const events = openEventLog(path.join(runDir, 'events.jsonl')).read();
  const jev = jevTokens(events);
  const claude = claudeTokens(run.sessionId ?? '', run.startedAt, opts.configDir);
  const counts: Record<Verdict, number> = { pass: 0, fail: 0, needs_review: 0, not_run: 0 };

  const suiteGroups = run.suite.groups ?? [];
  const groupIndex = (g: string | null) => {
    const i = suiteGroups.findIndex((x) => x.id === g);
    return i < 0 ? suiteGroups.length : i;
  };

  const rows: ReportRow[] = run.suite.scenarios.map((s) => {
    const rec: ScenarioRecord = run.scenarios[s.id] ?? {
      status: 'not_started', currentStep: 0, jevActions: 0, claudeActions: 0, elapsedMs: 0, handbacks: [], madeUp: {}, gaveUp: null, evidence: null, checkpoints: [], skipReason: null,
    };
    const ev = rec.evidence;
    const judge = parseJudgeOutput(readText(path.join(runDir, 'scenarios', s.id, 'judge.json')) || 'null');
    // the same due list `qa evidence` gives the judge; a snapshot that was not captured (or whose text is gone) can't confirm
    const dueItems = dueReliesOn(s, rec);
    const due: DueRely[] = dueItems.map((d) => ({ what: d.what, pageText: d.textFile !== null && fs.existsSync(d.textFile) ? readText(d.textFile) : null }));
    let v = computeVerdict({ judge, pageText: readText(ev?.textFile), gaveUp: rec.gaveUp, skipped: rec.status === 'skipped' ? rec.skipReason ?? 'skipped' : null, reliesOn: due });
    if (!rec.gaveUp && rec.status !== 'completed' && rec.status !== 'skipped') {
      v = rec.status === 'not_started'
        ? { verdict: 'not_run', reason: 'paused before this group', quoteProblems: [] }
        : { verdict: 'needs_review', reason: `run did not finish (${rec.status})`, quoteProblems: [] };
    }
    counts[v.verdict]++;
    const checkpointShots: Record<string, string> = {};
    for (const d of dueItems) if (d.afterStep !== null && d.viewportShot) checkpointShots[d.what] = d.viewportShot;
    const reliesOn: ReportRely[] = v.verdict === 'not_run' ? [] : due.map((d) => {
      const c = checkReliedOn(d, judge);
      return { ...c.shown, what: d.what, problem: c.problem };
    });
    return {
      id: s.id, group: s.group ?? null, source: s.source ?? null, title: s.title, steps: s.steps, expected: s.expected,
      verdict: v.verdict, reason: v.reason, keyPoints: judge?.keyPoints ?? [], reliesOn, checkpointShots, quoteProblems: v.quoteProblems,
      gates: { httpStatus: ev?.httpStatus ?? null, consoleErrors: ev?.consoleErrors ?? [], failedRequests: ev?.failedRequests ?? [], errorPhrase: ev?.errorPhrase ?? null },
      handbacks: rec.handbacks, madeUp: rec.madeUp, jevActions: rec.jevActions, claudeActions: rec.claudeActions, elapsedMs: rec.elapsedMs,
      url: ev?.url ?? null, viewportShot: ev?.viewportShot ?? null, fullPageShot: ev?.fullPageShot ?? null,
      jevTokens: jev.byScenario[s.id] ?? { input: 0, output: 0 },
      claudeTokens: claude.available ? claude.byScenario[s.id] ?? {} : {},
    };
  });
  // file order of groups, then fail → needs review → not run → pass (the sort is stable)
  rows.sort((a, b) => groupIndex(a.group) - groupIndex(b.group) || ORDER[a.verdict] - ORDER[b.verdict]);
  const checklist = fs.existsSync(path.join(runDir, 'checklist.txt')) ? readText(path.join(runDir, 'checklist.txt')) : null;

  const started = Date.parse(run.startedAt);
  const lastTs = events.reduce((m, e) => Math.max(m, Date.parse(String(e.ts ?? '')) || 0), started);
  return { topic: run.suite.topic, startedAt: run.startedAt, baseUrl: run.suite.baseUrl, groups: suiteGroups.map((g) => ({ id: g.id, needs: g.needs ?? null })), checklist, continuesFrom: run.continuesFrom, durationMs: Math.max(0, lastTs - started), counts, rows, jev, claude };
}

export function summaryLine(c: Record<Verdict, number>): string {
  const parts = [`${c.pass} pass`];
  if (c.fail) parts.push(`${c.fail} fail`);
  if (c.needs_review) parts.push(`${c.needs_review} needs review`);
  if (c.not_run) parts.push(`${c.not_run} not run`);
  return parts.join(' · ');
}

const esc = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const tok = (n: number) => (n < 1000 ? String(n) : `${(n / 1000).toFixed(1)}k`);
const dur = (ms: number) => {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
};
const LABEL: Record<Verdict, string> = { pass: 'PASS', fail: 'FAIL', needs_review: 'NEEDS REVIEW', not_run: 'NOT RUN' };
const ICON: Record<Verdict, string> = { pass: '✓', fail: '✕', needs_review: '?', not_run: '–' };
const sumUsage = (u: Record<string, Usage4>) =>
  Object.values(u).reduce((a, x) => a + x.input + x.cacheWrite + x.cacheRead + x.output, 0);

function img(file: string | null, readImage: (p: string) => Buffer): string | null {
  if (!file) return null;
  try {
    return `data:image/jpeg;base64,${readImage(file).toString('base64')}`;
  } catch {
    return null;
  }
}

function usageTable(rows: Array<[string, Usage4]>): string {
  return `<table class="tok"><thead><tr><th></th><th>New input</th><th>Cache write</th><th>Cache read</th><th>Output</th></tr></thead><tbody>${rows
    .map(([label, u]) => `<tr><th>${esc(label)}</th><td>${tok(u.input)}</td><td>${tok(u.cacheWrite)}</td><td>${tok(u.cacheRead)}</td><td>${tok(u.output)}</td></tr>`)
    .join('')}</tbody></table>`;
}

function rowHtml(r: ReportRow, readImage: (p: string) => Buffer, claudeAvailable: boolean): string {
  const thumb = img(r.viewportShot, readImage);
  const full = img(r.fullPageShot, readImage);
  const points = r.keyPoints.length
    ? `<ul class="points">${r.keyPoints.map((p) => `<li class="kp ${p.status}"><span>${p.status === 'met' ? '✓' : p.status === 'not_met' ? '✕' : '?'}</span> ${esc(p.point)}${p.evidence ? ` <q>${esc(p.evidence)}</q>` : ''} <small>(${p.source})</small></li>`).join('')}</ul>`
    : '';
  const handbacks = r.handbacks.length
    ? `<h4>Hand-backs to Claude</h4><ul>${r.handbacks.map((h) => `<li>Step ${h.step + 1}: <code>${esc(h.reason)}</code> ${esc(h.detail ?? '')}</li>`).join('')}</ul>`
    : '';
  const madeUp = Object.keys(r.madeUp).length
    ? `<h4>Made-up test values</h4><ul>${Object.entries(r.madeUp).map(([k, v]) => `<li>${esc(k)}: <code>${esc(v)}</code></li>`).join('')}</ul>`
    : '';
  const quoteIssues = r.quoteProblems.length ? `<h4>Quotes not found on the page</h4><ul>${r.quoteProblems.map((q) => `<li><q>${esc(q)}</q></li>`).join('')}</ul>` : '';
  const g = r.gates;
  const gates = `<h4>Page checks</h4><ul><li>HTTP status: ${g.httpStatus ?? 'n/a'}</li><li>Console errors: ${g.consoleErrors.length ? g.consoleErrors.map(esc).join('<br>') : 'none'}</li><li>Failed requests: ${g.failedRequests.length ? g.failedRequests.map(esc).join('<br>') : 'none'}</li><li>Error text on page: ${g.errorPhrase ? `<q>${esc(g.errorPhrase)}</q>` : 'none'}</li>${r.url ? `<li>Final URL: <code>${esc(r.url)}</code></li>` : ''}</ul>`;
  const relies = r.reliesOn.length && r.verdict !== 'not_run'
    ? `<h4>Ran on the right page?</h4><ul class="points">${r.reliesOn.map((p) => {
        const shot = img(r.checkpointShots[p.what] ?? null, readImage);
        return `<li class="kp ${p.status}"><span>${p.status === 'met' ? '✓' : p.status === 'not_met' ? '✕' : '?'}</span> ${esc(p.what)}${p.evidence ? ` <q>${esc(p.evidence)}</q>` : ''} <small>(${p.problem ? esc(p.problem) : p.source})</small>${shot ? `<br><img class="cp" src="${shot}" alt="Page when checking: ${esc(p.what)}">` : ''}</li>`;
      }).join('')}</ul>`
    : '';
  const claudeTotal = sumUsage(r.claudeTokens);
  return `<article class="row" data-verdict="${r.verdict}">
  <div class="id">${esc(r.id)}</div>
  <div class="scenario">${r.source ? `<blockquote class="source">${esc(r.source)}</blockquote>` : ''}<h3>${esc(r.title)}</h3><ol>${r.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol></div>
  <div class="expected">${esc(r.expected)}</div>
  <div class="verdict"><span class="badge ${r.verdict}">${ICON[r.verdict]} ${LABEL[r.verdict]}</span><p>${esc(r.reason)}</p>${points}${relies}</div>
  <div class="shot">${thumb ? `<button class="thumb" data-full="${thumb}" aria-label="Enlarge screenshot of ${esc(r.id)}"><img src="${thumb}" alt="Screenshot of ${esc(r.id)}"></button>` : '<div class="noshot">no screenshot</div>'}</div>
  <div class="meta">${dur(r.elapsedMs)} · Jev ${r.jevActions} action${r.jevActions === 1 ? '' : 's'} · Claude ${r.claudeActions} action${r.claudeActions === 1 ? '' : 's'} · Jev ${tok(r.jevTokens.input + r.jevTokens.output)} tok · ${claudeAvailable ? `Claude ${tok(claudeTotal)} tok` : 'Claude n/a'}</div>
  <details><summary>Details</summary><div class="details">${quoteIssues}${handbacks}${madeUp}${gates}${full ? `<h4>Full page</h4><img class="full" src="${full}" alt="Full-page screenshot of ${esc(r.id)}">` : ''}</div></details>
</article>`;
}

export function renderReport(m: ReportModel, readImage: (p: string) => Buffer): string {
  const started = new Date(m.startedAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  const when = `${started.getFullYear()}-${pad(started.getMonth() + 1)}-${pad(started.getDate())} ${pad(started.getHours())}:${pad(started.getMinutes())}`;
  const claude = m.claude;
  const claudeHtml = claude.available
    ? `${usageTable(Object.entries(claude.total).map(([model, u]) => [model, u] as [string, Usage4]))}<p class="note">Orchestration (main session): ${Object.entries(claude.orchestration).map(([model, u]) => `${esc(model)} ${tok(u.input + u.cacheWrite + u.cacheRead + u.output)}`).join(', ') || 'none'}. Takeovers and judges are attributed to their scenario.</p>`
    : `<p class="note">Claude tokens unavailable (${esc(claude.error)}).</p>`;
  const known = new Set(m.groups.map((g) => g.id));
  const section = (needs: string | null, rows: ReportRow[]) =>
    rows.length ? `<section>${needs ? `<h2>${esc(needs)}</h2>` : ''}\n${rows.map((r) => rowHtml(r, readImage, m.claude.available)).join('\n')}\n</section>` : '';
  const sections = [
    ...m.groups.map((g) => section(g.needs, m.rows.filter((r) => r.group === g.id))),
    section(null, m.rows.filter((r) => r.group === null || !known.has(r.group))),
  ].join('\n');
  const checklistHtml = m.checklist !== null ? `<details class="checklist"><summary>Your checklist</summary><pre>${esc(m.checklist)}</pre></details>` : '';
  const continues = m.continuesFrom ? ` · Continues <a href="${esc(pathToFileURL(path.join(m.continuesFrom, 'report.html')).href)}">the earlier run</a>` : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Visual QA — ${esc(m.topic)}</title>
<style>
:root{--bg:#f7f7f5;--card:#fff;--ink:#1d1d1b;--muted:#6b6b66;--line:#e3e2dc;--pass:#1f7a4d;--pass-bg:#e5f4ec;--fail:#b3261e;--fail-bg:#fbe9e7;--rev:#8a5a00;--rev-bg:#fdf3dc;--nr:#5f6368;--nr-bg:#ececea}
@media (prefers-color-scheme:dark){:root{--bg:#161615;--card:#1f1f1d;--ink:#ecebe6;--muted:#a3a29b;--line:#34332f;--pass:#6fd19c;--pass-bg:#173326;--fail:#ff8a80;--fail-bg:#3a1c1a;--rev:#f0c060;--rev-bg:#3a2e12;--nr:#b0b0aa;--nr-bg:#2a2a28}}
*{box-sizing:border-box}[hidden]{display:none!important}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif}
header{padding:28px 24px 12px;max-width:1280px;margin:auto}h1{margin:0 0 4px;font-size:24px}.sub{color:var(--muted)}
.summary{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:14px 0}.chip{padding:3px 10px;border-radius:99px;font-weight:600;font-size:13px}
.chip.pass{background:var(--pass-bg);color:var(--pass)}.chip.fail{background:var(--fail-bg);color:var(--fail)}.chip.needs_review{background:var(--rev-bg);color:var(--rev)}.chip.not_run{background:var(--nr-bg);color:var(--nr)}
.filters button{font:inherit;font-size:13px;padding:4px 10px;border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:6px;cursor:pointer}.filters button[aria-pressed=true]{border-color:var(--ink)}
main{max-width:1280px;margin:auto;padding:0 24px 24px}
.head,.row{display:grid;grid-template-columns:70px 1.3fr 1fr 1.2fr 220px;gap:16px;padding:14px 16px}
.head{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.04em}
.row{background:var(--card);border:1px solid var(--line);border-radius:10px;margin-bottom:10px}
.row h3{margin:0 0 6px;font-size:15px}.row ol{margin:0;padding-left:18px;color:var(--muted)}.id{font-weight:600;font-family:ui-monospace,Menlo,monospace;font-size:13px}
.badge{display:inline-block;padding:2px 8px;border-radius:6px;font-weight:700;font-size:12px}.badge.pass{background:var(--pass-bg);color:var(--pass)}.badge.fail{background:var(--fail-bg);color:var(--fail)}.badge.needs_review{background:var(--rev-bg);color:var(--rev)}.badge.not_run{background:var(--nr-bg);color:var(--nr)}
.verdict p{margin:6px 0}.points{list-style:none;margin:0;padding:0;font-size:13px}.kp span{font-weight:700}.kp.met span{color:var(--pass)}.kp.not_met span{color:var(--fail)}.kp.unclear span{color:var(--rev)}
q{color:var(--muted)}
section h2{margin:22px 0 10px;font-size:17px}blockquote.source{margin:0 0 6px;padding-left:10px;border-left:3px solid var(--line);color:var(--muted);font-size:13px}
.checklist{margin:8px 0}.checklist pre{white-space:pre-wrap;background:var(--card);border:1px solid var(--line);border-radius:6px;padding:10px;font-size:13px}.cp{display:block;max-width:160px;margin-top:4px;border:1px solid var(--line);border-radius:4px}
.sub a{color:inherit}small{color:var(--muted)}
.thumb{padding:0;border:1px solid var(--line);border-radius:6px;background:none;cursor:zoom-in;width:100%}.thumb img{display:block;width:100%;border-radius:6px}
.noshot{border:1px dashed var(--line);border-radius:6px;padding:28px 8px;text-align:center;color:var(--muted)}
.meta{grid-column:2/-1;color:var(--muted);font-size:12px}details{grid-column:2/-1}summary{cursor:pointer;color:var(--muted);font-size:13px}
.details h4{margin:12px 0 4px;font-size:13px}.details ul{margin:0;padding-left:18px;font-size:13px}.full{max-width:100%;border:1px solid var(--line);border-radius:6px}
footer{max-width:1280px;margin:auto;padding:8px 24px 40px}footer h2{font-size:16px}.tok{border-collapse:collapse;font-size:13px}.tok th,.tok td{padding:4px 12px 4px 0;text-align:right}.tok th:first-child{text-align:left}.note{color:var(--muted);font-size:13px}
dialog{border:none;padding:0;background:transparent;max-width:95vw;max-height:95vh}dialog::backdrop{background:rgba(0,0,0,.75)}dialog img{max-width:95vw;max-height:95vh;display:block;cursor:zoom-out}
@media (max-width:860px){.head{display:none}.row{grid-template-columns:1fr}.meta,details{grid-column:auto}}
</style></head><body>
<header><h1>Visual QA — ${esc(m.topic)}</h1><div class="sub">${esc(when)} · ${esc(m.baseUrl)} · total ${dur(m.durationMs)} · Ran in your Chrome (your sign-ins)${continues}</div>${checklistHtml}
<div class="summary"><span class="chip pass">${m.counts.pass} pass</span><span class="chip fail">${m.counts.fail} fail</span><span class="chip needs_review">${m.counts.needs_review} needs review</span><span class="chip not_run">${m.counts.not_run} not run</span>
<span class="filters"><button data-f="all" aria-pressed="true">All</button> <button data-f="fail" aria-pressed="false">Fail</button> <button data-f="needs_review" aria-pressed="false">Needs review</button> <button data-f="not_run" aria-pressed="false">Not run</button> <button data-f="pass" aria-pressed="false">Pass</button></span></div></header>
<main><div class="head"><div>#</div><div>Scenario</div><div>Expected</div><div>Verdict</div><div>Screenshot</div></div>
${sections}
</main>
<footer><h2>Tokens</h2><p><strong>Jev:</strong> ${tok(m.jev.total.input)} in / ${tok(m.jev.total.output)} out</p><p><strong>Claude:</strong></p>${claudeHtml}</footer>
<dialog id="viewer"><img alt="Enlarged screenshot"></dialog>
<script>
const v=document.getElementById('viewer');document.querySelectorAll('.thumb').forEach(b=>b.addEventListener('click',()=>{v.querySelector('img').src=b.dataset.full;v.showModal();}));v.addEventListener('click',()=>v.close());
document.querySelectorAll('.filters button').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.filters button').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));document.querySelectorAll('.row').forEach(r=>{r.hidden=b.dataset.f!=='all'&&r.dataset.verdict!==b.dataset.f;});document.querySelectorAll('main section').forEach(s=>{s.hidden=!s.querySelector('.row:not([hidden])');});}));
</script></body></html>`;
}

/** Writes report.html and results.json into the run folder. */
export function writeReport(runDir: string, opts: { configDir?: string } = {}): { reportPath: string; summary: string } {
  const model = buildReportModel(runDir, opts);
  const reportPath = path.join(runDir, 'report.html');
  fs.writeFileSync(reportPath, renderReport(model, (p) => fs.readFileSync(p)));
  fs.writeFileSync(path.join(runDir, 'results.json'), JSON.stringify(model, null, 2));
  return { reportPath, summary: summaryLine(model.counts) };
}
