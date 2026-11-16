import type { Browser, BrowserContext, Page } from 'playwright';
import { DEFAULTS } from './config.ts';
import { buildJevRequest } from './decide.ts';
import { performAction, type ActionOp } from './actions.ts';
import { captureEvidence, type Evidence } from './evidence.ts';
import type { EventLog } from './events.ts';
import { effectiveOperation, evaluate, type HandbackReason } from './handback.ts';
import { JevError, type JevClient } from './jev-client.ts';
import { botBlockReason, onSite, readFailed, type FailedRequest } from './network.ts';
import { resolveStartUrl } from './scenarios.ts';
import { takeSnapshot, type Snapshot } from './snapshot.ts';
import type { Scenario, Suite } from './types.ts';
import { findValue, missingFields } from './values.ts';

export type GaveUp = { class: 'app_problem' | 'tooling_or_environment'; reason: string };

export type ScenarioState = {
  scenario: Scenario;
  suite: Suite;
  context: BrowserContext;
  page: Page;
  currentStep: number;
  stepActions: number;
  scenarioActions: number;
  claudeActions: number;
  jevActions: number;
  startedAt: number;
  elapsedMs: number;
  /** Hash of the page right before the last action, and how many actions in a row changed nothing. */
  hashBeforeLastAction: string | null;
  unchangedCount: number;
  recentActions: string[];
  stepActionLog: string[];
  lastTypedRef: number | null;
  lastSnapshot: Snapshot | null;
  madeUp: Record<string, string>;
  madeUpUsed: Record<string, string>;
  handbacks: Array<{ step: number; reason: HandbackReason; detail: string }>;
  status: 'running' | 'handback' | 'completed' | 'gave_up';
  gaveUp: GaveUp | null;
  evidence: Evidence | null;
  lastNavStatus: number | null;
  consoleErrors: string[];
  newTabOpened: boolean;
  openError: string | null;
  crashed: boolean;
  /** false when the context is the user's own profile: it must never be closed. */
  ownsContext: boolean;
  /** Tabs this scenario opened (its page and popups from it); the only tabs `switch_tab` and `closeScenario` touch. */
  ownPages: Page[];
  /** Requests to the scenario's own site that the server refused (latest 30). */
  failedRequests: FailedRequest[];
  /** The first refusal that looked like bot protection (reCAPTCHA etc.); it ends the scenario. */
  botBlock: FailedRequest | null;
  /** Refused responses whose body is still being read. */
  pendingResponses: Set<Promise<void>>;
};

export type RunResult = {
  id: string;
  status: 'completed' | 'handback' | 'gave_up';
  step: number;
  stepText: string | null;
  reason?: HandbackReason;
  detail?: string;
  missingFields?: string[];
  gaveUp?: GaveUp;
  jevActions: number;
  claudeActions: number;
  elapsedMs: number;
};

export type RunnerTimeouts = { navTimeoutMs?: number; actionTimeoutMs?: number; settleMs?: number };

function watchPage(state: ScenarioState, page: Page): void {
  page.on('response', (r) => {
    if (r.request().isNavigationRequest() && r.frame() === page.mainFrame() && page === state.page) state.lastNavStatus = r.status();
    // the site's own server refusing a request is invisible on the page (e.g. a chat that silently does
    // nothing because reCAPTCHA rejected the message): record it; third-party failures are noise
    if (r.status() < 400 || !onSite(r.url(), state.suite.allowHosts)) return;
    const pending: Promise<void> = readFailed(r)
      .then((f) => {
        state.failedRequests.push(f);
        if (state.failedRequests.length > 30) state.failedRequests.shift();
        if (f.botBlock && !state.botBlock) state.botBlock = f;
      })
      .catch(() => {})
      .finally(() => state.pendingResponses.delete(pending));
    state.pendingResponses.add(pending);
  });
  page.on('console', (m) => {
    if (m.type() === 'error' && state.consoleErrors.length < 20) state.consoleErrors.push(m.text().slice(0, 300));
  });
  page.on('crash', () => {
    if (page === state.page) state.crashed = true;
  });
  page.on('popup', (p) => {
    // only popups from our own tabs count; tabs the user opens are never ours
    if (!state.ownPages.includes(p)) state.ownPages.push(p);
    state.newTabOpened = true;
    watchPage(state, p);
  });
  page.on('pageerror', (e) => {
    if (state.consoleErrors.length < 20) state.consoleErrors.push(`Uncaught: ${e.message}`.slice(0, 300));
  });
}

