# Visual QA Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Claude Code skill, `/visual-qa <scenarios.yaml>`, built from three parts:
- **Jev** drives a headless browser through plain-language scenarios, one step at a time.
- **Claude** takes over when Jev hands back, and judges each final screenshot.
- **The skill** writes a self-contained local HTML report with inline screenshots and Claude/Jev token counts.

**Architecture:**
- **Runner:** a Node/TypeScript CLI (`visual-qa/bin/qa.ts`) talks over localhost HTTP to a background daemon. The daemon keeps one Chromium alive per run, with one context per scenario, so Jev and Claude act on the same page.
- **Pure logic:** separate modules handle snapshot formatting, hand-back rules, verdict rules, token parsing and report rendering, so each can be unit-tested without a browser or network.
- **`SKILL.md`:** a thin checklist that calls the CLI and starts one takeover subagent per hand-back and one judge subagent per scenario.

**Tech Stack:**
- Node ≥ 22.18, running `.ts` directly via built-in type stripping (no build step)
- Playwright (Node) and `@typesafe-ai/sdk`
- `yaml`
- `node:test` / `node:assert`, with `tsc --noEmit` for type-checking only

**Spec:** `docs/superpowers/specs/2026-11-15-visual-qa-skill-design.md`. Read it before any task. Section references (§) below point there.

## Global Constraints

- Node ≥ 22.18. ESM (`"type": "module"`).
- Imports use `.ts` extensions. Erasable TypeScript syntax only: no `enum`, `namespace` or parameter properties. Use `import type` for types.
- Runtime dependencies: `playwright`, `@typesafe-ai/sdk`, `yaml`. Nothing else. Dev dependencies: `typescript`, `@types/node`.
- **Never call the Anthropic API** from any script. Claude work happens only in the session or its subagents.
- **TypeSafe key:**
  - Lookup order:
    1. `TYPESAFE_API_KEY` environment variable;
    2. `<project root>/.visual-qa/.env`, where the project root is the parent of the real path of `visual-qa/`;
    3. `~/.visual-qa/.env`.
  - Never print, log or echo it. Report only its source: `env`, `project` or `home`.
  - `.gitignore` excludes `.visual-qa/`, and the key file is `chmod 600`.
- **Jev requests:**
  - `model: "jev-latest"`.
  - Each decision is one `client.systemOne()` call with exactly two choice questions, `operation` and `target`.
  - A Choice holds at most **255 options**.
- **Defaults (named constants in `src/config.ts`):**

  | Setting | Value |
  |---|---|
  | viewport | 1280×800 |
  | confidence threshold | 0.7 |
  | step action budget | 8 |
  | scenario action budget | 40 |
  | Claude takeover budget | 25 actions per scenario |
  | Jev transient retries | 2 (backoff 500 ms, 1500 ms) |
  | screenshot | JPEG, quality 80 |
  | settle after load | 750 ms (never `networkidle`) |
  | Jev page-text excerpt | 3,000 chars |
  | evidence text file | 20,000 chars |
- **Paths:**
  - Run output: `~/QA/<YYYY-MM-DD> <topic>/`, plus ` HH-MM` if that folder exists.
  - State: `~/.visual-qa/`, holding `sessions/<name>.json` and `current-run.json`.
  - Overrides: `VISUAL_QA_OUTPUT_DIR` and `VISUAL_QA_STATE_DIR`.
  - Claude logs: `${CLAUDE_CONFIG_DIR:-~/.claude}/projects/*/<sessionId>.jsonl`.
- **Verdicts:** JSON uses `pass` | `fail` | `needs_review`. The report shows PASS, FAIL and NEEDS REVIEW.
- **Subagent descriptions** are exactly `QA takeover <scenario-id>` and `QA judge <scenario-id>`. Token attribution depends on them.
- **CLI output:** every command prints one JSON object to stdout, except `look`, which prints plain text. Exit code is 0 on success; otherwise 1 with `{"error": "..."}`.
- **Logging:** never log values typed into password fields. Log the value source instead.

## Review Focus

1. **Stale run from a crash:** `current-run.json` points at a dead daemon PID. `qa start` should replace it silently; a live PID is an error telling the user to run `qa stop`. *(Test in Task 8.)*
2. **Same topic twice in one day:** the second run gets ` HH-MM` appended and never overwrites the first. *(Test in Task 1.)*
3. **Busy page with more than 254 controls:** the target choice is capped at 254 controls plus `none`, preferring in-viewport controls and then document order. *(Test in Task 4.)*
4. **Navigation that times out, or a page that crashes mid-action:** this becomes a hand-back with reason `error`. The daemon must not crash and other scenarios continue. *(Test in Task 7.)*
5. **Missing or malformed Claude transcript:** the token summary says "Claude tokens unavailable" and the report still renders. *(Tests in Tasks 10 and 11.)*

---

### Task 1: Project scaffold, config and key lookup

**Files:**
- Create: `.gitignore`, `visual-qa/package.json`, `visual-qa/tsconfig.json`, `visual-qa/src/config.ts`
- Test: `visual-qa/test/config.test.ts`

**Interfaces:**
- Produces:
  - `DEFAULTS`, a frozen object:

    ```ts
    { viewport: { width: 1280, height: 800 }, confidenceThreshold: 0.7, stepBudget: 8, scenarioBudget: 40,
      takeoverBudget: 25, jevRetryBackoffMs: [500, 1500], jpegQuality: 80, settleMs: 750, jevTextChars: 3000,
      evidenceTextChars: 20000, maxTargets: 254, lookMaxControls: 400, lookTextChars: 4000,
      navTimeoutMs: 15000, actionTimeoutMs: 5000, jevModel: 'jev-latest' }
    ```

    `navTimeoutMs` and `actionTimeoutMs` are planning choices, not spec values.
  - `projectRoot(): string`
  - `stateDir(): string`
  - `outputRoot(): string`
  - `findTypeSafeKey(env = process.env): { key: string; source: 'env' | 'project' | 'home' } | null`
  - `runFolderName(topic: string, now: Date, exists: (p: string) => boolean): string`, which returns an absolute path
  - `sanitizeTopic(topic: string): string`

- [ ] **Step 1: Initialise the repo and tooling**
  - `git init` in the project root.
  - `.gitignore`: `.visual-qa/`, `node_modules/`, `visual-qa/test/.tmp/`.
  - `chmod 600 .visual-qa/.env`.
  - `package.json` scripts:
    - `"test": "node --test \"test/**/*.test.ts\""`
    - `"typecheck": "tsc --noEmit"`
  - `tsconfig.json`: `strict`, `noEmit`, `allowImportingTsExtensions`, `erasableSyntaxOnly`, `verbatimModuleSyntax`, `module`/`moduleResolution` set to `nodenext`.
  - In `visual-qa/`, run `npm install playwright @typesafe-ai/sdk yaml && npm install -D typescript @types/node && npx playwright install chromium`.

