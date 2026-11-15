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
  /** The field Enter would be pressed in (target, else the last field typed into this step). */
  enterField: Control | null;
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
const SUBMIT_WORDS = /\b(submit|send)\b/i;
const ENTER_WORDS = /\b(search|enter|submit|send|press|go|find|look up)\b/i;
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** Why a click on `target` is a side effect the step didn't ask for, or null. */
function riskyClick(target: Control, stepText: string): string | null {
  const risky = target.name.match(RISKY);
  if (risky && !new RegExp(`\\b${risky[1]}\\b`, 'i').test(stepText)) return `"${target.name}" was not asked for by the step`;
  if (target.isSubmit && !SUBMIT_WORDS.test(stepText) && !(target.name && norm(stepText).includes(norm(target.name)))) {
    return `"${target.name}" submits a form and the step does not ask to submit`;
  }
  return null;
}

/** Why pressing Enter here is a side effect the step didn't ask for, or null. */
function riskyEnter(field: Control | null, stepText: string): string | null {
  if (!ENTER_WORDS.test(stepText)) return 'pressing Enter could submit a form and the step does not ask to search, enter or submit';
  const submit = field?.formSubmitLabel;
  const risky = submit?.match(RISKY);
  if (submit && risky && !new RegExp(`\\b${risky[1]}\\b`, 'i').test(stepText)) return `Enter would trigger "${submit}", which the step does not ask for`;
  return null;
}

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
  if (eff.operation === 'type' && target?.isPassword) {
    return { handback: 'needs_text', detail: `password fields are never filled ("${target.name}") — sign in through a browser session instead` };
  }
  if ((eff.operation === 'type' || eff.operation === 'select') && !ctx.valueAvailable) {
    return { handback: 'needs_text', detail: `no value for "${target?.name ?? ''}"` };
  }
  if (eff.operation === 'done') return null;

  const risk =
    eff.operation === 'click' && target ? riskyClick(target, ctx.stepText) : eff.operation === 'press_enter' ? riskyEnter(ctx.enterField ?? target, ctx.stepText) : null;
  if (risk) return { handback: 'risky_target', detail: risk };
  if (ctx.unchangedAfterLastTwo || ctx.sameActionThreeTimes) {
    return { handback: 'no_progress', detail: 'the page did not change after repeated actions' };
  }
  if (ctx.stepActions >= d.stepBudget) return { handback: 'step_budget', detail: `${ctx.stepActions} actions on this step` };
  if (ctx.scenarioActions >= d.scenarioBudget) return { handback: 'scenario_budget', detail: `${ctx.scenarioActions} actions in this scenario` };
  return null;
}
