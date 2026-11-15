import { DEFAULTS } from './config.ts';
import { locatorFor, type Snapshot } from './snapshot.ts';
import type { ScenarioState } from './scenario-runner.ts';

export type Actor = 'jev' | 'claude';
export type ActionOp = 'click' | 'type' | 'select' | 'press_enter' | 'press' | 'scroll' | 'wait' | 'goto' | 'upload' | 'switch_tab';
export const ACTION_OPS: readonly ActionOp[] = ['click', 'type', 'select', 'press_enter', 'press', 'scroll', 'wait', 'goto', 'upload', 'switch_tab'];
export type ActionRequest = { op: ActionOp; ref?: number; value?: string };
export type ActionTimeouts = { navTimeoutMs?: number; actionTimeoutMs?: number };

const NEEDS_REF = new Set<ActionOp>(['click', 'type', 'select', 'upload']);
const NEEDS_VALUE = new Set<ActionOp>(['type', 'select', 'goto', 'upload']);

/** Executes one action on the scenario's current page. Never throws. */
export async function performAction(
  state: ScenarioState,
  snap: Snapshot,
  a: ActionRequest,
  t: ActionTimeouts = {},
): Promise<{ ok: true } | { ok: false; detail: string }> {
  const timeout = t.actionTimeoutMs ?? DEFAULTS.actionTimeoutMs;
  const navTimeout = t.navTimeoutMs ?? DEFAULTS.navTimeoutMs;
  const control = a.ref === undefined ? null : snap.controls.find((c) => c.ref === a.ref) ?? null;
  if (NEEDS_REF.has(a.op) && !control) return { ok: false, detail: `unknown control ref ${a.ref ?? '(none)'}` };
  if (NEEDS_VALUE.has(a.op) && (a.value === undefined || a.value === '')) return { ok: false, detail: `${a.op} needs a value` };
  const page = state.page;
  try {
    const loc = control ? locatorFor(page, control) : null;
    switch (a.op) {
      case 'click':
        await loc!.click({ timeout });
        break;
      case 'type':
        await loc!.fill(a.value!, { timeout });
        break;
      case 'select':
        try {
          await loc!.selectOption({ label: a.value! }, { timeout });
        } catch {
          await loc!.selectOption(a.value!, { timeout });
        }
        break;
      case 'press_enter': {
        const typed = state.lastTypedRef === null ? null : snap.controls.find((c) => c.ref === state.lastTypedRef) ?? null;
        const where = loc ?? (typed ? locatorFor(page, typed) : null);
        if (where) await where.press('Enter', { timeout });
        else await page.keyboard.press('Enter');
        break;
      }
      case 'press':
        await page.keyboard.press(a.value || 'Enter');
        break;
      case 'scroll':
        if (loc) await loc.scrollIntoViewIfNeeded({ timeout });
        else await page.mouse.wheel(0, 600);
        break;
      case 'wait':
        await page.waitForTimeout(1000);
        break;
      case 'goto':
        await page.goto(a.value!, { timeout: navTimeout });
        break;
      case 'upload':
        await loc!.setInputFiles(a.value!, { timeout });
        break;
      case 'switch_tab': {
        const pages = state.ownPages.filter((p) => !p.isClosed()); // never the user's own tabs
        const i = Number(a.value ?? a.ref);
        if (!Number.isInteger(i) || !pages[i]) return { ok: false, detail: `no tab ${a.value ?? a.ref}; open tabs: ${pages.length}` };
        state.page = pages[i];
        state.newTabOpened = false;
        await state.page.bringToFront();
        break;
      }
    }
    await state.page.waitForLoadState('domcontentloaded', { timeout: navTimeout });
    await state.page.waitForTimeout(300);
    return { ok: true };
  } catch (e) {
    return { ok: false, detail: `${a.op} failed: ${((e as Error).message ?? String(e)).split('\n')[0]}` };
  }
}