async function initScenario(
  context: BrowserContext,
  page: Page,
  ownsContext: boolean,
  suite: Suite,
  s: Scenario,
  madeUp: Record<string, string>,
  t: RunnerTimeouts,
  onCreated?: (state: ScenarioState) => void,
): Promise<ScenarioState> {
  const state: ScenarioState = {
    scenario: s, suite, context, page,
    currentStep: 0, stepActions: 0, scenarioActions: 0, claudeActions: 0, jevActions: 0,
    startedAt: Date.now(), elapsedMs: 0,
    hashBeforeLastAction: null, unchangedCount: 0, recentActions: [], stepActionLog: [], lastTypedRef: null, lastSnapshot: null,
    madeUp, madeUpUsed: {}, handbacks: [], status: 'running', gaveUp: null, evidence: null,
    lastNavStatus: null, consoleErrors: [], newTabOpened: false, openError: null, crashed: false,
    ownsContext, ownPages: [page], failedRequests: [], botBlock: null, pendingResponses: new Set(),
  };
  watchPage(state, page);
  onCreated?.(state); // register before navigating, so a stop mid-load still closes this tab
  try {
    await page.goto(resolveStartUrl(suite, s), { timeout: t.navTimeoutMs ?? DEFAULTS.navTimeoutMs, waitUntil: 'domcontentloaded' });
  } catch (e) {
    state.openError = `could not open ${s.start}: ${((e as Error).message ?? '').split('\n')[0]}`;
  }
  return state;
}

/** A signed-out test: its own fresh context (no cookies, no storage) in the user's Chrome, closed when the scenario ends. */
export async function openLoggedOutScenario(
  browser: Browser,
  suite: Suite,
  s: Scenario,
  madeUp: Record<string, string>,
  t: RunnerTimeouts = {},
  onCreated?: (state: ScenarioState) => void,
): Promise<ScenarioState> {
  const context = await browser.newContext({ viewport: suite.viewport });
  return initScenario(context, await context.newPage(), true, suite, s, madeUp, t, onCreated);
}

/** A new tab in the user's own profile (their sign-ins), emulated at the suite viewport. */
export async function openScenarioInContext(
  context: BrowserContext,
  suite: Suite,
  s: Scenario,
  madeUp: Record<string, string>,
  t: RunnerTimeouts = {},
  onCreated?: (state: ScenarioState) => void,
): Promise<ScenarioState> {
  const page = await context.newPage();
  await page.setViewportSize(suite.viewport);
  return initScenario(context, page, false, suite, s, madeUp, t, onCreated);
}

/** Closes what the scenario opened: its own context if it made one, otherwise only its own tabs. */
export async function closeScenario(state: ScenarioState): Promise<void> {
  if (state.ownsContext) {
    await state.context.close().catch(() => {});
    return;
  }
  for (const p of state.ownPages) if (!p.isClosed()) await p.close().catch(() => {});
}

export function resultOf(state: ScenarioState, extra: Partial<RunResult> = {}): RunResult {
  state.elapsedMs = Date.now() - state.startedAt;
  const steps = state.scenario.steps;
  return {
    id: state.scenario.id,
    status: state.status === 'running' ? 'handback' : state.status,
    step: state.currentStep,
    stepText: state.currentStep < steps.length ? steps[state.currentStep] : null,
    jevActions: state.jevActions,
    claudeActions: state.claudeActions,
    elapsedMs: state.elapsedMs,
    ...(state.gaveUp ? { gaveUp: state.gaveUp } : {}),
    ...extra,
  };
}

/** Lets refused responses that already arrived finish being read (bounded wait). */
export async function settleResponses(state: ScenarioState, waitMs = 3000): Promise<void> {
  if (!state.pendingResponses.size) return;
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([Promise.allSettled([...state.pendingResponses]), new Promise((r) => { timer = setTimeout(r, waitMs); })]);
  clearTimeout(timer);
}

/** The give-up the runner records when the site's bot protection refused a request. */
export function blockedGiveUp(block: FailedRequest): GaveUp {
  return { class: 'tooling_or_environment', reason: botBlockReason(block) };
}

function endGaveUp(state: ScenarioState, gaveUp: GaveUp, events: EventLog): RunResult {
  state.status = 'gave_up';
  state.gaveUp = gaveUp;
  const result = resultOf(state);
  events.append({ type: 'scenario_end', id: state.scenario.id, status: 'gave_up', elapsedMs: result.elapsedMs });
  return result;
}