- [ ] **Step 2: Write failing tests**

```ts
test('key from env wins', () => assert.equal(findTypeSafeKey({ TYPESAFE_API_KEY: 'k1' })?.source, 'env'));
test('key from project .env when env empty', ...)        // temp project dir with .visual-qa/.env → source 'project'
test('no key → null', ...)
test('runFolderName uses date + sanitized topic', () =>
  assert.equal(path.basename(runFolderName('Checkout: flow/v2', new Date('2026-11-15T14:30'), () => false)), '2026-11-15 Checkout- flow-v2'));
test('runFolderName appends HH-MM when folder exists', () =>
  assert.equal(path.basename(runFolderName('Checkout', new Date('2026-11-15T14:30'), () => true)), '2026-11-15 Checkout 14-30'));
```

  For the project and home cases, make the paths injectable via the `VISUAL_QA_PROJECT_ROOT` and `HOME` environment overrides.

- [ ] **Step 3: Run the tests and confirm they fail.**
  - Run: `cd visual-qa && npm test`
  - Expected: FAIL, because the module isn't found.
- [ ] **Step 4: Implement `src/config.ts`**
  - Parse `.env` with a small line parser: `KEY=VALUE`, optional quotes, `#` comments.
  - `sanitizeTopic` replaces `/ \ : * ? " < > |` with `-` and trims.
- [ ] **Step 5: Run the tests and confirm they pass.**
  - Run: `npm test && npm run typecheck`
  - Expected: PASS, with no type errors.
- [ ] **Step 6: Commit.**
  - `git add -A && git commit -m "chore: scaffold visual-qa runner with config and key lookup"`

### Task 2: Scenario file parsing and validation

**Files:**
- Create: `visual-qa/src/types.ts`, `visual-qa/src/scenarios.ts`
- Test: `visual-qa/test/scenarios.test.ts`

**Interfaces:**
- Produces (`types.ts`):

```ts
export type Viewport = { width: number; height: number };
export type Scenario = { id: string; title: string; session: string | null; start: string; steps: string[]; values: Record<string, string>; expected: string };
export type Suite = { topic: string; baseUrl: string; viewport: Viewport; allowHosts: string[]; judgeModel: string; scenarios: Scenario[]; sourcePath: string };
```

- Produces (`scenarios.ts`):
  - `loadSuite(path: string): Suite`, which throws `SuiteError` with `.problems: string[]`
  - `resolveStartUrl(suite: Suite, s: Scenario): string`

