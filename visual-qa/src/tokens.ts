import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type Usage4 = { input: number; cacheWrite: number; cacheRead: number; output: number };
export type ClaudeTokens =
  | { available: true; orchestration: Record<string, Usage4>; byScenario: Record<string, Record<string, Usage4>>; total: Record<string, Usage4> }
  | { available: false; error: string };
export type JevTokens = { byScenario: Record<string, { input: number; output: number }>; total: { input: number; output: number } };

const ATTRIBUTION = /^QA (takeover|judge) ([A-Za-z0-9_-]+)$/;
const zero = (): Usage4 => ({ input: 0, cacheWrite: 0, cacheRead: 0, output: 0 });

function add(into: Record<string, Usage4>, model: string, u: Usage4): void {
  const t = (into[model] ??= zero());
  t.input += u.input;
  t.cacheWrite += u.cacheWrite;
  t.cacheRead += u.cacheRead;
  t.output += u.output;
}

/** Sums assistant usage per model in one transcript file: de-duplicated by message.id, only at/after `sinceMs`. */
function sumFile(file: string, sinceMs: number): Record<string, Usage4> {
  const out: Record<string, Usage4> = {};
  const seen = new Set<string>();
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return out;
  }
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let o: any;
    try {
      o = JSON.parse(line);
    } catch {
      continue; // malformed line
    }
    const m = o?.message;
    if (o?.type !== 'assistant' || !m?.usage) continue;
    const ts = Date.parse(o.timestamp ?? '');
    if (!Number.isFinite(ts) || ts < sinceMs) continue;
    const id = m.id ?? o.requestId ?? o.uuid;
    if (id) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    add(out, m.model ?? 'unknown', {
      input: m.usage.input_tokens ?? 0,
      cacheWrite: m.usage.cache_creation_input_tokens ?? 0,
      cacheRead: m.usage.cache_read_input_tokens ?? 0,
      output: m.usage.output_tokens ?? 0,
    });
  }
  return out;
}

function findMainTranscript(projectsDir: string, sessionId: string): string | null {
  let dirs: string[];
  try {
    dirs = fs.readdirSync(projectsDir);
  } catch {
    return null;
  }
  for (const d of dirs) {
    const f = path.join(projectsDir, d, `${sessionId}.jsonl`);
    if (fs.existsSync(f)) return f;
  }
  return null;
}

/**
 * Claude usage for this run, read from Claude Code's session transcripts (an undocumented
 * format: any failure returns `available: false` so the report still renders).
 */
export function claudeTokens(
  sessionId: string,
  sinceIso: string,
  configDir: string = process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude'),
): ClaudeTokens {
  try {
    if (!sessionId) return { available: false, error: 'no Claude session id recorded for this run' };
    const main = findMainTranscript(path.join(configDir, 'projects'), sessionId);
    if (!main) return { available: false, error: 'transcript not found' };
    const sinceMs = Date.parse(sinceIso);
    const orchestration: Record<string, Usage4> = {};
    const byScenario: Record<string, Record<string, Usage4>> = {};
    const total: Record<string, Usage4> = {};
    const merge = (into: Record<string, Usage4>, from: Record<string, Usage4>) => {
      for (const [model, u] of Object.entries(from)) {
        add(into, model, u);
        add(total, model, u);
      }
    };
    merge(orchestration, sumFile(main, sinceMs));
    const subDir = path.join(path.dirname(main), sessionId, 'subagents');
    const files = fs.existsSync(subDir) ? fs.readdirSync(subDir).filter((f) => /^agent-.*\.jsonl$/.test(f)) : [];
    for (const f of files) {
      let description = '';
      try {
        description = JSON.parse(fs.readFileSync(path.join(subDir, f.replace(/\.jsonl$/, '.meta.json')), 'utf8')).description ?? '';
      } catch {
        // no meta: counts as orchestration
      }
      const match = description.trim().match(ATTRIBUTION);
      const usage = sumFile(path.join(subDir, f), sinceMs);
      if (match) merge((byScenario[match[2]] ??= {}), usage);
      else merge(orchestration, usage);
    }
    return { available: true, orchestration, byScenario, total };
  } catch (e) {
    return { available: false, error: `could not read transcripts: ${(e as Error).message}` };
  }
}

export function jevTokens(events: Array<Record<string, unknown>>): JevTokens {
  const byScenario: JevTokens['byScenario'] = {};
  const total = { input: 0, output: 0 };
  for (const e of events) {
    if (e.type !== 'jev_decision') continue;
    const u = (e.usage ?? {}) as { inputTokens?: number; outputTokens?: number };
    const id = String(e.id);
    const s = (byScenario[id] ??= { input: 0, output: 0 });
    s.input += u.inputTokens ?? 0;
    s.output += u.outputTokens ?? 0;
    total.input += u.inputTokens ?? 0;
    total.output += u.outputTokens ?? 0;
  }
  return { byScenario, total };
}