/** Ends the scenario as given up, with evidence of where it stopped. */
export async function finishGaveUp(state: ScenarioState, gaveUp: GaveUp, events: EventLog, runDir: string, t: RunnerTimeouts = {}): Promise<RunResult> {
  state.evidence = await captureEvidence(state, runDir, { settleMs: t.settleMs }).catch(() => null);
  return endGaveUp(state, gaveUp, events);
}

/**
 * When the site's bot protection refused a request, the scenario cannot be carried out by automation:
 * end it as tooling_or_environment (never an app failure, never a retry) and say so. null when not blocked.
 */
export async function stopIfBlocked(state: ScenarioState, events: EventLog, runDir: string, t: RunnerTimeouts = {}): Promise<RunResult | null> {
  await settleResponses(state);
  if (!state.botBlock) return null;
  const gaveUp = blockedGiveUp(state.botBlock);
  events.append({ type: 'giveup', id: state.scenario.id, actor: 'runner', ...gaveUp });
  return finishGaveUp(state, gaveUp, events, runDir, t);
}

/** Advances to the next step and resets the per-step counters. */
export function advanceStep(state: ScenarioState): void {
  state.currentStep++;
  state.stepActions = 0;
  state.stepActionLog = [];
  state.unchangedCount = 0;
  state.recentActions = [];
  state.hashBeforeLastAction = null;
  state.lastTypedRef = null;
}

export async function completeScenario(state: ScenarioState, events: EventLog, runDir: string, t: RunnerTimeouts = {}): Promise<RunResult> {
  const blocked = await stopIfBlocked(state, events, runDir, t);
  if (blocked) return blocked;
  state.evidence = await captureEvidence(state, runDir, { settleMs: t.settleMs });
  await settleResponses(state);
  if (state.botBlock) {
    // refused while the evidence was being captured: the result on screen cannot be trusted
    const gaveUp = blockedGiveUp(state.botBlock);
    events.append({ type: 'giveup', id: state.scenario.id, actor: 'runner', ...gaveUp });
    return endGaveUp(state, gaveUp, events);
  }
  state.status = 'completed';
  const result = resultOf(state);
  events.append({ type: 'scenario_end', id: state.scenario.id, status: 'completed', elapsedMs: result.elapsedMs });
  return result;
}

function handback(state: ScenarioState, events: EventLog, reason: HandbackReason, detail: string, missing?: string[]): RunResult {
  state.status = 'handback';
  state.handbacks.push({ step: state.currentStep, reason, detail });
  events.append({ type: 'handback', id: state.scenario.id, step: state.currentStep, reason, detail, ...(missing ? { missingFields: missing } : {}) });
  return resultOf(state, { reason, detail, ...(missing ? { missingFields: missing } : {}) });
}

/** true / false for http(s) URLs; 'not_http' for anything else (error pages, about:blank). */
export function isAllowedUrl(url: string, allowHosts: string[]): boolean | 'not_http' {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'not_http';
    // entries with a port must match host:port; entries without one match the hostname
    return allowHosts.some((h) => (h.includes(':') ? h === u.host : h === u.hostname));
  } catch {
    return 'not_http';
  }
}

function hostAllowed(state: ScenarioState): boolean | 'not_http' {
  return isAllowedUrl(state.page.url(), state.suite.allowHosts);
}

