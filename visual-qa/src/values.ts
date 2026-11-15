import type { Control, Snapshot } from './snapshot.ts';

export type ValueSource = 'step' | 'scenario' | 'made_up';

/** Input types a value can be typed into. */
export const TEXT_INPUT_TYPES = new Set(['text', 'email', 'tel', 'number', 'search', 'url', 'textarea', 'password', 'date']);

export function isTextInput(c: Control | null | undefined): boolean {
  return !!c && !!c.inputType && TEXT_INPUT_TYPES.has(c.inputType);
}

const norm = (s: string) => s.toLowerCase().replace(/[*:]/g, ' ').replace(/\s+/g, ' ').trim();
const TYPING_VERB = /\b(type|types|typing|enter|search|fill|input|write|set|select|selects|choose|chooses|pick|picks)\b/i;

const words = (s: string) => new Set(s.split(/[^\p{L}\p{N}]+/u).filter(Boolean));
const subset = (a: Set<string>, b: Set<string>) => a.size > 0 && [...a].every((w) => b.has(w));

/** Exact label match first, then whole-word containment either way ("Name" fits "Your name", not "Username"). */
function lookup(label: string, values: Record<string, string>): string | null {
  const l = norm(label);
  if (!l) return null;
  const entries = Object.entries(values).map(([k, v]) => [norm(k), v] as const).filter(([k]) => k);
  for (const [k, v] of entries) if (k === l) return v;
  const lw = words(l);
  for (const [k, v] of entries) {
    const kw = words(k);
    if (subset(kw, lw) || subset(lw, kw)) return v;
  }
  return null;
}

/**
 * Value to type into a field labelled `label`. Order: scenario values, then a single
 * quoted string in a typing step (unless it is the field's own name), then made-up values.
 */
export function findValue(
  label: string,
  stepText: string,
  scenarioValues: Record<string, string>,
  madeUp: Record<string, string>,
): { value: string; source: ValueSource } | null {
  const fromScenario = lookup(label, scenarioValues);
  if (fromScenario !== null) return { value: fromScenario, source: 'scenario' };
  const quotes = [...stepText.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  if (quotes.length === 1 && TYPING_VERB.test(stepText) && norm(quotes[0]) !== norm(label)) {
    return { value: quotes[0], source: 'step' };
  }
  const fromMadeUp = lookup(label, madeUp);
  if (fromMadeUp !== null) return { value: fromMadeUp, source: 'made_up' };
  return null;
}

/** Labels of visible, empty, enabled text-like fields that have no value from any source (password fields are never filled, so never listed). */
export function missingFields(snap: Snapshot, scenarioValues: Record<string, string>, madeUp: Record<string, string>, stepText = ''): string[] {
  return snap.controls
    .filter((c) => isTextInput(c) && !c.isPassword && !c.value && !(c.state ?? '').includes('disabled'))
    .filter((c) => findValue(c.name, stepText, scenarioValues, madeUp) === null)
    .map((c) => c.name);
}