- [ ] **Step 1: Write failing tests**
  - Valid file (the spec's §6.6 example) → `scenarios[0].session === null`, because `none` maps to `null`.
  - The file-level `session` is inherited when a scenario omits it.
  - `allowHosts` defaults to `[new URL(baseUrl).host]`.
  - `viewport` defaults to 1280×800.
  - `judgeModel` defaults to `'sonnet'`.
  - `resolveStartUrl` joins a path to `baseUrl` and keeps full URLs unchanged.
  - Problems are each asserted by exact message text:
    - `CO-02: missing "expected"`
    - `CO-01: duplicate id`
    - `CO-03: steps must be a non-empty list`
    - `base_url: not a valid URL`
  - All problems are reported together, not just the first.
  - Scenario ids must match `^[A-Za-z0-9_-]+$` (message: `<id>: id may only contain letters, digits, - and _`).

- [ ] **Step 2: Run the tests and confirm they fail.**
  - Run: `node --test test/scenarios.test.ts`
- [ ] **Step 3: Implement `loadSuite` / `resolveStartUrl`**
  - Use `yaml`'s `parse`.
  - Map the snake_case keys `base_url`, `allow_hosts` and `judge_model` to camelCase.
  - Numeric YAML values in `values` become strings.
- [ ] **Step 4: Run the tests and confirm they pass.**
  - Run: `node --test test/scenarios.test.ts && npm run typecheck`
- [ ] **Step 5: Commit.**
  - `git add -A && git commit -m "feat: scenario YAML loading and validation"`

### Task 3: Fixture site, page reader and snapshots

**Files:**
- Create:
  - `visual-qa/test/fixtures/serve.ts`: a static server for `test/fixtures/site/`, exporting `serveFixtures(port = 0): Promise<{ url: string; close(): Promise<void> }>`. Run directly, it listens on 4173.
  - `visual-qa/test/fixtures/site/`, with these pages:
    - `index.html`: links to every page.
    - `search.html`: the query only submits on Enter, then shows a result list.
    - `form.html`: fields name, email, postcode, a password field and a Submit button, leading to `thanks.html`.
    - `shop.html`: two product cards each with an "Add to cart" button, and a cart counter.
    - `iframe.html`: an iframe containing a button.
    - `shadow.html`: an open shadow root containing a button.
    - `upload.html`: a file input.
    - `popup.html`: a `target=_blank` link.
    - `login.html` / `account.html`: a fake cookie login. `account.html` redirects to `login.html` without the cookie.
    - `de.html`: German labels "Vorname", "Straße".
    - `busy.html`: 300 links.
- Create: `visual-qa/src/page-reader.ts`, `visual-qa/src/snapshot.ts`
- Test: `visual-qa/test/snapshot.test.ts`

**Interfaces:**
- Produces:

```ts
export type Control = { ref: number; frame: number; role: string; name: string; inputType: string | null; value: string | null; state: string | null; context: string | null; inViewport: boolean; isPassword: boolean };
export type Snapshot = { url: string; title: string; controls: Control[]; text: string; hash: string };
export function takeSnapshot(page: Page, opts: { frames: boolean; maxTextChars: number }): Promise<Snapshot>;
export function formatControl(c: Control): string;   // e.g. `[3] button "Add to cart" — in: Backpack $29.99`
export function locatorFor(page: Page, c: Control): Locator;  // frame.locator(`[data-qa-ref="${ref}"]`)
```

  - `page-reader.ts` exports the in-page function passed to `frame.evaluate`. It:
    - clears old `data-qa-ref` marks;
    - walks the DOM, piercing open shadow roots;
    - collects visible interactive elements: a, button, input, select, textarea, `[role=button|link|checkbox|tab|menuitem|option]` and `[contenteditable]`;
    - sets `data-qa-ref`;
    - computes the accessible name: aria-label, then aria-labelledby, then `<label>`, then placeholder, then text content;
    - computes `context` as the trimmed text of the nearest `article`/`li`/`tr`/`[class*=card]` ancestor, at most 80 chars, and only when that ancestor contains more than one control.
  - `takeSnapshot` uses the main frame only when `frames` is false. When true, it uses every frame and numbers refs globally.
  - `hash` is the sha1 of the URL plus each control's `role|name|value|state` plus the first 2,000 chars of text.

- [ ] **Step 1: Write failing tests**
  - Each test launches Chromium, serves the fixtures, then:
  - **`shop.html`:** the two "Add to cart" controls have different `context` (containing "Backpack" and "Bolt T-Shirt").
  - **`form.html`:**
    - The password control has `isPassword: true` and `value: null`, even after `fill('secret')`.
    - `formatControl` of the password control contains `[password field]`.
  - **`de.html`:** the names include `Straße` exactly, so non-ASCII text survives.
  - **`shadow.html`:** the shadow button is listed and `locatorFor(...).click()` works.
  - **`iframe.html`:** the frame button appears only with `frames: true`, and clicking via `locatorFor` works.
  - **Hash:** the hash changes after typing into a field, and is stable across two snapshots of an unchanged page.

- [ ] **Step 2: Run the tests and confirm they fail.**
  - Run: `node --test test/snapshot.test.ts`
- [ ] **Step 3: Implement the fixture server, pages, `page-reader.ts` and `snapshot.ts`.**
- [ ] **Step 4: Run the tests and confirm they pass.**
  - Run: `node --test test/snapshot.test.ts && npm run typecheck`
- [ ] **Step 5: Commit.**
  - `git add -A && git commit -m "feat: page reader, snapshots and fixture site"`

### Task 4: Jev client and decision requests

**Files:**
- Create: `visual-qa/src/jev-client.ts`, `visual-qa/src/decide.ts`
- Test: `visual-qa/test/decide.test.ts`, `visual-qa/test/jev-client.test.ts`

**Interfaces:**
- Consumes: `Snapshot`, `Control`, `formatControl` (Task 3); `findTypeSafeKey`, `DEFAULTS` (Task 1).
- Produces:

```ts
export type Operation = 'click' | 'type' | 'select' | 'press_enter' | 'scroll' | 'wait' | 'done' | 'blocked';
export type JevUsage = { inputTokens: number; outputTokens: number };
export type JevRequest = { state: Record<string, unknown>; questions: Record<string, unknown> };
export type JevAnswer = { operation: Operation; opConfidence: number; target: number | null; targetConfidence: number; usage: JevUsage; latencyMs: number };
export class JevError extends Error { kind: 'transient' | 'fatal' | 'request' }   // assign kind in constructor body, not a parameter property
export interface JevClient { decide(req: JevRequest): Promise<JevAnswer> }
export function createTypeSafeClient(opts?: { fetch?: typeof fetch }): JevClient;
export function createScriptedClient(answers: Array<Partial<JevAnswer> | JevError>): JevClient;  // FIFO; throws when exhausted
export function buildJevRequest(snap: Snapshot, stepGoal: string, stepActions: string[]): JevRequest;
```

- **Request shape (`buildJevRequest`):**
  - `state`: `{ url, title, step_goal, actions_so_far, controls: string[] (formatControl lines), page_text }`.
  - `operation`: `choice("Which single operation moves toward the step goal now?", { click, type, select, press_enter, scroll, wait, done, blocked })`. Each option gets a one-line description:
    - `done`: "the step goal is already achieved on this page"
    - `blocked`: "the goal cannot be achieved from this page"
    - `press_enter`: "press Enter in a field, e.g. to submit a search"
  - `target`: `choice("Which control should the operation act on?", { none: "no control", "<ref>": "<formatControl line>", ... })`.
  - Targets are capped at **254 controls plus `none`**, chosen in-viewport first, then document order.
- **Client (`createTypeSafeClient`):**
  - Construct `new TypeSafeClient({ apiKey, timeout: 10000, fetch })`.
  - Map `result.answers.operation.choice/confidence`, `target.choice` (`'none'` → `null`, otherwise `Number`) and `result.usage` into `JevAnswer`. The usage field names are confirmed in Task 5; normalise both `input_tokens` and `inputTokens`.
  - **Errors:**
    - transient: SDK `RateLimitError`, `InternalServerError`, `APITimeoutError`, `APIConnectionError`, any status ≥ 500 or 529;
    - fatal: `AuthenticationError`, `PermissionDeniedError`, 402;
    - request: `BadRequestError`, `UnprocessableEntityError`, 413.
  - **Retries:** transient errors retry 2 times with 500 ms then 1500 ms backoff, then throw `JevError('transient')`.

- [ ] **Step 1: Write failing tests**
  - `buildJevRequest` on a synthetic 300-control snapshot, with 10 in viewport:
    - the target criteria have exactly 255 keys including `none`;
    - all 10 in-viewport refs are present.
  - `state.page_text.length <= 3000`, and non-ASCII text in the controls is unchanged.
  - With a fake `fetch` returning HTTP 401, `decide` rejects with `JevError` of kind `fatal`, after 1 call.
  - With a fake `fetch` returning 529 three times, it rejects with kind `transient`, after 3 calls.
  - A canned 200 response in REST shape maps to `{ operation: 'click', target: 7, opConfidence: 0.93 }`, with usage `{ inputTokens: 428, outputTokens: 73 }`.
  - `createScriptedClient` returns its answers in order and throws when exhausted.

- [ ] **Step 2: Run the tests and confirm they fail.**
  - Run: `node --test test/decide.test.ts test/jev-client.test.ts`
- [ ] **Step 3: Implement both modules.**
  - Inject the backoff sleep as an option, so tests run instantly.
- [ ] **Step 4: Run the tests and confirm they pass**, then run `npm run typecheck`.
- [ ] **Step 5: Commit.**
  - `git add -A && git commit -m "feat: Jev client with retries and decision request builder"`

### Task 5: Jev spike against the real API

**Files:**
- Create: `visual-qa/spike/jev-spike.ts`, `docs/superpowers/notes/2026-11-15-jev-spike.md`, `visual-qa/test/fixtures/jev/*.json`

**Interfaces:**
- Consumes: `takeSnapshot`, `buildJevRequest`, `createTypeSafeClient`, `serveFixtures`.
- Produces: recorded raw responses, and possibly updated values in `DEFAULTS`, each justified in the notes.

This is the spec's §9 "spike first". It runs as soon as the page reader (Task 3) and Jev client (Task 4) exist, because it needs both. It comes before any runner logic is tuned.

- [ ] **Step 1: Write the spike script**
  - It runs 12 decisions, with this goal per page:

    | Page | Step goal |
    |---|---|
    | `search.html` | `Search for "espresso"` (twice: before and after typing) |
    | `shop.html` | `Click "Add to cart" for the Backpack` |
    | `form.html` | `Fill the name field` |
    | `iframe.html` | (an iframe goal) |
    | `busy.html` | (any goal) |
    | `https://en.wikipedia.org/wiki/Espresso` | `Open the "History" section` |
    | `thanks.html` | a "done" check |

  - For each decision it logs: latency, request byte size, `usage`, operation and target, both confidences, and whether the pick was correct (expected answers are hardcoded).
  - It writes each raw SDK result to `test/fixtures/jev/<name>.json`.
  - It never prints the key.
- [ ] **Step 2: Run it.**
  - Run: `node spike/jev-spike.ts`
  - Expected: a 12-row table. Every call returns 200, with no 4xx.
- [ ] **Step 3: Write the notes**
  - Record:
    - the median and p90 latency;
    - the confidence distribution for correct vs wrong picks;
    - the token size of the busy page;
    - the real `usage` field names in the JS SDK result;
    - recommended threshold, target cap and text-excerpt length.
  - Change `DEFAULTS` only if the data clearly argues for it, and record before and after.
  - Fix Task 4's usage mapping if the field names differ.
- [ ] **Step 4: Re-run the Task 4 tests.**
  - Run: `node --test test/decide.test.ts test/jev-client.test.ts`
  - Expected: PASS.
- [ ] **Step 5: Commit.**
  - `git add -A && git commit -m "chore: Jev spike results and recorded fixtures"`

### Task 6: Value lookup and hand-back rules

**Files:**
- Create: `visual-qa/src/values.ts`, `visual-qa/src/handback.ts`
- Test: `visual-qa/test/values.test.ts`, `visual-qa/test/handback.test.ts`

**Interfaces:**
- Consumes: `Control`, `Snapshot` (Task 3); `JevAnswer` (Task 4); `Scenario` (Task 2).
- Produces:

```ts
export type ValueSource = 'step' | 'scenario' | 'made_up';
export function findValue(label: string, stepText: string, scenarioValues: Record<string,string>, madeUp: Record<string,string>): { value: string; source: ValueSource } | null;
export function missingFields(snap: Snapshot, scenarioValues: Record<string,string>, madeUp: Record<string,string>): string[];
export type HandbackReason = 'jev_blocked' | 'low_confidence' | 'needs_text' | 'no_progress' | 'step_budget' | 'scenario_budget' | 'left_allowed_hosts' | 'new_tab' | 'risky_target' | 'error' | 'jev_unavailable';
export type DecisionContext = { answer: JevAnswer; target: Control | null; stepText: string; stepActions: number; scenarioActions: number; unchangedAfterLastTwo: boolean; sameActionThreeTimes: boolean; valueAvailable: boolean };
export function evaluate(ctx: DecisionContext, d = DEFAULTS): { handback: HandbackReason; detail: string } | null;
```

- **`findValue`:**
  1. If the step text has exactly one double-quoted string and no scenario value matches the label, the quoted string wins (source `step`).
  2. Otherwise an exact label match in `scenarioValues`, ignoring case, `*`, `:` and surrounding whitespace.
  3. Then a contains-match in either direction.
  4. Then the same for `madeUp`.
- **`missingFields`:** labels of visible, empty, text-like inputs (`text`, `email`, `tel`, `number`, `search`, `url`, textarea, and `password`) that have no value from the sources above.
- **`evaluate`:** applies the rules in this precedence. The first match wins.

```
blocked op → jev_blocked
min(opConfidence, targetConfidence*) < threshold → low_confidence   (*targetConfidence only when op needs a target)
op ∈ {click,type,select,press_enter} && target == null → low_confidence
op ∈ {type,select} && !valueAvailable → needs_text
target.isPassword && op == type && !valueAvailable → needs_text
risky label (/\b(pay|purchase|place order|buy now|delete|remove|confirm)\b/i on target.name) not mentioned in stepText → risky_target
unchangedAfterLastTwo || sameActionThreeTimes → no_progress
stepActions >= d.stepBudget → step_budget;  scenarioActions >= d.scenarioBudget → scenario_budget
```

  Host, new-tab and error checks happen in the runner (Task 7), not here.

- [ ] **Step 1: Write failing tests**
  - One test per rule above.
  - A precedence test: `blocked` with low confidence gives `jev_blocked`.
  - A risky target `Delete account` with step "Click Delete account" gives `null`, meaning proceed.
  - `findValue('Postcode *:', 'Fill the shipping form', {Postcode:'10115'}, {})` gives `{value:'10115', source:'scenario'}`.
  - `findValue('Search', 'Search for "espresso"', {}, {})` gives `{value:'espresso', source:'step'}`.
  - `missingFields` on `form.html` (Task 3 fixture), with values `{Name:'T'}`, gives `['Email','Postcode','Password']`, with labels exactly as rendered.

- [ ] **Step 2: Run the tests and confirm they fail.**
  - Run: `node --test test/values.test.ts test/handback.test.ts`
- [ ] **Step 3: Implement both modules.**
- [ ] **Step 4: Run the tests and confirm they pass**, then run `npm run typecheck`.
- [ ] **Step 5: Commit.**
  - `git add -A && git commit -m "feat: value lookup and hand-back rules"`

### Task 7: Actions, event log, evidence and the scenario runner

**Files:**
- Create: `visual-qa/src/actions.ts`, `visual-qa/src/events.ts`, `visual-qa/src/evidence.ts`, `visual-qa/src/scenario-runner.ts`
- Test: `visual-qa/test/runner.test.ts`

**Interfaces:**
- Consumes: Tasks 2–6.
- Produces:

```ts
export type Actor = 'jev' | 'claude';
export type ActionRequest = { op: 'click'|'type'|'select'|'press_enter'|'press'|'scroll'|'wait'|'goto'|'upload'|'switch_tab'; ref?: number; value?: string };
export function performAction(state: ScenarioState, snap: Snapshot, a: ActionRequest): Promise<{ ok: true } | { ok: false; detail: string }>;
export type EventLog = { append(e: Record<string, unknown> & { type: string }): void; read(): Array<Record<string, unknown>> };
export function openEventLog(file: string): EventLog;
export type Evidence = { url: string; title: string; httpStatus: number | null; consoleErrors: string[]; textFile: string; viewportShot: string; fullPageShot: string; errorPhrase: string | null };
export function captureEvidence(state: ScenarioState, runDir: string): Promise<Evidence>;
export type ScenarioState = { scenario: Scenario; suite: Suite; context: BrowserContext; page: Page; currentStep: number; stepActions: number; scenarioActions: number; claudeActions: number; jevActions: number; startedAt: number; elapsedMs: number; recentHashes: string[]; recentActions: string[]; madeUp: Record<string,string>; madeUpUsed: Record<string,string>; status: 'running'|'handback'|'completed'|'gave_up'; evidence: Evidence | null; lastNavStatus: number | null; consoleErrors: string[]; newTabOpened: boolean };
export type RunResult = { id: string; status: 'completed' | 'handback' | 'gave_up'; step: number; stepText: string | null; reason?: HandbackReason; detail?: string; missingFields?: string[]; jevActions: number; claudeActions: number; elapsedMs: number };
export function openScenario(browser: Browser, suite: Suite, s: Scenario, sessionFile: string | null, madeUp: Record<string,string>): Promise<ScenarioState>;
export function runJev(state: ScenarioState, deps: { jev: JevClient; events: EventLog; runDir: string }): Promise<RunResult>;
```

- **`openScenario`:**
  - Creates a fresh context with `{ viewport, storageState: sessionFile ?? undefined }` and navigates to the start URL.
  - Wires up these listeners:
    - `page.on('response')` for main-frame navigation status;
    - `console` errors and `pageerror`;
    - `context.on('page')`, which sets `newTabOpened`.
- **`runJev` loop:** while `currentStep < steps.length`:
  1. Take a snapshot.
  2. Call `jev.decide`.
     - `JevError` fatal → hand back `jev_unavailable`.
     - transient or request → hand back `error`, with the message as detail.
  3. Log a `jev_decision` event: id, step, latencyMs, op, target, confidences, usage.
  4. `evaluate`.
     - On hand-back, compute `missingFields` for `needs_text`, log a `handback` event and return.
  5. `done` → `currentStep++`, reset step counters, log `step_done` (actor `jev`), continue.
  6. Otherwise `performAction`. The value comes from `findValue`, and `madeUpUsed` records any `made_up` value used.
     - Log an `action` event with the value source (never the value for password fields).
     - Increment `jevActions`, `stepActions` and `scenarioActions`.
  7. After the action:
     - host not in `allowHosts` → `left_allowed_hosts`;
     - `newTabOpened` → `new_tab`;
     - an action exception or navigation timeout → `error`.
     - Update `recentHashes` and `recentActions`.

  When the loop ends: `captureEvidence`, set status `completed`, log `scenario_end`.
- **`captureEvidence`:**
  - Wait for `load` (5 s cap), then `DEFAULTS.settleMs`.
  - JPEG q80 viewport screenshot → `screenshots/<id>-viewport.jpg`; full-page → `screenshots/<id>-full.jpg`.
  - `innerText` (max 20,000 chars) → `scenarios/<id>/page-text.txt`.
  - `errorPhrase`: the first match of `/something went wrong|page not found|internal server error|\b404\b/i`, or `null`.

- [ ] **Step 1: Write failing tests**
  - These use the fixture site and `createScriptedClient`.
  - **Happy path:** search scenario, steps `['Search for "espresso"']`, scripted `type@ref`, `press_enter@ref`, `done`.
    - Gives `status: 'completed'` and `jevActions === 2`.
    - Evidence files exist, and `page-text.txt` contains the results.
  - **Low confidence:** a scripted answer with `opConfidence 0.4` → `handback/low_confidence`, with the browser context still usable.
  - **Popup:** clicking the `target=_blank` link → `new_tab`.
  - **Outside allowed hosts:** the suite's `base_url` is `http://127.0.0.1:<port>`. A scripted click on `index.html`'s link to `http://localhost:<port>/` (a different host string) → `left_allowed_hosts`.
  - **Review Focus 4:** a step whose click triggers navigation to a route that never responds (the fixture server path `/hang`), with a 3 s navigation timeout injected → `handback/error`. A second scenario opened afterwards on the same browser still completes.
  - **Jev auth failure:** scripted `new JevError('x','fatal')` → `handback/jev_unavailable`.
  - **Password value:** the `events.jsonl` line for typing into a password field from `values` contains `"valueSource":"scenario"` and not the value.

- [ ] **Step 2: Run the tests and confirm they fail.**
  - Run: `node --test test/runner.test.ts`
- [ ] **Step 3: Implement the four modules.**
  - Navigation and action timeouts come from `DEFAULTS`, overridable in tests.
  - Add `/hang` to `serve.ts`.
- [ ] **Step 4: Run the tests and confirm they pass**, then run `npm run typecheck`.
- [ ] **Step 5: Commit.**
  - `git add -A && git commit -m "feat: scenario runner with Jev loop, actions, evidence and events"`

### Task 8: Daemon and CLI

**Files:**
- Create: `visual-qa/src/daemon.ts`, `visual-qa/src/daemon-client.ts`, `visual-qa/bin/qa.ts`
- Test: `visual-qa/test/daemon.test.ts`

**Interfaces:**
- Consumes: Tasks 1–7.
- Produces:
  - `startDaemon(runDir: string, opts: { jev?: JevClient; navTimeoutMs?: number }): Promise<{ port: number; token: string; close(): Promise<void> }>`
  - `sendCommand(name: string, args: Record<string, unknown>): Promise<unknown>`, which reads `current-run.json` and POSTs to `http://127.0.0.1:<port>/cmd` with `Authorization: Bearer <token>`.

**CLI commands** (`node bin/qa.ts <cmd>`). Each returns JSON:

| Command | Result |
|---|---|
| `start <file> --session <id>` | Loads the suite, checks every referenced session file exists (else error `session "<name>" not found — run: node <abs>/bin/qa.ts login <name> <url>`), creates the run folder (`runFolderName`) with `run.json`, spawns the detached `daemon` subcommand, waits for `daemon.json`, writes `current-run.json` `{runDir, port, token, pid}`. Returns `{runDir, scenarios: string[], judgeModel}`. |
| `daemon <runDir>` | Internal: runs `startDaemon`. A `VISUAL_QA_FAKE_JEV=<json file>` env var swaps in `createScriptedClient`. |
| `run <id>` | Opens the scenario if needed, then `runJev`. Returns `RunResult`. |
| `resume <id>` | `runJev` from the current step. Returns `RunResult`. |
| `look <id>` | Plain text: URL, title, `formatControl` lines from a `frames: true` snapshot (max 400), and 4,000 chars of text. |
| `act <id> <op> [ref] [value] [--made-up]` | Counts toward `claudeActions`. At 25 it returns error `takeover budget exceeded — give up`. `--made-up` with `type` records `madeUp[label]` (run-wide) and `madeUpUsed`. Logs an `action` event with actor `claude`. Returns `{ok, url}`. |
| `shot <id>` | Viewport screenshot to `scenarios/<id>/look-<n>.jpg`. Returns `{path}`. |
| `step-done <id>` | Advances the step (actor `claude`). If it was the last step, captures evidence and completes. Returns `RunResult`. |
| `giveup <id> --class app_problem\|tooling_or_environment --reason <text>` | Captures evidence if the scenario has a page, records `gaveUp`, status `gave_up`. Works on scenarios never started (no evidence). |
| `evidence <id>` | `{id, expected, url, title, httpStatus, consoleErrors, errorPhrase, textFile, viewportShot, fullPageShot, judgeOutputPath: "<runDir>/scenarios/<id>/judge.json"}` |
| `report` | Implemented in Task 11; here it returns error `not implemented`. |
| `stop` | Closes the browser, exits the daemon, deletes `current-run.json`. |

The daemon is the only writer of `run.json`. It persists after each command.

- [ ] **Step 1: Write failing tests**
  - These use the in-process `startDaemon` with a scripted Jev and the fixture site.
  - The `run` → `handback` → `act` (×2) → `step-done` → `RunResult.status === 'completed'` sequence works, and `claudeActions === 2`.
  - The 26th `act` errors with the budget message.
  - `giveup` on an unstarted scenario records `gaveUp` with `evidence: null`.
  - An unknown token → HTTP 401.
  - **Review Focus 1:**
    - `current-run.json` with a dead PID → `qa start` succeeds and replaces it.
    - A live PID (the test's own `process.pid`) → error containing `qa stop`.
  - **CLI end-to-end:** `start` / `run` / `stop` via `child_process.execFile('node', ['bin/qa.ts', ...])`, with `VISUAL_QA_FAKE_JEV`, `VISUAL_QA_OUTPUT_DIR` and `VISUAL_QA_STATE_DIR` pointing into `test/.tmp`. Stdout parses as JSON at each step.

- [ ] **Step 2: Run the tests and confirm they fail.**
  - Run: `node --test test/daemon.test.ts`
- [ ] **Step 3: Implement the daemon, client and CLI.**
  - Use `node:util` `parseArgs` and `node:http`. The token is `crypto.randomUUID()`.
  - Spawn the daemon with `spawn(process.execPath, [binPath, 'daemon', runDir], { detached: true, stdio: 'ignore' }).unref()`.
- [ ] **Step 4: Run the tests and confirm they pass**, then run `npm run typecheck`.
- [ ] **Step 5: Commit.**
  - `git add -A && git commit -m "feat: run daemon and qa CLI"`

### Task 9: Verdict rules

**Files:**
- Create: `visual-qa/src/verdict.ts`
- Test: `visual-qa/test/verdict.test.ts`

**Interfaces:**
- Produces:

```ts
export type Verdict = 'pass' | 'fail' | 'needs_review';
export type KeyPoint = { point: string; status: 'met' | 'not_met' | 'unclear'; evidence: string; source: 'text' | 'screenshot' };
export type JudgeOutput = { keyPoints: KeyPoint[]; verdict: Verdict; reason: string };
export function parseJudgeOutput(raw: string): JudgeOutput | null;   // null on invalid JSON/shape
export function normalizeForQuote(s: string): string;                // lowercase, collapse whitespace, curly→straight quotes, strip zero-width
export function computeVerdict(i: { judge: JudgeOutput | null; pageText: string; gaveUp: { class: 'app_problem' | 'tooling_or_environment'; reason: string } | null }): { verdict: Verdict; reason: string; quoteProblems: string[] };
```

- **Precedence**, first match wins:
  1. `gaveUp.app_problem` → fail (reason: gave-up reason).
  2. `gaveUp.tooling_or_environment` → needs_review.
  3. Judge `null` → needs_review, "judge output missing or invalid".
  4. Empty `keyPoints` → needs_review.
  5. Any `not_met` → fail, with the judge's reason.
  6. Any `unclear` → needs_review.
  7. All `met` → pass.
- **Quote check:** applies only to `met` points with source `text`. If a normalised evidence string isn't found in the normalised page text, the result is needs_review, with the quote listed in `quoteProblems`.
- **The judge's own `verdict` field is ignored.**

- [ ] **Step 1: Write failing tests**
  - One test per precedence rule.
  - A `met` point (source `text`) quoting `Save 20%`, with page text `Save 25% today` → needs_review, and `quoteProblems` is `['Save 20%']`.
  - The same point with page text `SAVE    20%` (case and whitespace differ) → pass.
  - The judge says `verdict: 'pass'` but one point is `not_met` → fail.
  - `parseJudgeOutput('not json')` → null.

- [ ] **Step 2: Run the tests and confirm they fail.**
  - Run: `node --test test/verdict.test.ts`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Commit.**
  - `git add -A && git commit -m "feat: verdict rules with quote check"`

### Task 10: Token accounting

**Files:**
- Create:
  - `visual-qa/src/tokens.ts`
  - `visual-qa/test/fixtures/transcripts/<sid>.jsonl`
  - `visual-qa/test/fixtures/transcripts/<sid>/subagents/agent-a1.jsonl`, `agent-a1.meta.json` (`"description":"QA judge CO-01"`), `agent-a2.jsonl`, `agent-a2.meta.json` (`"description":"QA takeover CO-02"`)
- Test: `visual-qa/test/tokens.test.ts`

**Interfaces:**
- Produces:

```ts
export type Usage4 = { input: number; cacheWrite: number; cacheRead: number; output: number };
export type ClaudeTokens = { available: true; orchestration: Record<string, Usage4>; byScenario: Record<string, Record<string, Usage4>>; total: Record<string, Usage4> } | { available: false; error: string };
export type JevTokens = { byScenario: Record<string, { input: number; output: number }>; total: { input: number; output: number } };
export function claudeTokens(sessionId: string, sinceIso: string, configDir = process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude')): ClaudeTokens;
export function jevTokens(events: Array<Record<string, unknown>>): JevTokens;
```

- **Parsing rules:**
  - Locate `projects/*/<sid>.jsonl`.
  - Subagents are in `projects/*/<sid>/subagents/agent-*.jsonl`, each paired with `.meta.json`.
  - Count only lines with `type === 'assistant'`, `message.usage` present and `timestamp >= sinceIso`.
  - **De-duplicate by `message.id`** within each file, keeping the first.
  - Sum `input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens` and `output_tokens` per `message.model`.
  - Attribute subagent files via `/^QA (takeover|judge) ([A-Za-z0-9_-]+)$/` on the description. Unmatched subagents go to orchestration.
  - Malformed lines are skipped. A missing main file gives `{available:false, error:'transcript not found'}`.

- [ ] **Step 1: Write failing tests**
  - The fixture main file has 3 assistant lines, 2 of them sharing one `message.id`, plus 1 line before `sinceIso`.
  - Orchestration sums exactly one copy of the duplicated message and excludes the early line. Assert exact numbers.
  - `byScenario['CO-01']` comes from agent-a1 and `byScenario['CO-02']` from agent-a2.
  - **Review Focus 5:**
    - A line `{"broken` is skipped without throwing.
    - An unknown session → `available:false`.
  - `jevTokens` sums `jev_decision` events per scenario.

- [ ] **Step 2: Run the tests and confirm they fail.**
  - Run: `node --test test/tokens.test.ts`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Commit.**
  - `git add -A && git commit -m "feat: Claude transcript and Jev token accounting"`

### Task 11: Report rendering and `qa report`

**Files:**
- Create: `visual-qa/src/report.ts`
- Modify: `visual-qa/src/daemon.ts` (the `report` command)
- Test: `visual-qa/test/report.test.ts`

**Interfaces:**
- Consumes: `computeVerdict`, `parseJudgeOutput` (Task 9); `claudeTokens`, `jevTokens` (Task 10); `run.json` and events (Tasks 7–8).
- Produces:

```ts
export type ReportRow = { id: string; title: string; steps: string[]; expected: string; verdict: Verdict; reason: string; keyPoints: KeyPoint[]; quoteProblems: string[]; gates: { httpStatus: number | null; consoleErrors: string[]; errorPhrase: string | null }; handbacks: Array<{ step: number; reason: string; detail?: string }>; madeUp: Record<string,string>; jevActions: number; claudeActions: number; elapsedMs: number; viewportShot: string | null; fullPageShot: string | null; jevTokens: { input: number; output: number }; claudeTokens: Record<string, Usage4> };
export type ReportModel = { topic: string; startedAt: string; baseUrl: string; durationMs: number; counts: Record<Verdict, number>; rows: ReportRow[]; jev: JevTokens; claude: ClaudeTokens };
export function buildReportModel(runDir: string): ReportModel;
export function renderReport(m: ReportModel, readImage: (p: string) => Buffer): string;
```

- **`qa report`:**
  - Writes `report.html` and `results.json` (the `ReportModel`) to `runDir`.
  - Returns `{ reportPath, summary: "8 pass · 1 fail · 1 needs review" }`. Omit zero counts, but always show pass.
- **Page layout** follows the spec's §6.7 sketch:
  - header with counts and total time;
  - rows sorted fail, then needs_review, then pass;
  - verdict filter buttons using a tiny inline script;
  - thumbnail → full-size overlay on click;
  - a `<details>` per row with key points, gates, hand-backs, made-up values and the full-page shot;
  - a token footer:
    - Jev in/out;
    - Claude per model: new input / cache write / cache read / output, plus an orchestration line.
- **Images** are embedded as `data:image/jpeg;base64,...`. No external URLs at all.
- **Rows that never started** show "not run" instead of an image.

- [ ] **Step 1: Write failing tests**
  - Build a synthetic run folder with 3 scenarios: pass, fail and gave-up-tooling.
  - **Ordering:** the rendered HTML contains the FAIL row before the NEEDS REVIEW row, which is before the PASS row.
  - **Self-contained:** contains `data:image/jpeg;base64,`; `/src="https?:/` doesn't match and `/href="https?:/` doesn't match.
  - **Made-up value:** the made-up value "1 Test Street" appears in the fail row's details.
  - **Summary:** the summary string is `1 pass · 1 fail · 1 needs review`.
  - **Review Focus 5:** with `claude.available === false`, the footer contains `Claude tokens unavailable` and rendering doesn't throw.
  - **Escaping:** a scenario title containing `<script>` is HTML-escaped.

- [ ] **Step 2: Run the tests and confirm they fail.**
  - Run: `node --test test/report.test.ts`
- [ ] **Step 3: Implement `report.ts` and wire up the `report` command.**
  - The command reads `sessionId` and `startedAt` from `run.json`.
- [ ] **Step 4: Run the tests and confirm they pass**, then run `npm test && npm run typecheck`.
- [ ] **Step 5: Commit.**
  - `git add -A && git commit -m "feat: self-contained HTML report with token footer"`

### Task 12: Doctor and login

**Files:**
- Create: `visual-qa/src/doctor.ts`, `visual-qa/src/login.ts`
- Modify: `visual-qa/bin/qa.ts` (the `doctor` and `login` commands)
- Test: `visual-qa/test/doctor.test.ts`

**Interfaces:**
- Produces:
  - `runDoctor(deps: { env: NodeJS.ProcessEnv; nodeVersion: string; chromiumPath: () => string; fileExists: (p: string) => boolean; pingJev: () => Promise<void> }): Promise<{ ok: boolean; checks: Array<{ name: string; ok: boolean; level: 'error' | 'warning'; detail: string }> }>`
  - `login(name: string, url: string): Promise<{ saved: string }>`

- **Checks:**

  | Check | Level | Pass condition | Failure detail |
  |---|---|---|---|
  | `node` | error | ≥ 22.18 | |
  | `chromium` | error | executable exists | "run: npx playwright install chromium" |
  | `typesafe_key` | error | key found; detail names the source only | |
  | `jev_reachable` | error | the `noul("Is this a test?")` ping succeeds | the error kind |
  | `anthropic_api_key` | warning | `ANTHROPIC_API_KEY` not set | "ANTHROPIC_API_KEY is set — Claude Code may bill the API instead of your subscription; check /status" |

  `ok` is false only when an `error`-level check fails.
- **`login`:**
  - Opens a headed Chromium, creates a context and navigates to the URL.
  - Prints `Sign in, then close the browser window.`
  - Saves `context.storageState()` to a temp file every 2 s and on page `close`.
  - Then moves it to `<stateDir>/sessions/<name>.json` with mode 600.

- [ ] **Step 1: Write failing tests**
  - Using `runDoctor` with injected dependencies:
    - all good → `ok: true`;
    - `ANTHROPIC_API_KEY` set → `ok: true`, with a warning whose detail contains `/status`;
    - no key → `ok: false`;
    - ping throws `JevError('fatal')` → `ok: false`, with `jev_reachable` detail `fatal`.
  - The output JSON never contains the key value. Assert this with a sentinel key `sk-SENTINEL` in the env.

- [ ] **Step 2: Run the tests and confirm they fail.**
  - Run: `node --test test/doctor.test.ts`
- [ ] **Step 3: Implement both modules and wire up the CLI commands.**
- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 4b: Check `login` by hand**
  - Run: `node bin/qa.ts login fixture-user http://localhost:4173/login.html`, with `node test/fixtures/serve.ts` running.
  - Sign in on the fixture page and close the window.
  - Expected: `~/.visual-qa/sessions/fixture-user.json` exists with mode `-rw-------`.
- [ ] **Step 5: Commit.**
  - `git add -A && git commit -m "feat: doctor preflight and saved-session login"`

### Task 13: SKILL.md, subagent briefs and installation

**Files:**
- Create: `visual-qa/SKILL.md`, `visual-qa/reference/takeover.md`, `visual-qa/reference/judge.md`, `visual-qa/reference/scenario-format.md`
- Test: `visual-qa/test/skill-files.test.ts`

**Interfaces:**
- Consumes: the CLI commands (Task 8, 11, 12).

**`SKILL.md` frontmatter:**

```yaml
---
name: visual-qa
description: Run plain-language browser test scenarios — Jev navigates, Claude takes over when stuck and judges screenshots — and write a local HTML report with inline screenshots and token usage.
argument-hint: [scenarios.yaml]
disable-model-invocation: true
model: sonnet
allowed-tools: Bash(node ${CLAUDE_SKILL_DIR}/bin/qa.ts *) Read Write Agent
---
```

**Body** (a checklist, under 120 lines). All commands are `node ${CLAUDE_SKILL_DIR}/bin/qa.ts …`.
1. **Doctor.**
   - On error-level failures, stop and show the fix.
   - On the `anthropic_api_key` warning, ask the user whether to continue.
   - Mention once that page text is sent to TypeSafe.
2. **Input.**
   - A `.yaml`/`.yml` path in `$ARGUMENTS` → `validate` it via `start`'s error output.
   - Otherwise, draft YAML following `reference/scenario-format.md` into `~/QA/scenarios/<topic>.yaml`, show it, and wait for the user's OK.
3. **Start:** `start <file> --session ${CLAUDE_SESSION_ID}`.
4. **Run each scenario in order.**
   - `run <id>`.
   - On `handback` with `jev_unavailable`, ask the user: Claude drives the rest, or stop.
     - Stop → `giveup` the remaining scenarios with `tooling_or_environment` / "Jev unavailable".
   - On any other `handback` (or when Claude drives), spawn an Agent:
     - `description: "QA takeover <id>"`, `model: "sonnet"`;
     - prompt: `reference/takeover.md`, with the RunResult JSON and command path filled in;
     - wait for it before continuing.
5. **Judge.** For each scenario that completed without giving up, run `evidence <id>`, then spawn an Agent:
   - `description: "QA judge <id>"`, model from `judgeModel`;
   - prompt: `reference/judge.md` with the evidence JSON;
   - start all judges in one message so they run in parallel, then wait for all of them.
6. **Finish:** `report`, then `stop`. Tell the user the report path and the summary line.

**`takeover.md`** contains, verbatim from the spec's §6.3:
- the command list: `look`, `act`, `shot`, `step-done`, `resume`, `giveup`;
- never type passwords or payment details;
- a login wall → `giveup --class tooling_or_environment --reason "session expired — run qa login"`;
- the made-up data rules (`--made-up`, obviously fake values);
- if the app rejects a made-up value → give up as `tooling_or_environment`;
- the 25-action budget;
- after unblocking a step: `step-done`, then `resume` (unless the reason is `jev_unavailable`, in which case do all the steps yourself);
- the give-up classes;
- reply with only `{"status":"completed|gave_up","stepsDone":n,"note":"..."}`.

**`judge.md`** contains:
- read the viewport screenshot and the text file; read the full-page screenshot only if a key point can't be checked from the viewport;
- split `expected` into key points; each gets `met`/`not_met`/`unclear` with a verbatim evidence quote and its `source`;
- write JSON matching `JudgeOutput` to `judgeOutputPath` with the Write tool;
- never guess: if something can't be seen, it's `unclear`;
- reply `written`.

The judge brief must not mention Jev, Claude actions, or how the steps were executed.

- [ ] **Step 1: Write failing tests**
  - The `SKILL.md` frontmatter parses, and has `disable-model-invocation: true` and `model: sonnet`.
  - The body contains `${CLAUDE_SESSION_ID}`, `QA takeover`, `QA judge`, and every CLI command it uses exists in `bin/qa.ts`'s command table (import the table).
  - `judge.md` doesn't match `/jev|takeover|action log/i`.
  - Body length is under 120 lines.
- [ ] **Step 2: Run the tests and confirm they fail.**
  - Run: `node --test test/skill-files.test.ts`
- [ ] **Step 3: Write the four files.**
- [ ] **Step 4: Run the tests and confirm they pass**, then run `npm test`.
- [ ] **Step 5: Install.**
  - Run: `ln -s "$(pwd)" ~/.claude/skills/visual-qa` from `visual-qa/`. Leave any existing path alone and report it instead.
  - Expected: `ls -l ~/.claude/skills/visual-qa` shows the symlink.
- [ ] **Step 6: Commit.**
  - `git add -A && git commit -m "feat: visual-qa SKILL.md and subagent briefs"`

### Task 14: Live acceptance

**Files:**
- Create:
  - `visual-qa/test/acceptance/fixture-suite.yaml`
  - broken fixture variants in `test/fixtures/site/broken/`: a cart that doesn't increment, a missing "Save 20%" badge, a form whose Submit does nothing, and a search with no results
  - `docs/superpowers/notes/2026-11-15-acceptance.md`

**Interfaces:**
- Consumes: everything.

**The suite has 12 scenarios, matching the spec's §9:**
- simple navigation
- search with Enter
- form with explicit submit
- identical "Add to cart" labels
- iframe widget
- file upload (`values` gives the fixture file path)
- login via the saved session `fixture-user`
- German labels
- 4 deliberately broken scenarios

- [ ] **Step 1: Write the suite and the broken variants.**
- [ ] **Step 2: Start the fixture server.**
  - Run: `node test/fixtures/serve.ts` in the background.
  - Expected: it serves on `http://localhost:4173`.
- [ ] **Step 3: The user runs the suite.**
  - Ask the user to type `/visual-qa visual-qa/test/acceptance/fixture-suite.yaml` in Claude Code.
  - The skill only runs when invoked by a person.
- [ ] **Step 4: Check the pass criteria and record them in the notes**
  - No human input after the doctor step.
  - **None of the 4 broken scenarios is PASS.**
  - `report.html` opens offline with 12 images, or "not run" placeholders.
  - The token footer shows Jev and Claude numbers.
  - The Jev/Claude step counts show Jev doing most steps on the simple flows.
  - Note every false verdict and hand-back reason.
- [ ] **Step 5: Fix any defects** through the owning task's tests first, then re-run.
- [ ] **Step 6: Commit.**
  - `git add -A && git commit -m "test: live acceptance suite and results"`
