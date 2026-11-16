export type Viewport = { width: number; height: number };

/** A condition the page can show, and the 1-based step after which it is visible (null = the final page). */
export type RelyItem = { what: string; afterStep: number | null };

export type Group = { id: string; needs: string };

export type Scenario = {
  id: string;
  title: string;
  start: string;
  steps: string[];
  values: Record<string, string>;
  expected: string;
  group: string | null;
  /** The checklist line this scenario came from, verbatim. */
  source: string | null;
  reliesOn: RelyItem[];
  /** Run in a context without the user's sign-ins. */
  loggedOut: boolean;
};

export type Suite = {
  topic: string;
  baseUrl: string;
  viewport: Viewport;
  allowHosts: string[];
  judgeModel: string;
  notes: string | null;
  groups: Group[];
  scenarios: Scenario[];
  sourcePath: string;
};
