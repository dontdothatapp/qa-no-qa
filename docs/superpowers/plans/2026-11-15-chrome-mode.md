# Chrome Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run scenarios as tabs inside the user's running Chrome, using their sign-ins. This becomes the default (`browser: chrome`). The headless browser stays as `browser: isolated`.

**Architecture:**
- **Connecting:** the daemon connects to the user's Chrome with `chromium.connectOverCDP`. The endpoint comes from Chrome's `DevToolsActivePort`, written once remote debugging is on at `chrome://inspect/#remote-debugging`. The user clicks Allow once per run.
- **Scenarios in tabs:** `openScenario` gains a shared-context path: a new tab in Chrome's default context, given the suite viewport. Finishing closes the tab only.
- **Popups:** popup detection moves from `context.on('page')` to `page.on('popup')`, so tabs the user opens are ignored.
- **Tests:** a Chromium launched with `--remote-debugging-port` stands in for "your Chrome". It uses the same `connectOverCDP` path, minus the Allow click.

**Tech Stack:** unchanged (Node ≥ 22.18, Playwright 1.65, `node:test`).

**Spec:** `docs/superpowers/specs/2026-11-15-visual-qa-skill-design.md` §12. The base plan's Global Constraints still apply: `docs/superpowers/plans/2026-11-15-visual-qa-skill.md`.

## Global Constraints

- **Never read, list, screenshot or close a tab the run did not open.** Never close the user's Chrome: on a connected browser, `browser.close()` only disconnects (verified in the spike).
- **Default mode** is `browser: chrome`. `browser: isolated` keeps every existing behaviour and test.
- **Waiting for Allow:**
  - The connect timeout is 100 s, so the user has time to click Allow.
  - `qa start` waits up to 110 s for the daemon in chrome mode, still within Claude Code's 120 s Bash default.
  - While it waits, `start` writes `Click "Allow" in Chrome to let the QA run connect.` to stderr.
- **Endpoint lookup order:**
  1. `VISUAL_QA_CHROME_ENDPOINT` (tests);
  2. `<VISUAL_QA_CHROME_DATA_DIR or ~/Library/Application Support/Google/Chrome>/DevToolsActivePort`. Line 1 is the port, line 2 the path, giving `ws://127.0.0.1:<port><path>`.
- **Error copy when the endpoint is missing:** `remote debugging is off in Chrome — open chrome://inspect/#remote-debugging and switch it on (or set browser: isolated)`.
- **Report note in chrome mode:** `Ran in your Chrome (shared sign-ins and state)`.

## Review Focus

1. **The user opens or closes their own tabs during a run.** No `new_tab` hand-back, no crash, and their tabs stay untouched. *(Task 3 test.)*
2. **The user never clicks Allow, or remote debugging is off.** `qa start` fails within its deadline with the error copy above, and leaves no daemon behind. *(Task 4 test.)*
3. **The user closes Chrome mid-run.** The scenario hands back with `error`, and `report` still works through the run-folder fallback. *(Task 4 test: close the stand-in browser mid-run.)*
4. **The suite uses `session:` in chrome mode.** `start` succeeds with a note instead of the "session not found" error. *(Task 4 test.)*
5. **A long run with many tabs.** Every scenario tab is closed after completion or give-up, so tab count returns to the starting count. *(Task 3 test.)*

---

### Task 1: `browser` in scenario files

**Files:**
- Modify: `visual-qa/src/types.ts`, `visual-qa/src/scenarios.ts`, `visual-qa/reference/scenario-format.md`
- Test: `visual-qa/test/scenarios.test.ts`

**Interfaces:**
- Produces: `Suite.browser: 'chrome' | 'isolated'`.

- [ ] **Step 1: Write failing tests**
  - `browser` defaults to `'chrome'`.
  - `browser: isolated` → `'isolated'`.
  - `browser: firefox` → problem `browser: must be chrome or isolated`.
- [ ] **Step 2:** Run `node --test test/scenarios.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**, and document `browser:` in `scenario-format.md`.
  - Add the shared-state guidance: "in chrome mode scenarios share your sign-ins and site state; put any reset in the steps".
  - Update the existing tests' suite fixtures where they now need `browser: isolated`: CLI tests, the daemon test suites and acceptance runs that rely on a fresh context.
- [ ] **Step 4:** Run `node --test test/scenarios.test.ts`. Expected: PASS.
- [ ] **Step 5:** Commit with `feat: browser mode in scenario files`.

### Task 2: Chrome endpoint lookup and connect

**Files:**
- Create: `visual-qa/src/chrome.ts`
- Test: `visual-qa/test/chrome.test.ts`

**Interfaces:**
- Produces:
  - `findChromeEndpoint(env = process.env): string | null`
  - `connectChrome(endpoint: string, timeoutMs = 100_000): Promise<Browser>`
  - `CHROME_OFF_MESSAGE`, which holds the exact error copy.

- [ ] **Step 1: Write failing tests**
  - The env override wins.
  - A temp data dir with a `DevToolsActivePort` file of `"9444\n/devtools/browser/abc"` gives `ws://127.0.0.1:9444/devtools/browser/abc`.
  - A missing file → `null`.
  - `connectChrome` against a Chromium launched in the test with `--remote-debugging-port=0` succeeds. Read the port from that browser's `DevToolsActivePort` in its temp `--user-data-dir`.
