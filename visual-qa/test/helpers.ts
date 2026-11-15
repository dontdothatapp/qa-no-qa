import { chromium, type Browser, type Page } from 'playwright';
import { after, before } from 'node:test';
import { serveFixtures } from './fixtures/serve.ts';

/** Registers before/after hooks that start the fixture server and one shared headless Chromium. */
export function useBrowserAndFixtures(): { browser: () => Browser; baseUrl: () => string; newPage: (path: string) => Promise<Page> } {
  let browser: Browser;
  let server: Awaited<ReturnType<typeof serveFixtures>>;
  before(async () => {
    server = await serveFixtures();
    browser = await chromium.launch();
  });
  after(async () => {
    await browser?.close();
    await server?.close();
  });
  return {
    browser: () => browser,
    baseUrl: () => server.url,
    newPage: async (p: string) => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await ctx.newPage();
      await page.goto(`${server.url}/${p}`);
      return page;
    },
  };
}

/** A Chromium with a debug port, standing in for "the user's Chrome". Returns its CDP endpoint. */
export async function launchStandInChrome(): Promise<{ endpoint: string; launched: Browser; close(): Promise<void> }> {
  const net = await import('node:net');
  const port = await new Promise<number>((resolve) => {
    const srv = net.createServer().listen(0, '127.0.0.1', () => {
      const p = (srv.address() as import('node:net').AddressInfo).port;
      srv.close(() => resolve(p));
    });
  });
  const launched = await chromium.launch({ args: [`--remote-debugging-port=${port}`] });
  return { endpoint: `http://127.0.0.1:${port}`, launched, close: () => launched.close() };
}
