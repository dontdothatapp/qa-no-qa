import fs from 'node:fs';
import path from 'node:path';
import { DEFAULTS } from './config.ts';
import { describeFailed } from './network.ts';
import type { ScenarioState } from './scenario-runner.ts';
import { withTimeout } from './util.ts';

export type Evidence = {
  url: string;
  title: string;
  httpStatus: number | null;
  consoleErrors: string[];
  /** Requests to the scenario's site the server refused, e.g. `403 POST a.example/api/chat — <reply>`. */
  failedRequests: string[];
  textFile: string;
  viewportShot: string;
  fullPageShot: string;
  errorPhrase: string | null;
};

/** A screenshot and the page text at the step where a relies_on condition should be visible. */
export type Checkpoint = { step: number; url: string; viewportShot: string; textFile: string };

const ERROR_PHRASE = /something went wrong|page not found|internal server error|\b404\b/i;

/** Waits for the page to settle (load + short pause, never networkidle) and records evidence files. */
export async function captureEvidence(state: ScenarioState, runDir: string, opts: { settleMs?: number } = {}): Promise<Evidence> {
  const page = state.page;
  const id = state.scenario.id;
  await page.waitForLoadState('load', { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(opts.settleMs ?? DEFAULTS.settleMs);
  const shotsDir = path.join(runDir, 'screenshots');
  const scenarioDir = path.join(runDir, 'scenarios', id);
  fs.mkdirSync(shotsDir, { recursive: true });
  fs.mkdirSync(scenarioDir, { recursive: true });
  const viewportShot = path.join(shotsDir, `${id}-viewport.jpg`);
  const fullPageShot = path.join(shotsDir, `${id}-full.jpg`);
  const shot = { type: 'jpeg' as const, quality: DEFAULTS.jpegQuality, scale: 'css' as const, animations: 'disabled' as const, timeout: 15000 };
  await page.screenshot({ ...shot, path: viewportShot });
  await page.screenshot({ ...shot, path: fullPageShot, fullPage: true }).catch(() => fs.copyFileSync(viewportShot, fullPageShot));
  const text = await withTimeout(page.evaluate(() => document.body?.innerText ?? ''), 5000, 'reading page text').catch(() => '');
  const textFile = path.join(scenarioDir, 'page-text.txt');
  fs.writeFileSync(textFile, text.slice(0, DEFAULTS.evidenceTextChars));
  return {
    url: page.url(),
    title: await withTimeout(page.title(), 5000, 'reading the title').catch(() => ''),
    httpStatus: state.lastNavStatus,
    consoleErrors: [...state.consoleErrors],
    failedRequests: state.failedRequests.map(describeFailed),
    textFile,
    viewportShot,
    fullPageShot,
    errorPhrase: text.match(ERROR_PHRASE)?.[0] ?? null,
  };
}

/** Records the page as it is right after `step` (1-based) was done: scenarios/<id>/checkpoint-<step>.jpg and .txt. */
export async function captureCheckpoint(state: ScenarioState, runDir: string, step: number): Promise<Checkpoint> {
  const page = state.page;
  const scenarioDir = path.join(runDir, 'scenarios', state.scenario.id);
  fs.mkdirSync(scenarioDir, { recursive: true });
  await page.waitForLoadState('load', { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(DEFAULTS.settleMs);
  const viewportShot = path.join(scenarioDir, `checkpoint-${step}.jpg`);
  await page.screenshot({ type: 'jpeg', quality: DEFAULTS.jpegQuality, scale: 'css', animations: 'disabled', timeout: 15000, path: viewportShot });
  const text = await withTimeout(page.evaluate(() => document.body?.innerText ?? ''), 5000, 'reading page text').catch(() => '');
  const textFile = path.join(scenarioDir, `checkpoint-${step}.txt`);
  fs.writeFileSync(textFile, text.slice(0, DEFAULTS.evidenceTextChars));
  return { step, url: page.url(), viewportShot, textFile };
}
