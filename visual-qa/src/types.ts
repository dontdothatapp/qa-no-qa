export type Viewport = { width: number; height: number };

export type Scenario = {
  id: string;
  title: string;
  /** Saved-session name, or null for a logged-out browser. */
  session: string | null;
  start: string;
  steps: string[];
  values: Record<string, string>;
  expected: string;
};

export type BrowserMode = 'chrome' | 'isolated';

export type Suite = {
  topic: string;
  /** chrome = tabs in the user's running Chrome (shared sign-ins and state); isolated = separate headless Chromium. */
  browser: BrowserMode;
  baseUrl: string;
  viewport: Viewport;
  allowHosts: string[];
  judgeModel: string;
  scenarios: Scenario[];
  sourcePath: string;
};
