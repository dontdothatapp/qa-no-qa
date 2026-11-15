import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findValue, missingFields } from '../src/values.ts';
import { takeSnapshot } from '../src/snapshot.ts';
import { useBrowserAndFixtures } from './helpers.ts';

const fx = useBrowserAndFixtures();

test('scenario value matched by label, ignoring case, * and :', () => {
  assert.deepEqual(findValue('Postcode *:', 'Fill the shipping form', { Postcode: '10115' }, {}), { value: '10115', source: 'scenario' });
});

test('contains-match in either direction', () => {
  assert.deepEqual(findValue('Full name', 'Fill the form', { name: 'Test User' }, {}), { value: 'Test User', source: 'scenario' });
  assert.deepEqual(findValue('Email', 'Fill the form', { 'Email address': 'a@b.c' }, {}), { value: 'a@b.c', source: 'scenario' });
});

test('single quoted string in a typing step is the value', () => {
  assert.deepEqual(findValue('Search', 'Search for "espresso"', {}, {}), { value: 'espresso', source: 'step' });
  assert.deepEqual(findValue('Name', 'Type "Ada" into Name', {}, {}), { value: 'Ada', source: 'step' });
});

test('select steps take the quoted option as the value (I4)', () => {
  assert.deepEqual(findValue('Plan', 'Select "Annual" in the plan dropdown', {}, {}), { value: 'Annual', source: 'step' });
  assert.deepEqual(findValue('Size', 'Choose "XL"', {}, {}), { value: 'XL', source: 'step' });
});

test('labels match on whole words only (M4)', () => {
  assert.equal(findValue('Username', 'Fill the form', { Name: 'Test User' }, {}), null);
  assert.deepEqual(findValue('Your name', 'Fill the form', { Name: 'Test User' }, {}), { value: 'Test User', source: 'scenario' });
});

test('a quoted field name is not a value', () => {
  assert.equal(findValue('Straße', 'Fill the "Straße" field', {}, {}), null);
});

test('quoted text in a non-typing step is not a value', () => {
  assert.equal(findValue('Coupon', 'Click "Apply coupon"', {}, {}), null);
});

test('scenario value beats the step quote', () => {
  assert.deepEqual(findValue('Search', 'Search for "espresso"', { Search: 'latte' }, {}), { value: 'latte', source: 'scenario' });
});

test('made-up values are used last', () => {
  assert.deepEqual(findValue('Street', 'Fill the form', {}, { Street: '1 Test Street' }), { value: '1 Test Street', source: 'made_up' });
  assert.equal(findValue('City', 'Fill the form', {}, { Street: '1 Test Street' }), null);
});

test('missingFields lists empty text-like fields without a value, in page order', async () => {
  const page = await fx.newPage('form.html');
  const snap = await takeSnapshot(page, { frames: false, maxTextChars: 3000 });
  assert.deepEqual(missingFields(snap, { Name: 'T' }, {}), ['Email', 'Postcode', 'Password']);
  assert.deepEqual(missingFields(snap, { Name: 'T', Email: 'e', Postcode: 'p', Password: 'x' }, {}), []);
});

test('missingFields ignores fields that already have text', async () => {
  const page = await fx.newPage('form.html');
  await page.fill('#email', 'typed@example.com');
  const snap = await takeSnapshot(page, { frames: false, maxTextChars: 3000 });
  assert.deepEqual(missingFields(snap, { Name: 'T' }, {}), ['Postcode', 'Password']);
});
