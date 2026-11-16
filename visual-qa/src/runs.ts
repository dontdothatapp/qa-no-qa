import fs from 'node:fs';
import path from 'node:path';
import { readRunFile } from './daemon.ts';
import { groupOrder } from './scenarios.ts';

export type RemainingRun = { runDir: string; testsFile: string; groups: Array<{ id: string; needs: string | null; scenarios: string[] }> };

/** Compares run folders by their real path (a stored `continuesFrom` may differ in form). */
function canonical(dir: string): string {
  try {
    return fs.realpathSync(dir);
  } catch {
    return path.resolve(dir);
  }
}

/** Tests a continued run runs again: never started, or cut off mid-run (e.g. Chrome was closed). */
const UNFINISHED = new Set(['not_started', 'running', 'handback']);

/**
 * The newest run (by startedAt) that still has unfinished tests; its groups list only those tests.
 * A run that a later run continued is skipped: the continuing run took over its remaining tests.
 * Folders without tests.yaml (older-style runs) are skipped: they cannot be continued.
 */
export function findLatestUnfinishedRun(outputRoot: string): RemainingRun | null {
  let names: string[];
  try {
    names = fs.readdirSync(outputRoot);
  } catch {
    return null;
  }
  const runs: Array<{ runDir: string; run: ReturnType<typeof readRunFile> }> = [];
  for (const name of names) {
    const runDir = path.join(outputRoot, name);
    if (!fs.existsSync(path.join(runDir, 'tests.yaml'))) continue;
    try {
      runs.push({ runDir, run: readRunFile(runDir) });
    } catch {
      // not a run folder
    }
  }
  const continued = new Set(runs.flatMap(({ run }) => (run.continuesFrom ? [canonical(run.continuesFrom)] : [])));
  let best: { runDir: string; startedAt: string; unfinished: string[]; run: ReturnType<typeof readRunFile> } | null = null;
  for (const { runDir, run } of runs) {
    if (continued.has(canonical(runDir))) continue;
    const unfinished = run.suite.scenarios.filter((s) => UNFINISHED.has(run.scenarios[s.id]?.status ?? '')).map((s) => s.id);
    if (unfinished.length && (!best || run.startedAt > best.startedAt)) best = { runDir, startedAt: run.startedAt, unfinished, run };
  }
  if (!best) return null;
  const left = new Set(best.unfinished);
  const suite = { ...best.run.suite, groups: best.run.suite.groups ?? [], scenarios: best.run.suite.scenarios.filter((s) => left.has(s.id)) };
  const groups = groupOrder(suite)
    .map((g) => ({ ...g, scenarios: g.scenarios.filter((id) => left.has(id)) }))
    .filter((g) => g.scenarios.length);
  return { runDir: best.runDir, testsFile: path.join(best.runDir, 'tests.yaml'), groups };
}
