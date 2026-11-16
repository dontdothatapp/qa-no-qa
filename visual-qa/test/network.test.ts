import { test } from 'node:test';
import assert from 'node:assert/strict';
import { botBlockReason, describeFailed, isBotBlock, onSite, shortUrl, snippetOf } from '../src/network.ts';

const RECAPTCHA = '{"errors":[{"code":"recaptcha_unsuccessful","message":"recaptcha check unsuccessful"}]}';

test('a 403 whose reply mentions reCAPTCHA is a bot block', () => {
  assert.equal(isBotBlock(403, RECAPTCHA, {}), true);
});

test('other bot walls count too: Cloudflare challenge, hCaptcha, "are you a robot"', () => {
  assert.equal(isBotBlock(403, '', { 'cf-mitigated': 'challenge' }), true);
  assert.equal(isBotBlock(503, '<title>Just a moment...</title>', {}), true);
  assert.equal(isBotBlock(429, 'Please complete the hCaptcha', {}), true);
  assert.equal(isBotBlock(403, 'Are you a robot?', {}), true);
});

test('ordinary failures are not bot blocks, even when they mention a captcha on a 500', () => {
  assert.equal(isBotBlock(403, '{"error":"permission denied"}', {}), false);
  assert.equal(isBotBlock(500, RECAPTCHA, {}), false, 'a server error is the app, not a bot wall');
  assert.equal(isBotBlock(404, 'captcha', {}), false);
});

test('onSite: the scenario host, its subdomains and its www-less parent count; other sites do not', () => {
  const hosts = ['rentals.example'];
  assert.equal(onSite('https://rentals.example/api/chat', hosts), true);
  assert.equal(onSite('https://api.rentals.example/x', hosts), true);
  assert.equal(onSite('https://www.google.com/recaptcha/api2/reload', hosts), false);
  assert.equal(onSite('https://evilrentals.example/x', hosts), false);
  assert.equal(onSite('https://api.example.com/x', ['www.example.com']), true);
  assert.equal(onSite('http://127.0.0.1:4173/api/chat', ['127.0.0.1:4173']), true);
  assert.equal(onSite('data:text/plain,x', hosts), false);
});

test('URLs are shown without query strings (they can carry tokens)', () => {
  assert.equal(shortUrl('https://a.example/api/chat?session=SECRET123#x'), 'a.example/api/chat');
});

test('snippets are short, single-line, and HTML is reduced to its text', () => {
  assert.equal(snippetOf('<html><head><style>p{}</style><script>x()</script></head><body><h1>Access</h1>\n<p>Just a   moment...</p></body></html>', 'text/html'), 'Access Just a moment...');
  assert.equal(snippetOf('x'.repeat(500), 'application/json').length, 200);
});

test('reason and description name the request, status and reply', () => {
  const f = { status: 403, method: 'POST', url: 'a.example/api/chat', snippet: RECAPTCHA, botBlock: true };
  assert.match(botBlockReason(f), /^Blocked by the site's bot protection: POST a\.example\/api\/chat returned 403 ".*recaptcha check unsuccessful/);
  assert.match(describeFailed(f), /^403 POST a\.example\/api\/chat — \{"errors"/);
});