/** Jev drives the remaining steps until done or a hand-back (§6.2). */
export async function runJev(state: ScenarioState, deps: { jev: JevClient; events: EventLog; runDir: string } & RunnerTimeouts): Promise<RunResult> {
  const { jev, events, runDir } = deps;
  const s = state.scenario;
  state.status = 'running';
  const blockedAtStart = await stopIfBlocked(state, events, runDir, deps);
  if (blockedAtStart) return blockedAtStart;
  if (state.openError) {
    const message = state.openError;
    state.openError = null; // reported once; Claude may fix the page and resume
    return handback(state, events, 'error', message);
  }

  while (state.currentStep < s.steps.length) {
    if (state.crashed) return handback(state, events, 'error', 'the page crashed');
    const blocked = await stopIfBlocked(state, events, runDir, deps);
    if (blocked) return blocked;
    const stepText = s.steps[state.currentStep];
    let snap: Snapshot;
    try {
      snap = await takeSnapshot(state.page, { frames: false, maxTextChars: DEFAULTS.jevTextChars, timeoutMs: deps.actionTimeoutMs });
    } catch (e) {
      return handback(state, events, 'error', (e as Error).message);
    }
    // check the URL the snapshot was actually taken on (the page may have redirected, e.g. to a sign-in
    // page on another host): never let Jev act off-site or send that page's text to TypeSafe
    const where = isAllowedUrl(snap.url, state.suite.allowHosts);
    if (where === 'not_http') return handback(state, events, 'error', `page did not load (${snap.url})`);
    if (!where) return handback(state, events, 'left_allowed_hosts', `page is on ${snap.url}`);
    state.lastSnapshot = snap;
    if (state.hashBeforeLastAction !== null) {
      state.unchangedCount = snap.hash === state.hashBeforeLastAction ? state.unchangedCount + 1 : 0;
    }

    let answer;
    try {
      answer = await jev.decide(buildJevRequest(snap, stepText, state.stepActionLog));
    } catch (e) {
      const kind = e instanceof JevError ? e.kind : 'transient';
      const message = (e as Error).message ?? String(e);
      return kind === 'fatal' ? handback(state, events, 'jev_unavailable', message) : handback(state, events, 'error', message);
    }
    events.append({
      type: 'jev_decision', id: s.id, step: state.currentStep, latencyMs: answer.latencyMs, operation: answer.operation,
      target: answer.target, opConfidence: answer.opConfidence, targetConfidence: answer.targetConfidence, usage: answer.usage,
    });

    const target = answer.target === null ? null : snap.controls.find((c) => c.ref === answer.target) ?? null;
    const eff = effectiveOperation(answer, target);
    const needsValue = eff.operation === 'type' || eff.operation === 'select';
    const value = needsValue && target ? findValue(target.name, stepText, s.values, state.madeUp) : null;
    const actionKey = `${eff.operation}@${target?.ref ?? '-'}`;
    const lastTyped = state.lastTypedRef === null ? null : snap.controls.find((c) => c.ref === state.lastTypedRef) ?? null;
    const decision = evaluate({
      answer, target, stepText,
      enterField: target ?? lastTyped,
      stepActions: state.stepActions,
      scenarioActions: state.scenarioActions,
      unchangedAfterLastTwo: state.unchangedCount >= 2,
      sameActionThreeTimes: state.recentActions.length >= 2 && state.recentActions.slice(-2).every((k) => k === actionKey),
      valueAvailable: value !== null,
    });
    if (decision) {
      const missing = decision.handback === 'needs_text' ? missingFields(snap, s.values, state.madeUp, stepText) : undefined;
      return handback(state, events, decision.handback, decision.detail, missing);
    }

    if (eff.operation === 'done') {
      events.append({ type: 'step_done', id: s.id, step: state.currentStep, actor: 'jev' });
      advanceStep(state);
      continue;
    }

    state.hashBeforeLastAction = snap.hash;
    const res = await performAction(state, snap, { op: eff.operation as ActionOp, ref: target?.ref, value: value?.value }, deps);
    events.append({
      type: 'action', id: s.id, step: state.currentStep, actor: 'jev', op: eff.operation, ref: target?.ref ?? null,
      label: target?.name ?? null, ...(value ? { valueSource: value.source } : {}),
      ...(value && !target?.isPassword ? { value: value.value } : {}), ok: res.ok,
    });
    state.jevActions++;
    state.stepActions++;
    state.scenarioActions++;
    state.recentActions.push(actionKey);
    state.stepActionLog.push(`${eff.operation}${target ? ` [${target.ref}] "${target.name}"` : ''}${value && !target?.isPassword ? ` = "${value.value}"` : ''}`);
    if (value?.source === 'made_up' && target) state.madeUpUsed[target.name] = value.value;
    if (eff.operation === 'type' && target) state.lastTypedRef = target.ref;

    if (!res.ok) return handback(state, events, 'error', res.detail);
    const allowed = hostAllowed(state);
    if (allowed === 'not_http') return handback(state, events, 'error', `navigation failed (${state.page.url()})`);
    if (!allowed) return handback(state, events, 'left_allowed_hosts', `navigated to ${state.page.url()}`);
    if (state.newTabOpened) {
      state.newTabOpened = false; // reported once; `switch_tab` lets Claude move to it
      return handback(state, events, 'new_tab', 'a new tab or popup opened');
    }
  }
  try {
    return await completeScenario(state, events, runDir, deps);
  } catch (e) {
    return handback(state, events, 'error', `could not capture evidence: ${((e as Error).message ?? '').split('\n')[0]}`);
  }
}
