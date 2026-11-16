import fs from 'node:fs';
import path from 'node:path';
import { readRunFile } from './daemon.ts';
import { groupOrder } from './scenarios.ts';

export type RemainingRun = { runDir: string; testsFile: string; groups: Array<{ id: string; needs: string | null; scenarios: string[] }> };

/** The newest run (by startedAt) that still has tests not started; its groups list only those tests. */
export function findLatestUnfinishedRun(outputRoot: string): RemainingRun | null {
  let names: string[];
  try {
    names = fs.readdirSync(outputRoot);
  } catch {
    return null;
  }
  let best: { runDir: string; startedAt: string; notStarted: string[]; run: ReturnType<typeof readRunFile> } | null = null;
  for (const name of names) {
    const runDir = path.join(outputRoot, name);
    let run;
    try {
      run = readRunFile(runDir);
    } catch {
      continue; // not a run folder
    }
    const notStarted = run.suite.scenarios.filter((s) => run.scenarios[s.id]?.status === 'not_started').map((s) => s.id);
    if (notStarted.length && (!best || run.startedAt > best.startedAt)) best = { runDir, startedAt: run.startedAt, notStarted, run };
  }
  if (!best) return null;
  const left = new Set(best.notStarted);
  const suite = { ...best.run.suite, groups: best.run.suite.groups ?? [], scenarios: best.run.suite.scenarios.filter((s) => left.has(s.id)) };
  const groups = groupOrder(suite)
    .map((g) => ({ ...g, scenarios: g.scenarios.filter((id) => left.has(id)) }))
    .filter((g) => g.scenarios.length);
  return { runDir: best.runDir, testsFile: path.join(best.runDir, 'tests.yaml'), groups };
}
