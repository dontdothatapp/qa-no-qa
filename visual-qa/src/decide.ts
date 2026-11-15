import { choice } from '@typesafe-ai/sdk';
import { DEFAULTS } from './config.ts';
import { formatControl, type Control, type Snapshot } from './snapshot.ts';
import type { JevRequest } from './jev-client.ts';

export const OPERATION_CRITERIA = {
  click: 'click a link, button, checkbox or other control',
  type: 'type text into a field',
  select: 'choose an option in a dropdown',
  press_enter: 'press Enter in a field, e.g. to submit a search',
  scroll: 'scroll to reveal more of the page',
  wait: 'wait for the page to finish updating',
  done: 'the step goal is already achieved on this page',
  blocked: 'the goal cannot be achieved from this page',
} as const;

/** Picks at most `max` controls: in-viewport first, then the rest, each in document order. */
export function capTargets(controls: Control[], max: number = DEFAULTS.maxTargets): Control[] {
  if (controls.length <= max) return controls;
  const keep = new Set([...controls.filter((c) => c.inViewport), ...controls.filter((c) => !c.inViewport)].slice(0, max));
  return controls.filter((c) => keep.has(c));
}

export function buildJevRequest(snap: Snapshot, stepGoal: string, stepActions: string[]): JevRequest {
  const targets = capTargets(snap.controls);
  const lines = targets.map(formatControl);
  const targetCriteria: Record<string, string | null> = { none: 'no control' };
  targets.forEach((c, i) => {
    targetCriteria[String(c.ref)] = lines[i];
  });
  return {
    state: {
      url: snap.url,
      title: snap.title,
      step_goal: stepGoal,
      actions_so_far: stepActions,
      controls: lines,
      page_text: snap.text.slice(0, DEFAULTS.jevTextChars),
    },
    questions: {
      operation: choice('Which single operation moves toward the step goal now?', OPERATION_CRITERIA),
      target: choice('Which control should the operation act on?', targetCriteria),
    },
  };
}
