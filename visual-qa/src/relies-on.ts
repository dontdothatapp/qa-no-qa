import type { ScenarioRecord } from './daemon.ts';
import type { Scenario } from './types.ts';

/** A relies_on item a test owes the judge, with the snapshot it is judged on; null files: no snapshot was captured. */
export type DueItem = { what: string; afterStep: number | null; viewportShot: string | null; textFile: string | null };

/**
 * The relies_on items a test must confirm before it can be PASS or FAIL (§6.4) — the one rule that both
 * `qa evidence` (what the judge is asked) and the report (what the verdict needs) use:
 * - completed: every item; after_step items on their checkpoint, the others on the final page;
 * - gave up as app_problem: the after_step items due at or before the step where it stopped (steps done);
 * - anything else: none (its verdict does not depend on them).
 * An item whose checkpoint was not captured stays due with null files, so it can never be confirmed.
 */
export function dueReliesOn(
  s: Pick<Scenario, 'reliesOn'>,
  rec: Pick<ScenarioRecord, 'status' | 'currentStep' | 'gaveUp' | 'evidence' | 'checkpoints'>,
): DueItem[] {
  const items = s.reliesOn ?? [];
  let owed: typeof items;
  if (rec.gaveUp) owed = rec.gaveUp.class === 'app_problem' ? items.filter((r) => r.afterStep !== null && r.afterStep <= rec.currentStep) : [];
  else owed = rec.status === 'completed' ? items : [];
  return owed.map((r) => {
    if (r.afterStep === null) return { what: r.what, afterStep: null, viewportShot: rec.evidence?.viewportShot ?? null, textFile: rec.evidence?.textFile ?? null };
    const c = (rec.checkpoints ?? []).find((x) => x.step === r.afterStep);
    return { what: r.what, afterStep: r.afterStep, viewportShot: c?.viewportShot ?? null, textFile: c?.textFile ?? null };
  });
}