- [ ] **Step 2:** Run `node --test test/chrome.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run `node --test test/chrome.test.ts`. Expected: PASS.
- [ ] **Step 5:** Commit with `feat: find and connect to the user's Chrome`.

### Task 3: Scenario tabs in a shared context

**Files:**
- Modify: `visual-qa/src/scenario-runner.ts`
- Test: `visual-qa/test/runner-chrome.test.ts`

**Interfaces:**
- Consumes: `connectChrome` (Task 2).
- Produces:
  - `openScenarioInContext(ctx: BrowserContext, suite, s, madeUp, t): Promise<ScenarioState>`. It opens a new tab, calls `setViewportSize(suite.viewport)` and sets `state.ownsContext = false`.
  - `closeScenario(state)`, which closes the page when `ownsContext` is false and the context otherwise.
  - `openScenario` sets `ownsContext = true`.
  - Popup detection uses `page.on('popup')` in both modes.

- [ ] **Step 1: Write failing tests**
  - The stand-in Chrome has one pre-existing tab. The tests then check:
    - The scenario completes. `closeScenario` → the pre-existing tab is still open and the tab count is back to the starting count.
    - The tab viewport is 1280×800.
    - A tab opened by "the user" mid-run (`ctx.newPage()` from the test) → no `new_tab` hand-back; the scenario completes.
    - A `target=_blank` click in the scenario tab → `new_tab`.
  - The existing isolated popup test still passes.
- [ ] **Step 2:** Run `node --test test/runner-chrome.test.ts test/runner.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit with `feat: run scenarios as tabs in a shared browser context`.

### Task 4: Daemon and CLI in chrome mode

**Files:**
- Modify: `visual-qa/src/daemon.ts`, `visual-qa/bin/qa.ts`
- Test: `visual-qa/test/daemon-chrome.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces:
  - In chrome mode, `startDaemon` connects with `connectChrome(findChromeEndpoint())` and opens scenarios with `openScenarioInContext(browser.contexts()[0], …)`.
  - `finishIfDone` uses `closeScenario`.
  - `close()` closes still-open scenario tabs, then disconnects.
  - `run.json` gets `browser`.
  - In chrome mode, `qa start` skips session checks and adds `note` when any scenario names a session. It waits up to 110 s and writes the Allow hint to stderr.

- [ ] **Step 1: Write failing tests.** All use the in-process daemon or the CLI with `VISUAL_QA_CHROME_ENDPOINT` pointing at a stand-in Chromium:
  - `run S1` completes. `stop` → the stand-in browser is still connected-able and its pre-existing tab still exists.
  - With no endpoint (env pointing at an empty data dir), `qa start` fails with `CHROME_OFF_MESSAGE` and no daemon is left.
  - The stand-in browser is closed mid-run → the next `run` returns an `error` hand-back or `{"error"}`, and `qa report` still writes the report.
  - A suite with `session: x` in chrome mode → `start` succeeds and the output has `note` containing `session`.
- [ ] **Step 2:** Run `node --test test/daemon-chrome.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run `node --test test/daemon-chrome.test.ts test/daemon.test.ts`. Expected: PASS.
- [ ] **Step 5:** Commit with `feat: daemon and CLI run in the user's Chrome`.

### Task 5: Doctor, report note, skill text

**Files:**
- Modify: `visual-qa/src/doctor.ts`, `visual-qa/bin/qa.ts` (doctor wiring), `visual-qa/src/report.ts`, `visual-qa/SKILL.md`
- Test: `visual-qa/test/doctor.test.ts`, `visual-qa/test/report.test.ts`, `visual-qa/test/skill-files.test.ts`

**Interfaces:**
- `DoctorDeps` gains `chromeEndpoint: () => string | null`. A new check, `chrome_remote_debugging`, at warning level: `on` or `CHROME_OFF_MESSAGE`.
- `ReportModel.browser`.

- [ ] **Step 1: Write failing tests**
  - Doctor warns with the off message when the endpoint is null, and reports `on` otherwise.
  - The report header contains `Ran in your Chrome (shared sign-ins and state)` only when `browser` is `chrome`.
  - `SKILL.md` mentions `Allow`, and that page text from signed-in pages goes to TypeSafe.
- [ ] **Step 2:** Run those three test files. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run `npm test && npm run typecheck`. Expected: all pass.
- [ ] **Step 5:** Commit with `feat: chrome-mode preflight, report note and skill text`.

### Task 6: Live check in the user's Chrome

- [ ] **Step 1:** Run `node spike/chrome-spike.ts` against the real Chrome; the user clicks Allow. Expected:
  - the background screenshot succeeds;
  - the tab count returns to the starting count;
  - "your Chrome still running after disconnect: yes".
- [ ] **Step 2:** The user signs in to `http://localhost:4173/login.html` in their Chrome once, then runs `/visual-qa visual-qa/test/acceptance/fixture-suite.yaml` (the default, which is now chrome mode).
- [ ] **Step 3:** Record the results in `docs/superpowers/notes/2026-11-15-acceptance.md`. They pass if no broken scenario is PASS and the user's own tabs are untouched.
