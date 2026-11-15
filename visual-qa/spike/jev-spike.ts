/**
 * Jev spike (plan Task 5): real API calls on fixture pages + one busy public page.
 * Prints a table and writes raw results to test/fixtures/jev/<name>.json. Never prints the key.
 * Run: node spike/jev-spike.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright';
import { TypeSafeClient } from '@typesafe-ai/sdk';
import { findTypeSafeKey, DEFAULTS } from '../src/config.ts';
import { takeSnapshot, type Snapshot } from '../src/snapshot.ts';
import { buildJevRequest } from '../src/decide.ts';
import { serveFixtures } from '../test/fixtures/serve.ts';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixtures', 'jev');
fs.mkdirSync(OUT, { recursive: true });

type Case = {
  name: string;
  url: (base: string) => string;
  goal: string;
  prepare?: (page: Page) => Promise<void>;
  actions?: string[];
  expect: (op: string, target: number | null, snap: Snapshot) => boolean;
};

const refOf = (snap: Snapshot, pred: (n: string, ctx: string) => boolean) =>
  snap.controls.find((c) => pred(c.name, c.context ?? ''))?.ref ?? -1;

const CASES: Case[] = [
  { name: 'search-type', url: (b) => `${b}/search.html`, goal: 'Search for "espresso"',
    expect: (op, t, s) => op === 'type' && t === refOf(s, (n) => n === 'Search') },
  { name: 'search-enter', url: (b) => `${b}/search.html`, goal: 'Search for "espresso"', actions: ['typed "espresso" into [1] "Search"'],
    prepare: async (p) => { await p.fill('#q', 'espresso'); },
    expect: (op, t, s) => op === 'press_enter' && t === refOf(s, (n) => n === 'Search') },
  { name: 'shop-backpack', url: (b) => `${b}/shop.html`, goal: 'Click "Add to cart" for the Backpack',
    expect: (op, t, s) => op === 'click' && t === refOf(s, (n, c) => n === 'Add to cart' && c.includes('Backpack')) },
  { name: 'shop-tshirt', url: (b) => `${b}/shop.html`, goal: 'Add the Bolt T-Shirt to the cart',
    expect: (op, t, s) => op === 'click' && t === refOf(s, (n, c) => n === 'Add to cart' && c.includes('Bolt')) },
  { name: 'form-name', url: (b) => `${b}/form.html`, goal: 'Fill the name field',
    expect: (op, t, s) => op === 'type' && t === refOf(s, (n) => n === 'Name') },
  { name: 'form-submit', url: (b) => `${b}/form.html`, goal: 'Click "Submit"',
    expect: (op, t, s) => op === 'click' && t === refOf(s, (n) => n === 'Submit') },
  { name: 'de-strasse', url: (b) => `${b}/de.html`, goal: 'Fill the "Straße" field',
    expect: (op, t, s) => op === 'type' && t === refOf(s, (n) => n === 'Straße') },
  { name: 'iframe-blocked', url: (b) => `${b}/iframe.html`, goal: 'Click "Accept terms"',
    expect: (op) => op === 'blocked' },
  { name: 'popup-open', url: (b) => `${b}/popup.html`, goal: 'Open help',
    expect: (op, t, s) => op === 'click' && t === refOf(s, (n) => n === 'Open help') },
  { name: 'busy-item', url: (b) => `${b}/busy.html`, goal: 'Open "Item 250"',
    expect: (op, t, s) => (op === 'click' && t === refOf(s, (n) => n === 'Item 250')) || op === 'scroll' },
  { name: 'thanks-done', url: (b) => `${b}/thanks.html`, goal: 'Submit the shipping form',
    expect: (op) => op === 'done' },
  { name: 'wikipedia-history', url: () => 'https://en.wikipedia.org/wiki/Espresso', goal: 'Open the "History" section',
    expect: (op, t, s) => op === 'click' && (s.controls.find((c) => c.ref === t)?.name ?? '').toLowerCase().includes('history') },
];

const key = findTypeSafeKey();
if (!key) {
  console.error('No TypeSafe key found (env, project .visual-qa/.env or ~/.visual-qa/.env).');
  process.exit(1);
}
console.log(`key source: ${key.source}`);
const client = new TypeSafeClient({ apiKey: key.key, logLevel: 'off' } as ConstructorParameters<typeof TypeSafeClient>[0]);
const server = await serveFixtures();
const browser = await chromium.launch();
const rows: string[] = [];
const summary: Array<Record<string, unknown>> = [];

for (const c of CASES) {
  const ctx = await browser.newContext({ viewport: DEFAULTS.viewport });
  const page = await ctx.newPage();
  try {
    await page.goto(c.url(server.url), { waitUntil: 'load', timeout: 20000 });
    if (c.prepare) await c.prepare(page);
    const snap = await takeSnapshot(page, { frames: false, maxTextChars: DEFAULTS.jevTextChars });
    const req = buildJevRequest(snap, c.goal, c.actions ?? []);
    const bytes = Buffer.byteLength(JSON.stringify(req));
    const t0 = performance.now();
    const res = (await client.systemOne({ model: DEFAULTS.jevModel, ...req } as Parameters<TypeSafeClient['systemOne']>[0])) as unknown as {
      model: string; answers: Record<string, { choice: string; confidence: number }>; usage: { input_tokens: number; output_tokens: number };
    };
    const ms = Math.round(performance.now() - t0);
    const op = res.answers.operation.choice;
    const target = res.answers.target.choice === 'none' ? null : Number(res.answers.target.choice);
    const ok = c.expect(op, target, snap);
    fs.writeFileSync(path.join(OUT, `${c.name}.json`), JSON.stringify(res, null, 2));
    const targetName = snap.controls.find((x) => x.ref === target)?.name ?? '-';
    rows.push([c.name.padEnd(18), String(ms).padStart(5) + 'ms', String(bytes).padStart(7) + 'B',
      `${res.usage?.input_tokens ?? '?'}/${res.usage?.output_tokens ?? '?'}`.padStart(10),
      `${op}(${res.answers.operation.confidence.toFixed(2)})`.padEnd(20),
      `${target ?? 'none'} "${targetName.slice(0, 20)}"(${res.answers.target.confidence.toFixed(2)})`.padEnd(34),
      ok ? 'OK' : 'WRONG', `controls=${snap.controls.length}`].join(' '));
    summary.push({ name: c.name, ms, bytes, usage: res.usage, model: res.model, op, opConf: res.answers.operation.confidence,
      target, targetConf: res.answers.target.confidence, ok, controls: snap.controls.length });
  } catch (e) {
    rows.push(`${c.name.padEnd(18)} ERROR ${(e as Error).name}: ${(e as Error).message.slice(0, 120)}`);
    summary.push({ name: c.name, error: `${(e as Error).name}: ${(e as Error).message}` });
  } finally {
    await ctx.close();
  }
}
await browser.close();
await server.close();
console.log(rows.join('\n'));
fs.writeFileSync(path.join(OUT, '_summary.json'), JSON.stringify(summary, null, 2));
