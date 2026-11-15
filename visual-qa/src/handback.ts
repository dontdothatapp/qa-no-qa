import { DEFAULTS, type Defaults } from './config.ts';
import type { JevAnswer, Operation } from './jev-client.ts';
import type { Control } from './snapshot.ts';
import { isTextInput } from './values.ts';

export type HandbackReason =
  | 'jev_blocked'
  | 'low_confidence'
  | 'needs_text'
  | 'no_progress'
  | 'step_budget'
  | 'scenario_budget'
  | 'left_allowed_hosts'
  | 'new_tab'
  | 'risky_target'
  | 'error'
  | 'jev_unavailable';

export type DecisionContext = {
  answer: JevAnswer;
  target: Control | null;
  stepText: string;
  stepActions: number;
  scenarioActions: number;
  unchangedAfterLastTwo: boolean;
  sameActionThreeTimes: boolean;
  /** A value exists for the target field (only meaningful for type/select). */
  valueAvailable: boolean;
};

const NEEDS_TARGET = new Set<Operation>(['click', 'type', 'select']);
const RISKY = /\b(pay|purchase|place order|buy now|delete|remove|confirm)\b/i;

/**
 * Click and type on a text field are one intent ("fill this field"); Jev sometimes splits
 * its probability between them (spike run 1), so merge them and execute `type`.
 */
export function effectiveOperation(a: JevAnswer, target: Control | null): { operation: Operation; confidence: number } {
  if ((a.operation === 'click' || a.operation === 'type') && isTextInput(target)) {
    const p = a.opProbabilities;
    const merged = (p.click ?? 0) + (p.type ?? 0);
    return { operation: 'type', confidence: merged > 0 ? Math.min(1, merged) : a.opConfidence };
  }
  return { operation: a.operation, confidence: a.opConfidence };
}

export function evaluate(ctx: DecisionContext, d: Defaults = DEFAULTS): { handback: HandbackReason; detail: string } | null {
  const { answer, target } = ctx;
  if (answer.operation === 'blocked') return { handback: 'jev_blocked', detail: 'Jev says the step cannot be done on this page' };

  const eff = effectiveOperation(answer, target);
  const needsTarget = NEEDS_TARGET.has(eff.operation);
  const confidence = needsTarget ? Math.min(eff.confidence, answer.targetConfidence) : eff.confidence;
  if (confidence < d.confidenceThreshold) {
    return { handback: 'low_confidence', detail: `${eff.operation} at confidence ${confidence.toFixed(2)}` };
  }
  if (needsTarget && !target) return { handback: 'low_confidence', detail: `${eff.operation} without a target control` };
  if ((eff.operation === 'type' || eff.operation === 'select') && !ctx.valueAvailable) {
    return { handback: 'needs_text', detail: `no value for "${target?.name ?? ''}"` };
  }
  if (eff.operation === 'done') return null;

  if (target) {
    const risky = target.name.match(RISKY);
    if (risky && !new RegExp(`\\b${risky[1]}\\b`, 'i').test(ctx.stepText)) {
      return { handback: 'risky_target', detail: `"${target.name}" was not asked for by the step` };
    }
  }
  if (ctx.unchangedAfterLastTwo || ctx.sameActionThreeTimes) {
    return { handback: 'no_progress', detail: 'the page did not change after repeated actions' };
  }
  if (ctx.stepActions >= d.stepBudget) return { handback: 'step_budget', detail: `${ctx.stepActions} actions on this step` };
  if (ctx.scenarioActions >= d.scenarioBudget) return { handback: 'scenario_budget', detail: `${ctx.scenarioActions} actions in this scenario` };
  return null;
}
