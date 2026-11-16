import type { Response } from 'playwright';
import { withTimeout } from './util.ts';

/** A request to the scenario's own site that the server refused (status ≥ 400). */
export type FailedRequest = { status: number; method: string; url: string; snippet: string; botBlock: boolean };

// Words bot walls put in their replies: reCAPTCHA / hCaptcha / Turnstile, Cloudflare challenges, DataDome, PerimeterX.
const BOT_TEXT = /captcha|turnstile|cf[-_]chl|just a moment\.\.\.|are you (a )?(human|robot)|bot (protection|detection|check)|datadome|perimeterx/i;
// Statuses bot walls answer with. A 500 that mentions a captcha is the app failing, not a wall.
const BLOCK_STATUS = new Set([401, 403, 405, 429, 503]);

/** True when a refused request looks like the site's bot protection rather than the app itself. */
export function isBotBlock(status: number, body: string, headers: Record<string, string>): boolean {
  if (!BLOCK_STATUS.has(status)) return false;
  return headers['cf-mitigated'] === 'challenge' || BOT_TEXT.test(body.slice(0, 5000));
}

/** The scenario's site: an allowed host, its subdomains, and (for www.x) the other subdomains of x. */
export function onSite(url: string, allowHosts: string[]): boolean {
  let host: string;
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    host = u.hostname;
  } catch {
    return false;
  }
  return allowHosts.some((h) => {
    let name: string;
    try {
      name = new URL(`http://${h}`).hostname.replace(/^www\./, '');
    } catch {
      return false;
    }
    return host === name || host.endsWith(`.${name}`);
  });
}

/** host + path only: query strings and fragments can carry tokens and never reach the report. */
export function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`;
  } catch {
    return url.split(/[?#]/)[0];
  }
}

/** First 200 characters of the reply on one line; HTML is reduced to its visible text. */
export function snippetOf(body: string, contentType: string): string {
  const text = /html/i.test(contentType)
    ? body.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')
    : body;
  return text.replace(/\s+/g, ' ').trim().slice(0, 200);
}

export function describeFailed(f: FailedRequest): string {
  return `${f.status} ${f.method} ${f.url}${f.snippet ? ` — ${f.snippet}` : ''}`;
}

export function botBlockReason(f: FailedRequest): string {
  return `Blocked by the site's bot protection: ${f.method} ${f.url} returned ${f.status}${f.snippet ? ` "${f.snippet.slice(0, 160)}"` : ''}`;
}

/** Reads a refused response (body read is bounded, so a stuck download never holds a scenario up). */
export async function readFailed(r: Response, timeoutMs = 3000): Promise<FailedRequest> {
  const headers = r.headers();
  const body = await withTimeout(r.text(), timeoutMs, 'reading a failed response').catch(() => '');
  const status = r.status();
  return {
    status,
    method: r.request().method(),
    url: shortUrl(r.url()),
    snippet: snippetOf(body, headers['content-type'] ?? ''),
    botBlock: isBotBlock(status, body, headers),
  };
}
