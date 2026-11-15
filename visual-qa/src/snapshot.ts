import crypto from 'node:crypto';
import type { Locator, Page } from 'playwright';
import { readPage, type RawControl } from './page-reader.ts';

export type Control = RawControl & { frame: number };
export type Snapshot = { url: string; title: string; controls: Control[]; text: string; hash: string };

const TEXT_LIKE = new Set(['text', 'email', 'tel', 'number', 'search', 'url', 'textarea', 'password', 'date']);

/**
 * Reads the page. With `frames: false` only the main frame is read (what Jev sees);
 * with `frames: true` every frame is read and refs are numbered across frames.
 */
export async function takeSnapshot(page: Page, opts: { frames: boolean; maxTextChars: number }): Promise<Snapshot> {
  const frames = opts.frames ? page.frames() : [page.mainFrame()];
  const controls: Control[] = [];
  let url = page.url();
  let title = '';
  let text = '';
  for (const frame of frames) {
    const frameIndex = page.frames().indexOf(frame);
    try {
      const raw = await frame.evaluate(readPage, { startRef: controls.length + 1, maxTextChars: opts.maxTextChars });
      if (frame === page.mainFrame()) {
        url = raw.url;
        title = raw.title;
        text = raw.text;
      }
      for (const c of raw.controls) controls.push({ ...c, frame: frameIndex });
    } catch {
      // detached or navigating frame: skip it
    }
  }
  // Context is only useful to tell identical labels apart; drop it elsewhere to save tokens.
  const counts = new Map<string, number>();
  for (const c of controls) counts.set(c.name, (counts.get(c.name) ?? 0) + 1);
  for (const c of controls) if ((counts.get(c.name) ?? 0) < 2) c.context = null;

  const hash = crypto
    .createHash('sha1')
    .update(url)
    .update(controls.map((c) => `${c.role}|${c.name}|${c.value ?? ''}|${c.state ?? ''}`).join('\n'))
    .update(text.slice(0, 2000))
    .digest('hex');
  return { url, title, controls, text, hash };
}

export function formatControl(c: Control): string {
  let line = `[${c.ref}] ${c.role} "${c.name}"`;
  if (c.isPassword) line += ' [password field]';
  else if (c.inputType && TEXT_LIKE.has(c.inputType)) line += c.value ? ` = "${c.value}"` : ' (empty)';
  else if (c.value) line += ` = "${c.value}"`;
  if (c.state) line += ` (${c.state})`;
  if (c.context) line += ` — in: ${c.context}`;
  if (c.frame > 0) line += ` {frame ${c.frame}}`;
  return line;
}

export function locatorFor(page: Page, c: Control): Locator {
  const frame = page.frames()[c.frame] ?? page.mainFrame();
  return frame.locator(`[data-qa-ref="${c.ref}"]`);
}
