import { test } from 'node:test';
import assert from 'node:assert/strict';
import { takeSnapshot, formatControl, locatorFor } from '../src/snapshot.ts';
import { useBrowserAndFixtures } from './helpers.ts';

const fx = useBrowserAndFixtures();
const MAIN = { frames: false, maxTextChars: 3000 };
const ALL = { frames: true, maxTextChars: 3000 };

test('identical "Add to cart" labels get different context', async () => {
  const page = await fx.newPage('shop.html');
  const snap = await takeSnapshot(page, MAIN);
  const adds = snap.controls.filter((c) => c.name === 'Add to cart');
  assert.equal(adds.length, 2);
  assert.match(adds[0].context ?? '', /Backpack/);
  assert.match(adds[1].context ?? '', /Bolt T-Shirt/);
  assert.match(formatControl(adds[0]), /^\[\d+\] button "Add to cart" — in: .*Backpack/);
});

test('unique labels carry no context (saves tokens)', async () => {
  const page = await fx.newPage('form.html');
  const snap = await takeSnapshot(page, MAIN);
  assert.ok(snap.controls.every((c) => c.context === null));
});

test('password field never exposes its value', async () => {
  const page = await fx.newPage('form.html');
  await page.fill('#pw', 'secret');
  const snap = await takeSnapshot(page, MAIN);
  const pw = snap.controls.find((c) => c.name === 'Password');
  assert.ok(pw);
  assert.equal(pw.isPassword, true);
  assert.equal(pw.value, null);
  assert.match(formatControl(pw), /\[password field\]/);
  assert.ok(!formatControl(pw).includes('secret'));
  assert.ok(!JSON.stringify(snap).includes('secret'));
});

test('inputType is reported for inputs, textarea/select, null otherwise', async () => {
  const page = await fx.newPage('form.html');
  const snap = await takeSnapshot(page, MAIN);
  assert.equal(snap.controls.find((c) => c.name === 'Email')?.inputType, 'email');
  assert.equal(snap.controls.find((c) => c.name === 'Name')?.inputType, 'text');
  assert.equal(snap.controls.find((c) => c.name === 'Submit')?.inputType, null);
});

test('non-ASCII labels survive unchanged', async () => {
  const page = await fx.newPage('de.html');
  const snap = await takeSnapshot(page, MAIN);
  const names = snap.controls.map((c) => c.name);
  assert.ok(names.includes('Straße'), names.join(','));
  assert.ok(names.includes('Vorname'));
});

test('open shadow DOM controls are listed and clickable', async () => {
  const page = await fx.newPage('shadow.html');
  const snap = await takeSnapshot(page, MAIN);
  const btn = snap.controls.find((c) => c.name === 'Shadow action');
  assert.ok(btn, 'shadow button listed');
  await locatorFor(page, btn).click();
  assert.equal(await page.textContent('#out'), 'Clicked');
});

test('iframe controls appear only with frames:true and are clickable', async () => {
  const page = await fx.newPage('iframe.html');
  const main = await takeSnapshot(page, MAIN);
  assert.ok(!main.controls.some((c) => c.name === 'Accept terms'));
  const all = await takeSnapshot(page, ALL);
  const btn = all.controls.find((c) => c.name === 'Accept terms');
  assert.ok(btn);
  assert.ok(btn.frame > 0);
  await locatorFor(page, btn).click();
  assert.equal(await page.frames()[btn.frame].textContent('#s'), 'Accepted');
});

test('hash is stable for an unchanged page and changes after typing', async () => {
  const page = await fx.newPage('form.html');
  const a = await takeSnapshot(page, MAIN);
  const b = await takeSnapshot(page, MAIN);
  assert.equal(a.hash, b.hash);
  await page.fill('#name', 'Test User');
  const c = await takeSnapshot(page, MAIN);
  assert.notEqual(a.hash, c.hash);
  assert.equal(c.controls.find((x) => x.name === 'Name')?.value, 'Test User');
});

test('text excerpt respects maxTextChars and refs are sequential from 1', async () => {
  const page = await fx.newPage('busy.html');
  const snap = await takeSnapshot(page, { frames: false, maxTextChars: 100 });
  assert.ok(snap.text.length <= 100);
  assert.deepEqual(snap.controls.slice(0, 3).map((c) => c.ref), [1, 2, 3]);
  assert.equal(snap.controls.length, 300);
  assert.ok(snap.controls[0].inViewport);
  assert.equal(snap.controls[299].inViewport, false);
});
