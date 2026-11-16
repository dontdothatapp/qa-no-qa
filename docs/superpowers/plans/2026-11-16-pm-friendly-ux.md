# Visual QA for PMs and Designers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Visual QA usable by a non-developer. They paste a checklist as-is. Tests always run in their own Chrome. Setup is one pasted instruction plus a guided `/visual-qa:setup`.

**Architecture:**
- **Runner core stays** (route A). Today's YAML is the internal format, extended with `notes`, `groups`, `source`, `relies_on` and `logged_out`. Isolated mode, saved sessions and `qa login` are removed. Every test runs in the person's Chrome: signed-in tests in tabs, logged-out tests in a separate browser context of the same Chrome.
- **New verdict rules:**
  - A fourth outcome, NOT RUN.
  - Checkpoint captures for `relies_on`, judged alongside the expected result.
  - "Wrong page" can never be PASS or FAIL.
- **Packaging:** the repo becomes a Claude Code marketplace (`qa-no-qa`) holding one plugin (`visual-qa`) with skills `test` and `setup`.

**Tech Stack:** Node ≥ 22.18 (built-in TypeScript type stripping), Playwright 1.65 (`connectOverCDP` only at runtime), `@typesafe-ai/sdk`, `yaml`, `node:test`. Claude Code plugin system.

**Spec:** `docs/superpowers/specs/2026-11-16-pm-friendly-ux-design.md`. Background: `docs/superpowers/specs/2026-11-15-visual-qa-skill-design.md` (incl. §12). The earlier plans' constraints still apply unless changed here: `docs/superpowers/plans/2026-11-15-visual-qa-skill.md`, `docs/superpowers/plans/2026-11-15-chrome-mode.md`.

## Global Constraints

**Platform and packaging**
- macOS only. Node ≥ 22.18. No new runtime dependencies.
- Names:
  - marketplace `qa-no-qa` at `.claude-plugin/marketplace.json`
  - plugin `visual-qa` at `visual-qa/.claude-plugin/plugin.json`
  - skills `visual-qa/skills/test/SKILL.md` and `visual-qa/skills/setup/SKILL.md`
  - person-facing commands `/visual-qa:test` and `/visual-qa:setup`
- Skill files reference the runner as `node ${CLAUDE_PLUGIN_ROOT}/bin/qa.ts` and `node ${CLAUDE_PLUGIN_ROOT}/bin/setup.ts`. Never write state under `${CLAUDE_PLUGIN_ROOT}`. It is a versioned cache folder.

**Browser**
- Tests only ever run in the person's Chrome: no `chromium.launch()` outside `test/` and `spike/`.
- Never read, touch or close a tab or window the run did not open. Never close Chrome itself.

**Secrets**
- The TypeSafe key is never printed, logged or passed through chat. Key lookup order: `TYPESAFE_API_KEY` env, then `~/.visual-qa/.env`. The project-root `.env` lookup is removed.
- Passwords stay unsupported (unchanged).

**Outcomes and copy (verbatim)**
- Outcomes: `pass`, `fail`, `needs_review`, `not_run`. Labels: `PASS`, `FAIL`, `NEEDS REVIEW`, `NOT RUN`.
- Summary line: `7 pass · 1 fail · 2 needs review · 2 not run`. Zero counts other than pass are omitted, as today.
- Reasons:
  - `Couldn't confirm the test ran on the right page: <what>` — a completed test with an unconfirmed `relies_on` item.
  - `Couldn't find a page that matches: <reason>` — give-up class `no_matching_page`.
  - `Stopped on a page that may not be the right one: <what>` — `app_problem` give-up with an unconfirmed `relies_on` item that was due.
  - `paused before this group` — a test that never started.
- Report header: `Ran in your Chrome (your sign-ins)`.

**Install line, verbatim (README top)**

> Install Visual QA: if Node.js 22.18 or newer isn't installed, install it. Then run `claude plugin marketplace add dontdothatapp/qa-no-qa` and `claude plugin install visual-qa@qa-no-qa`, and tell me to type /reload-plugins and then /visual-qa:setup.

**Setup's closing notes, verbatim (`bin/setup.ts` prints them when everything is ok)**
- Privacy: `While tests run, page text is sent to TypeSafe (Jev's provider) so Jev can choose the next step — including text from pages you're signed in to. Tests act in your real accounts; they never submit, buy or delete anything unless a check asks for it.`
- Updates: `To get updates automatically: type /plugin, open Marketplaces, choose qa-no-qa and turn on auto-update.`

## Review Focus

1. **The judge leaves out or renames a `relies_on` entry.** That item counts as unclear, so the test is NEEDS REVIEW, never PASS. *(Task 5 test.)*
2. **The daemon idle-stops during a long pause.** The next `qa run` fails with an error that names `qa reopen`. `qa reopen` reconnects to the same run folder and never re-runs finished tests. *(Task 4 test.)*
3. **`~/.visual-qa/.env` already holds a key, or other lines.** `setup.ts --open-key-file` never overwrites or deletes them. *(Task 8 test.)*
4. **An old scenario file with `browser:` or `session:`.** It is rejected with a message that says what replaced it, not silently run differently. *(Task 1 test.)*
5. **A checkpoint capture fails** (page crashed or closed mid-step). The step still completes, the item has no snapshot, and the verdict is NEEDS REVIEW, not a crash. *(Task 3 test.)*

---

### Task 0: Spike A — logged-out context and opening Chrome's setting page (throwaway)

Needs the person at the keyboard: their real Chrome, and clicking **Allow**.

**Files:**
- Create: `visual-qa/spike/pm-ux-spike.ts`
- Create: `docs/superpowers/notes/2026-11-16-pm-ux-spike.md`

- [ ] **Step 1: Write `spike/pm-ux-spike.ts`.** It must:
  - connect to the real Chrome with `connectChrome(findChromeEndpoint()!)`;
  - call `browser.newContext({ viewport: { width: 1280, height: 800 } })`, open a page at `https://example.com`, and log `context.cookies()` (expect empty);
  - screenshot it while another Chrome window has focus;
  - close the context, then `browser.close()`.

  It records whether a separate window appeared, whether it closed cleanly, and whether the person's tabs were untouched.
- [ ] **Step 2: Run it with the person present.** Run `node visual-qa/spike/pm-ux-spike.ts`. The person clicks Allow. Pass condition: no exception, empty cookies, the window disappears after the close, Chrome stays open.
- [ ] **Step 3: Check `open -a "Google Chrome" "chrome://inspect/#remote-debugging"`.** Ask the person whether the remote-debugging page opened, or a blank or blocked tab.
- [ ] **Step 4: Write the notes file.** One section per item: result, exact error text if any, and the decision:
  - **(a) Logged-out context works:** Task 2 uses it.
  - **(a) It fails:** Task 2 takes the fallback branch.
  - **(b) Works:** Task 8 opens the page.
  - **(b) Fails:** Task 8 shows the address to paste.
- [ ] **Step 5: Commit.**

```bash
git add visual-qa/spike/pm-ux-spike.ts docs/superpowers/notes/2026-11-16-pm-ux-spike.md
git commit -m "chore: spike logged-out context in the user's Chrome and opening chrome://inspect"
```

---

### Task 1: Scenario format — new fields, removed fields

**Files:**
- Modify: `visual-qa/src/types.ts`
- Modify: `visual-qa/src/scenarios.ts`
- Modify: `visual-qa/reference/scenario-format.md` (now a developer reference for the internal format)
- Test: `visual-qa/test/scenarios.test.ts`

**Interfaces:**
- Produces (types.ts):
  ```ts
  export type RelyItem = { what: string; afterStep: number | null }; // 1-based step; null = final page
  export type Group = { id: string; needs: string };
  export type Scenario = {
    id: string; title: string; start: string; steps: string[]; values: Record<string, string>; expected: string;
    group: string | null; source: string | null; reliesOn: RelyItem[]; loggedOut: boolean;
  };
  export type Suite = {
    topic: string; baseUrl: string; viewport: Viewport; allowHosts: string[]; judgeModel: string;
    notes: string | null; groups: Group[]; scenarios: Scenario[]; sourcePath: string;
  };
  ```
  `BrowserMode`, `Suite.browser` and `Scenario.session` are removed.
- Produces (scenarios.ts): `loadSuite(file: string): Suite` (same name, new fields) and `groupOrder(suite: Suite): Array<{ id: string; needs: string | null; scenarios: string[] }>`.
  - With `groups`: the declared groups in file order, each listing its scenario ids in file order.
  - With no `groups`: one entry `{ id: 'default', needs: null, scenarios: [all ids] }`.

**YAML keys:** `notes`, `groups` (list of `{id, needs}`), and per scenario `group`, `source`, `relies_on` (list of `{what, after_step}`) and `logged_out` (boolean).

- [ ] **Step 0: Ask the person about the stray untracked `test/* 2.ts` files.** 11 are identical copies; `network.test 2.ts` is an older version. `tsconfig.json` includes `test/`, so they will break `npm run typecheck` once the code they import changes. Offer two options: delete them, or add `"exclude": ["**/* 2.ts"]` to `tsconfig.json`. Do what they choose.
- [ ] **Step 1: Write failing tests in `test/scenarios.test.ts`.** Replace the session and browser tests (`valid file: session none…`, `browser mode…`, `session: none … rejected in chrome mode`) with:
  - `parses notes, groups, source, relies_on and logged_out`. Assertions:
    - `suite.notes === 'PBSA IDs: a, b'`
    - `suite.groups` deep-equals `[{id:'g1',needs:'Flag ON'},{id:'g2',needs:'Flag OFF'}]`
    - `s.group === 'g1'`
    - `s.source === '☐ French listing → address shows'`
    - `s.reliesOn` deep-equals `[{what:'The listing is in France',afterStep:1},{what:'Shown on the final page',afterStep:null}]`
    - `s.loggedOut === true`
  - `defaults: no notes, no groups, no relies_on, signed in`. Assertions: `notes === null`, `groups` deep-equals `[]`, `group === null`, `source === null`, `reliesOn` deep-equals `[]`, `loggedOut === false`.
  - `groupOrder: declared groups in order; no groups → one default group`.
  - `old fields are rejected with what replaced them`. Problems include, exactly:
    - `browser: no longer supported — tests always run in your Chrome (use logged_out: true for signed-out tests)`
    - `session: no longer supported — tests use your Chrome sign-ins (use logged_out: true for signed-out tests)`

    The same session message, prefixed `<id>: `, appears for a per-scenario `session:`.
  - `invalid groups and relies_on are reported together`. Problems include, exactly:
    - `S1: group "g9" is not defined in groups`
    - `S2: missing "group" (every scenario needs one when groups are defined)`
    - `S1: relies_on[0].after_step must be a step number from 1 to 2`
    - `S1: relies_on[1]: missing "what"`
    - `groups[1]: duplicate id "g1"`
    - `groups[0]: missing "needs"`
- [ ] **Step 2: Run the tests and confirm they fail.** `cd visual-qa && node --test test/scenarios.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement it in `src/types.ts` and `src/scenarios.ts`.** Keep the "collect all problems, then throw `SuiteError`" style. Remove `SESSION_NAME`, `LOGGED_OUT_IN_CHROME` and the session handling. Add `groupOrder`.
- [ ] **Step 4: Update `reference/scenario-format.md`.**
  - Document the new and removed fields in the existing commented-YAML style.
  - Drop the browser-mode and `session` guidance.
  - Add: one check = one scenario; steps find their own pages; `relies_on` lists conditions a page can show, with the step after which they're visible; `source` is the checklist line, verbatim.
- [ ] **Step 5: Run the tests and confirm they pass.** `node --test test/scenarios.test.ts` → PASS. The full `npm test` may fail elsewhere until Task 2 lands. That is expected.
- [ ] **Step 6: Commit.**

```bash
git add visual-qa/src/types.ts visual-qa/src/scenarios.ts visual-qa/reference/scenario-format.md visual-qa/test/scenarios.test.ts
git commit -m "feat: scenario format gains notes, groups, source, relies_on, logged_out; browser/session removed"
```

---

### Task 2: Runner always uses the person's Chrome; logged-out tests in their own context

**Files:**
- Modify: `visual-qa/src/scenario-runner.ts`: `openScenario` → `openLoggedOutScenario`, no `sessionFile`
- Modify: `visual-qa/src/daemon.ts`: always `connectChrome`; drop `sessionFile`, `chromium.launch` and the `chromeMode` branches
- Modify: `visual-qa/src/chrome.ts`: `CHROME_OFF_MESSAGE` drops `(or set browser: isolated)`
- Modify: `visual-qa/bin/qa.ts`: remove the `login` command, session checks and the "session: is ignored" note
- Delete: `visual-qa/src/login.ts`
- Modify: `visual-qa/src/report.ts`: only drop `browser`-dependent code (`ReportModel.browser`, header condition); the full report work is Task 6
- Test: `visual-qa/test/runner-chrome.test.ts`, `visual-qa/test/daemon.test.ts`, `visual-qa/test/daemon-chrome.test.ts`, `visual-qa/test/chrome.test.ts`

**Interfaces:**
- Consumes: `Scenario.loggedOut`, `Suite` without `browser` (Task 1).
- Produces:
  - `openLoggedOutScenario(browser: Browser, suite: Suite, s: Scenario, madeUp: Record<string,string>, t?: RunnerTimeouts, onCreated?: (st: ScenarioState) => void): Promise<ScenarioState>`. It is `browser.newContext({ viewport: suite.viewport })`, with `ownsContext: true`.
  - `COMMANDS` loses `'login'`.

- [ ] **Step 1: Write failing tests in `test/runner-chrome.test.ts`.**
  - `a logged-out test gets its own context with no cookies, and closing it leaves the user's tabs alone`:
    - Set a cookie in `ctx` (the user's context) for the fixture host.
    - `openLoggedOutScenario(browser, suite(s), s, {}, FAST)`.
    - Assert: `(await state.context.cookies()).length === 0`; `state.context !== ctx`; after `closeScenario(state)`, `userTab.isClosed() === false` and `ctx.pages()` still contains `userTab`.
  - `closing the logged-out window mid-test hands back with error`:
    - Open a logged-out scenario, `await state.context.close()`, then `runJev(state, deps(createScriptedClient([{ operation: 'done' }])))`.
    - Assert `status === 'handback'` and `reason === 'error'`.
- [ ] **Step 2: Move `test/daemon.test.ts` onto the stand-in Chrome.**
  - In `before`, start one `launchStandInChrome()`.
  - Drop `browser: isolated` from `suiteFile`.
  - Pass `env: { ...process.env, VISUAL_QA_CHROME_ENDPOINT: chrome.endpoint }` to `startDaemon` and to the `qa` CLI env.
  - Delete `qa start reports a missing saved session with the login command`.
  - In `daemon-chrome.test.ts`, delete `qa start in chrome mode ignores session: with a note`.
  - Add a daemon test: `run on a logged_out scenario opens and closes its own context`. Assert the stand-in's default-context page count before equals the count after the run.
- [ ] **Step 3: Run the tests and confirm they fail.** `node --test test/runner-chrome.test.ts test/daemon.test.ts`. Expected: FAIL (`openLoggedOutScenario` is not exported; the daemon still launches Chromium).
- [ ] **Step 4: Implement the change.** In the daemon's `run`: `s.loggedOut ? openLoggedOutScenario(browser, …) : openScenarioInContext(browser.contexts()[0], …)`. Fix the error copy:
  - the password refusal drops `(or use qa login in isolated mode)`;
  - the lost-connection message always says `(was Chrome closed?)`.

  **Fallback branch** (only if Task 0 found `newContext()` fails on the real Chrome):
  - Do not add `openLoggedOutScenario`. A `loggedOut` scenario runs in a normal tab.
  - `loadSuite` requires every `logged_out: true` scenario to be in the last group.
  - Task 7's intake brief gives that group `needs: "Signed out of <site> in Chrome"`.
  - Replace the Step 1 tests with a `loadSuite` test for that rule.
- [ ] **Step 5: Run the full suite and confirm it passes.** `npm test && npm run typecheck`. Expected: all PASS, no reference left to `login`, `session` or `isolated` in `src/` or `bin/`. Check with `grep -rn "isolated\|sessionFile\|qa login" src bin` → no matches.
- [ ] **Step 6: Commit.**

```bash
git add -A visual-qa/src visual-qa/bin visual-qa/test
git commit -m "feat: always run in the user's Chrome; logged-out tests get their own context; remove saved logins"
```

---

### Task 3: Checkpoints for `relies_on` and the `evidence` command

**Files:**
- Modify: `visual-qa/src/evidence.ts`
- Modify: `visual-qa/src/scenario-runner.ts`
- Modify: `visual-qa/src/daemon.ts`: `step-done` uses `markStepDone`; `ScenarioRecord.checkpoints`; `evidence` output
- Test: `visual-qa/test/runner-chrome.test.ts`, `visual-qa/test/daemon.test.ts`

**Interfaces:**
- Consumes: `Scenario.reliesOn` (Task 1).
- Produces:
  - `type Checkpoint = { step: number; url: string; viewportShot: string; textFile: string }` (evidence.ts).
  - `captureCheckpoint(state: ScenarioState, runDir: string, step: number): Promise<Checkpoint>` writes `scenarios/<id>/checkpoint-<step>.jpg` and `checkpoint-<step>.txt`. Text is capped at `DEFAULTS.evidenceTextChars`.
  - `ScenarioState.checkpoints: Checkpoint[]` and `ScenarioRecord.checkpoints: Checkpoint[]`. Older run.json files without the field read as `[]`.
  - `markStepDone(state: ScenarioState, events: EventLog, runDir: string, actor: 'jev' | 'claude', capture: typeof captureCheckpoint = captureCheckpoint): Promise<void>` (scenario-runner.ts):
    - appends `step_done`;
    - calls `advanceStep`;
    - then, if any `reliesOn` item has `afterStep === state.currentStep`, captures one checkpoint for that step with `capture`;
    - a capture error is caught and appended as `{type:'checkpoint_failed', id, step, error}`.

    Both `runJev` (Jev `done`) and the daemon's `step-done` call it with the default `capture`.
  - The `evidence` command returns:
    ```ts
    { id; needsJudge: boolean; scope: 'full' | 'relies_on_only' | null; reason?: string;
      expected?: string; url; title; httpStatus; consoleErrors; errorPhrase; textFile; viewportShot; fullPageShot;
      reliesOn: Array<{ what: string; viewportShot: string | null; textFile: string | null }>; judgeOutputPath: string }
    ```
    - **completed** → `needsJudge: true`, `scope: 'full'`, `expected` set. `reliesOn` holds every item. `afterStep` items take their checkpoint's files (null if none was captured); final-page items take the final evidence files.
    - **gave_up with class `app_problem` and ≥ 1 item with a checkpoint** → `needsJudge: true`, `scope: 'relies_on_only'`, no `expected`. `reliesOn` holds only the items with checkpoints.
    - **any other state** → `needsJudge: false`, `scope: null`, with a short `reason`.

- [ ] **Step 1: Write failing tests.**
  - runner-chrome: `a relies_on item with after_step 1 gets a checkpoint after step 1`.
    - Scenario steps `['one','two']`; `reliesOn [{what:'x', afterStep:1}]`.
    - Scripted Jev `[{operation:'done'},{operation:'done'}]`.
    - Assert `state.checkpoints.length === 1`, `checkpoints[0].step === 1`, and both files exist.
  - runner-chrome: `a failed checkpoint capture does not stop the step`.
    - Call `markStepDone(state, events, runDir, 'claude', async () => { throw new Error('boom'); })` on a state whose `reliesOn` has `afterStep: 1`.
    - Assert it resolves, `state.currentStep === 1`, `state.checkpoints.length === 0`, and the event log has `{type:'checkpoint_failed', step: 1}`.
  - daemon: `evidence lists relies_on files: checkpoint for after_step items, final page otherwise`.
  - daemon: `evidence for an app_problem give-up with a checkpoint is relies_on_only; without one, needsJudge is false`.
- [ ] **Step 2: Run the tests and confirm they fail.** `node --test test/runner-chrome.test.ts test/daemon.test.ts` → FAIL.
- [ ] **Step 3: Implement `captureCheckpoint`, `markStepDone`, the record field and the `evidence` output.** `persist()` copies `state.checkpoints`.
- [ ] **Step 4: Run the full suite and confirm it passes.** `npm test` → PASS.
- [ ] **Step 5: Commit.**

```bash
git add visual-qa/src visual-qa/test
git commit -m "feat: capture checkpoints for relies_on and expose them in qa evidence"
```

---

### Task 4: Run lifecycle — groups, skip, reopen, continue

**Files:**
- Modify: `visual-qa/bin/qa.ts` (`start` options and output, new commands)
- Modify: `visual-qa/src/daemon.ts` (`skip`, guards for finished tests after reopen, `RunFile.continuesFrom`)
- Modify: `visual-qa/src/daemon-client.ts` (unreachable message)
- Create: `visual-qa/src/runs.ts` (`findLatestUnfinishedRun`)
- Test: `visual-qa/test/daemon.test.ts`, `visual-qa/test/runs.test.ts`

**Interfaces:**
- Consumes: `groupOrder(suite)` (Task 1).
- Produces:
  - **`qa start <file> --session <id> [--only <id,id,…>] [--continues <runDir>]`.**
    - Copies `<file>` to `<runDir>/tests.yaml`. It copies the first of these that exists to `<runDir>/checklist.txt`: the sibling `<file without .yaml/.yml>.checklist.txt`, or `checklist.txt` in the same folder. The second form is what a continued run started from an earlier run folder finds.
    - `--only` keeps just those scenario ids, in file order; groups left with no scenarios are dropped.
    - `--continues` is stored as `RunFile.continuesFrom` (absolute path, or `null`).
    - Output: `{ runDir, scenarios, groups: [{id, needs, scenarios}], judgeModel }`. The `browser` and `note` keys are gone.
  - **`qa skip <id> --reason "<text>"`** marks a never-started scenario `status: 'skipped'` with `skipReason`. It errors with `scenario <id> already started` otherwise.
    - `ScenarioRecord.status` gains `'skipped'`. `ScenarioRecord` gains `skipReason: string | null`.
  - **`qa reopen [--run-dir <dir>]`**:
    - If the current run's daemon is alive → `{ reopened: false, alive: true, runDir }`.
    - Otherwise it spawns a daemon on that existing run folder (same 110 s Allow deadline and stderr line as `start`), rewrites current-run state, and returns `{ reopened: true, runDir }`.
    - The daemon's `run` returns the stored result, without opening a tab, for any scenario whose run.json status is `completed`, `gave_up` or `skipped`.
  - **`qa remaining`** → `findLatestUnfinishedRun(outputRoot())`, or `{ found: false }`.
  - **`findLatestUnfinishedRun(outputRoot: string): { runDir: string; testsFile: string; groups: Array<{id: string; needs: string | null; scenarios: string[]}> } | null`.**
    - Scans `<outputRoot>/*/run.json` and takes the newest `startedAt` that has any scenario with status `not_started`.
    - `groups` lists only those not-started ids.
  - When the daemon is unreachable, `sendCommand`'s error message is: `the run's connection to Chrome has ended (e.g. after a long pause) — run: qa reopen`.

- [ ] **Step 1: Write failing tests.**
  - daemon CLI: `start lists groups in order and copies the test file and checklist into the run folder`.
    - Assert `out.groups` deep-equals the expected groups.
    - Assert `tests.yaml` and `checklist.txt` exist in `runDir`.
  - daemon CLI: `start --only keeps those tests and drops empty groups; --continues is recorded`.
  - daemon: `skip marks a never-started test skipped; skipping a started test is refused`.
  - daemon CLI: `after the daemon stops, run says to reopen; reopen reconnects and does not re-run finished tests`.
    - Run S1 to `completed`. Stop the daemon by killing its pid.
    - Assert `qa run S2` error contains `qa reopen`.
    - Run `qa reopen` → `reopened: true`.
    - `qa run S1` returns `status: 'completed'` and no new `scenario_start` event for S1. `qa run S2` works.
  - runs.test: `findLatestUnfinishedRun picks the newest run with not-started tests and lists only those`. Build three fake run folders with run.json files; the newest has all tests finished, so the middle one is returned.
- [ ] **Step 2: Run the tests and confirm they fail.** `node --test test/daemon.test.ts test/runs.test.ts` → FAIL.
- [ ] **Step 3: Implement it.** `reopen` shares a `spawnDaemon(runDir, chromeDeadlineMs)` helper with `start`. Extract it from today's `start`; don't duplicate the code.
- [ ] **Step 4: Run the full suite and confirm it passes.** `npm test` → PASS.
- [ ] **Step 5: Commit.**

```bash
git add visual-qa/bin visual-qa/src visual-qa/test
git commit -m "feat: groups in start, skip, reopen after a long pause, and continue a paused run as a new run"
```

---

### Task 5: Verdict rules — relies_on, not run, no_matching_page

**Files:**
- Modify: `visual-qa/src/verdict.ts`
- Modify: `visual-qa/src/scenario-runner.ts` (`GaveUp.class`)
- Modify: `visual-qa/src/daemon.ts` (`giveup` accepts the new class)
- Test: `visual-qa/test/verdict.test.ts`, `visual-qa/test/daemon.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type Verdict = 'pass' | 'fail' | 'needs_review' | 'not_run';
  export type RelyResult = { what: string; status: 'met' | 'not_met' | 'unclear'; evidence: string; source: 'text' | 'screenshot' };
  export type JudgeOutput = { keyPoints: KeyPoint[]; reliesOn: RelyResult[]; verdict: Verdict; reason: string }; // reliesOn missing in JSON → []
  export type GaveUpInfo = { class: 'app_problem' | 'tooling_or_environment' | 'no_matching_page'; reason: string };
  export function computeVerdict(i: {
    judge: JudgeOutput | null; pageText: string; gaveUp: GaveUpInfo | null;
    skipped: string | null;                                  // skip reason
    reliesOn: Array<{ what: string; pageText: string }>;    // the items due: all for completed tests, checkpointed ones for give-ups
  }): { verdict: Verdict; reason: string; quoteProblems: string[] };
  ```
- **Rules, in this order:**
  1. `skipped` → `not_run`, reason = the skip reason.
  2. `no_matching_page` → `needs_review`, reason `Couldn't find a page that matches: <gaveUp.reason>`.
  3. `tooling_or_environment` → `needs_review` (as today).
  4. `app_problem`:
     - no items due → `fail` (as today);
     - otherwise every due item must be confirmed (rule A) → `fail`, with the give-up reason;
     - otherwise `needs_review`, reason `Stopped on a page that may not be the right one: <first unconfirmed what>`.
  5. Completed:
     - no judge → `needs_review` (as today);
     - any due item unconfirmed → `needs_review`, reason `Couldn't confirm the test ran on the right page: <what>`;
     - otherwise today's key-point rules, unchanged.
- **Rule A, confirmed:**
  - The judge has an entry whose `normalizeForQuote(what)` equals the item's normalized `what`.
  - Its status is `met`, with non-empty evidence.
  - If `source === 'text'`, the evidence passes the same quote check as key points, against that item's `pageText`.
  - A quote that fails also goes into `quoteProblems`.
- `giveup --class` accepts `no_matching_page`.

- [ ] **Step 1: Write failing tests in `test/verdict.test.ts`.**
  - `skipped → not_run with the skip reason`.
  - `no_matching_page → needs_review "Couldn't find a page that matches: …"`.
  - `completed, all key points met, relies_on met with a real quote → pass`.
  - `completed, key points met, relies_on not_met → needs_review "Couldn't confirm the test ran on the right page: The listing is in France"`.
  - `completed, judge left out the relies_on entry → needs_review` (Review Focus 1).
  - `completed, judge renamed the relies_on what → needs_review` (Review Focus 1).
  - `completed, relies_on quote not on that checkpoint's page → needs_review and listed in quoteProblems`.
  - `completed, relies_on unconfirmed but a key point not_met → still needs_review, never fail`.
  - `app_problem, no items due → fail`.
  - `app_problem, due item met → fail`.
  - `app_problem, due item unclear → needs_review "Stopped on a page that may not be the right one: …"`.
  - `parseJudgeOutput: missing reliesOn reads as []; malformed reliesOn entry → null`.

  In `test/daemon.test.ts`: `giveup accepts no_matching_page`.
- [ ] **Step 2: Run the tests and confirm they fail.** `node --test test/verdict.test.ts` → FAIL.
- [ ] **Step 3: Implement it in `src/verdict.ts`.** Fix callers' types: `report.ts` passes `skipped: null, reliesOn: []` until Task 6.
- [ ] **Step 4: Run the full suite and confirm it passes.** `npm test && npm run typecheck` → PASS.
- [ ] **Step 5: Commit.**

```bash
git add visual-qa/src visual-qa/test
git commit -m "feat: verdicts check relies_on, add not_run and no_matching_page; a wrong page is never pass or fail"
```

---

### Task 6: Report — groups, checklist lines, NOT RUN, "ran on the right page?"

**Files:**
- Modify: `visual-qa/src/report.ts`
- Test: `visual-qa/test/report.test.ts`

**Interfaces:**
- Consumes:
  - `computeVerdict` and `RelyResult` (Task 5);
  - `ScenarioRecord.checkpoints`, `skipReason`, `status: 'skipped'` (Tasks 3–4);
  - `RunFile.continuesFrom` (Task 4);
  - `Suite.groups`, `Scenario.source`, `reliesOn` (Task 1);
  - `<runDir>/checklist.txt` (Task 4).
- Produces:
  - `ReportRow` gains `group: string | null`, `source: string | null`, `reliesOn: RelyResult[]` (judge's, matched per item; a missing entry is shown as `unclear`) and `checkpointShots: Record<string, string>` (what → viewport shot path).
  - `ReportModel` gains `groups: Array<{ id: string; needs: string | null }>`, `checklist: string | null` and `continuesFrom: string | null`, and loses `browser`.
  - `counts: Record<Verdict, number>` now includes `not_run`.
  - `summaryLine` appends `· N not run` when N > 0.
- **Building rows:**
  - For each scenario, the due `reliesOn` list for `computeVerdict` is:
    - completed: every item, with page text from its checkpoint's `textFile`, or the final `textFile` for final-page items; a missing file reads as `''`;
    - gave up: only the items with a checkpoint.
  - A `not_started` record → `not_run` with reason `paused before this group`.
- **Rendering:**
  - Rows sit under one `<section>` per group, with an `<h2>` of its `needs`. Group order is file order; a run without groups has one unnamed section.
  - Within a group, rows go fail → needs_review → not_run → pass.
  - Each row shows `source` (when set) above the title, in a `<blockquote class="source">`.
  - The `relies_on` results sit under the heading `Ran on the right page?`, styled like key points, with a checkpoint thumbnail when there is one.
  - A `not_run` badge, chip and filter button use a neutral grey token, defined in both the light and dark blocks.
  - `<details class="checklist"><summary>Your checklist</summary><pre>…</pre></details>` sits at the top when `checklist` is set.
  - The header always ends `· Ran in your Chrome (your sign-ins)`.
  - When `continuesFrom` is set, the header links `Continues <a href="file://…/report.html">the earlier run</a>`.
  - Everything is HTML-escaped (existing `esc`).

- [ ] **Step 1: Write failing tests in `test/report.test.ts`.**
  - Replace `chrome-mode runs say so in the header; isolated runs do not` with `the header always says Ran in your Chrome (your sign-ins)`.
  - Change `a never-run scenario shows "not run"…` to expect verdict `not_run` and reason `paused before this group`.
  - Add:
    - `rows are grouped under their needs line, in file order`;
    - `the checklist line is shown above the title and escaped`;
    - `a skipped test is NOT RUN with its reason and counted in the summary` (assert `summaryLine` equals `1 pass · 1 not run`);
    - `relies_on results show under "Ran on the right page?" with the checkpoint thumbnail inlined as a data URI`;
    - `a completed test whose judge confirms key points but not relies_on is NEEDS REVIEW in the model`;
    - `Your checklist section renders checklist.txt escaped; absent file → no section`;
    - `continuesFrom adds a link to the earlier report`.
- [ ] **Step 2: Run the tests and confirm they fail.** `node --test test/report.test.ts` → FAIL.
- [ ] **Step 3: Implement it in `src/report.ts`.**
- [ ] **Step 4: Run the full suite and confirm it passes.** `npm test && npm run typecheck` → PASS.
- [ ] **Step 5: Commit.**

```bash
git add visual-qa/src/report.ts visual-qa/test/report.test.ts
git commit -m "feat: report groups rows by setup, shows checklist lines, NOT RUN and relies_on results"
```

---

### Task 7: Briefs — intake, judge, takeover

**Files:**
- Create: `visual-qa/reference/intake.md`
- Modify: `visual-qa/reference/judge.md`
- Modify: `visual-qa/reference/takeover.md`
- Test: `visual-qa/test/skill-files.test.ts` (brief tests only; skill frontmatter changes are in Task 9)

**Interfaces:**
- Consumes: the YAML keys (Task 1), the `evidence` output (Task 3), the `JudgeOutput` shape (Task 5), the `giveup` classes (Task 5), and `qa skip` (Task 4).
- Produces: the placeholders `{{NOTES}}` in takeover.md and `{{EVIDENCE}}` in judge.md (unchanged), which Task 9's SKILL.md fills.

**What each brief must say (content, not wording):**

- **`intake.md`**, turning a paste into a scenario file (spec §6.1–6.3):
  - Separate background (→ `notes`) from checks.
  - One check = one scenario. A line covering several pages splits; `source` is the line, verbatim.
  - Steps find their own pages, phrased as goals, and say "do not submit" where relevant.
  - Every condition the expected result depends on that a page can show goes in `relies_on`, with `after_step`.
  - Conditions no page shows become questions.
  - Vague expectations get a concrete reading, without asking.
  - Groups come from flag state, account role or role switches. The first group is "as you are now". Order groups for the fewest switches. `needs` is written as an instruction the person can follow.
  - Logged-out checks get `logged_out: true`.
  - Ask only for: a missing site URL; a data property no page shows (accept "a link to one of each"); a specific account or record the person must provide. All questions go in one numbered message, each saying why.
  - Untestable checks are listed as "won't test", and the skill `qa skip`s them after `start`.
  - Write `~/QA/scenarios/<topic>.yaml` and `~/QA/scenarios/<topic>.checklist.txt` (the paste, verbatim). Read `reference/scenario-format.md` for the format.
  - Include a short worked example based on the PBSA paste from spec §6.1: the grouping, two questions and one scenario with `relies_on`.
- **`judge.md`:**
  - New evidence fields: `scope` and `reliesOn`.
  - For each `reliesOn` item, read that item's `viewportShot` and `textFile`. Mark `met`, `not_met` or `unclear` with evidence, using the same quoting rule as key points. Copy `what` exactly.
  - `scope: relies_on_only` → write `keyPoints: []` and judge only `reliesOn`.
  - Output JSON adds `"reliesOn":[{"what":"...","status":"...","evidence":"...","source":"text|screenshot"}]`.
  - Still never mentions how the steps were carried out (existing test).
- **`takeover.md`:**
  - Adds a `## Background` section with `{{NOTES}}`.
  - Adds give-up class `no_matching_page`: "the steps can't find a page that meets a condition the test relies on — say which".
  - Rule 3's login-wall text becomes `not signed in — sign in to the site in your Chrome`, with no `qa login`.
  - The goal-style step note: finding a page by searching or browsing is part of the step.

- [ ] **Step 1: Write failing tests in `test/skill-files.test.ts`.**
  - `intake brief: one message for all questions, relies_on with after_step, source verbatim, groups as instructions, won't test, file paths`. Assert each phrase or key is present with regexes: `/one message/i`, `/relies_on/`, `/after_step/`, `/verbatim/i`, `/won't test/i`, `/~\/QA\/scenarios\/<topic>\.yaml/`, `/\.checklist\.txt/`, `/logged_out: true/`.
  - `judge brief: judges reliesOn with the same quoting rule and supports relies_on_only`. Patterns: `/reliesOn/`, `/relies_on_only/`, `/copy .*what.* exactly/i`.
  - `takeover brief: has {{NOTES}}, no_matching_page, and no qa login`. Assert `/\{\{NOTES\}\}/`, `/no_matching_page/`, `doesNotMatch(/qa login/)`.
- [ ] **Step 2: Run the tests and confirm they fail.** `node --test test/skill-files.test.ts` → FAIL.
- [ ] **Step 3: Write and edit the three briefs.**
- [ ] **Step 4: Run the tests and confirm they pass.** `node --test test/skill-files.test.ts` → PASS.
- [ ] **Step 5: Commit.**

```bash
git add visual-qa/reference visual-qa/test/skill-files.test.ts
git commit -m "feat: intake brief; judge checks relies_on; takeover gets notes and no_matching_page"
```

---

### Task 8: Guided setup (`bin/setup.ts`), replacing `doctor`

**Files:**
- Create: `visual-qa/src/setup.ts` (checks; no third-party static imports)
- Create: `visual-qa/bin/setup.ts` (CLI; no third-party static imports)
- Delete: `visual-qa/src/doctor.ts`
- Modify: `visual-qa/bin/qa.ts`: remove `doctor` from `COMMANDS` and the playwright `chromium` import if now unused
- Modify: `visual-qa/src/config.ts`: drop the project `.env` source and `projectRoot`; rename `skillDir()` → `pluginRoot()` (same body; its only caller was `projectRoot`)
- Create: `visual-qa/src/chrome-endpoint.ts`: move `findChromeEndpoint` and `CHROME_OFF_MESSAGE` here (built-ins only); `src/chrome.ts` re-exports both so existing imports keep working
- Test: create `visual-qa/test/setup.test.ts`, delete `visual-qa/test/doctor.test.ts`, update `visual-qa/test/config.test.ts`

**Interfaces:**
- Produces (src/setup.ts):
  ```ts
  export type SetupItemName = 'node' | 'packages' | 'typesafe_key' | 'chrome' | 'anthropic_api_key';
  export type SetupItem = { name: SetupItemName; ok: boolean; level: 'error' | 'warning'; detail: string;
                            fix: string | null;      // plain words for the person
                            command: string | null }; // what the agent runs next, e.g. `node <root>/bin/setup.ts --open-key-file`
  export type SetupDeps = {
    env: Record<string, string | undefined>; nodeVersion: string; pluginRoot: string;
    packagesPresent: () => boolean; pingJev: (key: string) => Promise<void>;
    chromeEndpoint: () => string | null; chromeMajorVersion: () => number | null;
  };
  export async function runSetupChecks(d: SetupDeps): Promise<{ ok: boolean; items: SetupItem[]; next: SetupItem | null }>;
  export function ensureKeyFile(file: string): { created: boolean };  // adds a `TYPESAFE_API_KEY=` line only if no such line exists; mode 600; never alters other lines
  export const TYPESAFE_KEY_URL: string;  // TypeSafe's API-key page (find the exact URL in TypeSafe's docs)
  export const PRIVACY_NOTE: string;      // verbatim, Global Constraints
  export const UPDATES_NOTE: string;      // verbatim, Global Constraints
  ```
- **Check order:** node → packages → typesafe_key (presence, then `pingJev`, only if packages are present) → chrome (major version ≥ 144, then endpoint present) → anthropic_api_key (warning).
  - `next` is the first failing `error`-level item.
  - `chromeMajorVersion` reads `CFBundleShortVersionString` from `/Applications/Google Chrome.app/Contents/Info.plist` with `plutil -extract CFBundleShortVersionString raw`. `null` if Chrome is missing.
  - `packagesPresent` tries `import.meta.resolve` for `playwright`, `yaml` and `@typesafe-ai/sdk` from the plugin root.
- **CLI (`node bin/setup.ts [mode]`)**, one JSON line on stdout:
  - **(no args) or `--check`** → `{ ok, items, next, notes? }`. `notes: [PRIVACY_NOTE, UPDATES_NOTE]` only when `ok`. Exit code 0 when ok, 1 otherwise.
  - **`--open-key-file`** → `ensureKeyFile('~/.visual-qa/.env')`, then `open <TYPESAFE_KEY_URL>` and `open -e <file>`. Output `{ opened: <file> }`.
  - **`--open-chrome`** → runs the `open` command decided in Task 0. Output `{ opened: true }`, or `{ opened: false, address: 'chrome://inspect/#remote-debugging' }`.
  - **`--wait-chrome [seconds=180]`** → polls `findChromeEndpoint()` once a second → `{ on: boolean }`.
  - **No third-party static imports anywhere in the import graph of `bin/setup.ts`.** It may import `src/setup.ts`, `src/config.ts` and `src/chrome-endpoint.ts`, but not `src/chrome.ts` or `src/jev-client.ts`. That way it still runs and reports `packages` when `node_modules` is missing.
  - `pingJev` and `classifyError` are loaded with dynamic `import('@typesafe-ai/sdk')` and `import('../src/jev-client.ts')`, only after `packagesPresent()` is true. It's the same ping call `qa doctor` makes today; copy it out of `bin/qa.ts`.
  - For tests, the env var `VISUAL_QA_FAKE_PING=ok|fatal` replaces the real ping in `bin/setup.ts`.

- [ ] **Step 1: Write failing tests in `test/setup.test.ts`.** Port the `doctor.test.ts` cases (all good; ANTHROPIC warning; no key; Jev ping fatal; old Node; key never in output; Chrome off) to `runSetupChecks`. Add:
  - `missing packages → next is packages, and the key ping is skipped`;
  - `Chrome older than 144 → chrome item says to update Chrome`;
  - `next is the first failing error item, in order`;
  - `ensureKeyFile keeps an existing key and other lines` (Review Focus 3). Write `FOO=1\nTYPESAFE_API_KEY=abc\n`, call it, and assert the file content is unchanged and `created === false`.
  - `ensureKeyFile creates the file with mode 600 and an empty key line`;
  - `CLI --check prints notes only when ok and never prints the key` (spawn `bin/setup.ts` with `HOME` pointed at a temp dir, a fake key in env, `VISUAL_QA_FAKE_PING=ok` and `VISUAL_QA_CHROME_ENDPOINT` set). Assert stdout lacks the key value.
  - `setup.ts imports nothing third-party statically`. Read `bin/setup.ts`, `src/setup.ts`, `src/config.ts` and `src/chrome-endpoint.ts`, and assert no top-level `import … from '<not node:/relative>'`.

  In `test/config.test.ts`, delete `key from project .env when env is empty`, and change the home-.env test so it no longer needs a project file.
- [ ] **Step 2: Run the tests and confirm they fail.** `node --test test/setup.test.ts test/config.test.ts` → FAIL.
- [ ] **Step 3: Implement `src/setup.ts`, `bin/setup.ts` and the `config.ts` change. Delete `doctor`.**
- [ ] **Step 4: Run the full suite and confirm it passes.** `npm test && npm run typecheck` → PASS. Also check: `node bin/setup.ts --check` in a shell with no key prints `next.name === 'typesafe_key'` and exits 1.
- [ ] **Step 5: Commit.**

```bash
git add -A visual-qa/src visual-qa/bin visual-qa/test
git commit -m "feat: guided setup command replaces doctor; key file is created without touching existing lines"
```

---

### Task 9: Plugin packaging and the two skills

**Files:**
- Create: `.claude-plugin/marketplace.json`
- Create: `visual-qa/.claude-plugin/plugin.json`
- Move and rewrite: `visual-qa/SKILL.md` → `visual-qa/skills/test/SKILL.md`
- Create: `visual-qa/skills/setup/SKILL.md`
- Modify: `visual-qa/test/skill-files.test.ts` (paths, frontmatter)

**Interfaces:**
- Consumes: every CLI command from Tasks 2–8, `reference/intake.md`, `takeover.md`'s `{{NOTES}}`, and judge.md.
- **marketplace.json:**
  ```json
  { "name": "qa-no-qa", "owner": { "name": "dontdothatapp" },
    "plugins": [{ "name": "visual-qa", "source": "./visual-qa",
                  "description": "Paste a QA checklist; it's tested in your own Chrome and you get an HTML report with screenshots." }] }
  ```
- **plugin.json:** `{ "name": "visual-qa", "description": <same>, "author": { "name": "dontdothatapp" } }`. No `version`, so commits on `main` are what users track.
- **`skills/test/SKILL.md` frontmatter:**
  ```yaml
  name: test
  description: Test a pasted QA checklist or test cases on a website, in the person's own Chrome — Jev navigates, Claude takes over when stuck and judges each result from screenshots — and write an HTML report. Use when someone pastes test cases or a checklist and asks to test or QA them on a site, or asks to continue a paused QA run.
  argument-hint: [paste your checklist]
  model: sonnet
  allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/bin/qa.ts *) Bash(node ${CLAUDE_PLUGIN_ROOT}/bin/setup.ts *) Read Write Agent
  ```
  No `disable-model-invocation`.
- **`skills/test/SKILL.md` body** (under 120 lines): spec §6.6, as a checklist in today's SKILL.md style.
  1. **Preflight.** Run `setup.ts --check`. If not ok, follow `${CLAUDE_PLUGIN_ROOT}/skills/setup/SKILL.md` steps, then continue.
  2. **Continue.** If the person says continue (or `$ARGUMENTS` is `continue`), run `qa remaining` → then `qa start <testsFile> --only … --continues <runDir>`.
  3. **Intake.** Read `reference/intake.md`. Ask questions only if needed; otherwise send one line, `Running N checks in M groups. First group: <needs>.` Then `qa start` with `--session ${CLAUDE_SESSION_ID}`, and `qa skip` the "won't test" ones.
  4. **Allow reminder.** One line: click **Allow** in Chrome; don't type in Chrome during the run.
  5. **Per group.**
     - Before every group but the first: judge the tests finished so far, run `qa report`, then pause with the group's `needs` as an instruction plus "say go, or skip".
     - On skip, `qa skip` each test in the group.
     - Takeover and judge agents as today (descriptions exactly `QA takeover <id>` / `QA judge <id>`). The takeover prompt fills `{{NOTES}}`.
     - Judge every test whose `evidence` says `needsJudge: true`.
     - If a command errors with `qa reopen`, run `qa reopen` and remind the person about Allow.
  6. **Report.** `qa report`, then `qa stop`. Summary: the counts line, the report link, and one line per FAIL / NEEDS REVIEW / NOT RUN quoting its `source`.
  7. **Runner errors.** Keep today's rules: `{"error"`, "already active", "including the current one".
- **`skills/setup/SKILL.md`:**
  ```yaml
  name: setup
  description: Set up Visual QA — checks Node, the runner's packages, the TypeSafe key and Chrome's remote-debugging switch, and walks the person through anything missing.
  allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/bin/setup.ts *) Bash(node --version)
  ```
  **Body:**
  1. Run `node --version`. Below v22.18 or missing → install Node: `brew install node` if `brew` exists, otherwise send the person to nodejs.org's macOS installer. Then re-check.
  2. Loop: run `setup.ts --check`; if `next` is set, tell the person `next.fix` in one or two lines and run `next.command` if there is one.
     - **typesafe_key:** run `--open-key-file`, then say "paste your key after `TYPESAFE_API_KEY=`, save, and tell me when done". Never ask for the key in chat. If the person pastes it into chat anyway, don't repeat it back; tell them to put it in the file instead.
     - **chrome:** run `--open-chrome`, then `--wait-chrome`.
     - **packages:** tell the agent to run `npm ci --omit=dev` in `${CLAUDE_PLUGIN_ROOT}` and re-check.
  3. When `ok`, relay `notes` and say they can now type `/visual-qa:test` and paste a checklist.
- **Updates to `test/skill-files.test.ts`:**
  - Read `skills/test/SKILL.md`. Frontmatter: `name === 'test'`, `model === 'sonnet'`, `disable-model-invocation` absent, allowed-tools match `/Bash\(node \$\{CLAUDE_PLUGIN_ROOT\}\/bin\/qa\.ts \*\)/`.
  - Body: still has `${CLAUDE_SESSION_ID}`, `QA takeover <id>`, `QA judge <id>`, `{"error"`, `already active`, `including the current one`, `Allow`.
  - Body must **not** contain `signed-in pages` or `real accounts` (the privacy note moved to setup).
  - Body contains `qa.ts remaining`, `qa.ts reopen` and `qa.ts skip`.
  - The command-exists test scans `skills/test/SKILL.md`, `skills/setup/SKILL.md` and the three briefs.
  - New: `marketplace and plugin manifests name qa-no-qa and visual-qa, and the source points at ./visual-qa`.
  - New: `setup skill never asks for the key in chat` (`/never ask for the key in chat/i`).

- [ ] **Step 1: Update `test/skill-files.test.ts` as listed.**
- [ ] **Step 2: Run the tests and confirm they fail.** `node --test test/skill-files.test.ts` → FAIL.
- [ ] **Step 3: Write the manifests and both skills. `git mv visual-qa/SKILL.md visual-qa/skills/test/SKILL.md`, then rewrite it.**
- [ ] **Step 4: Run the tests and validate the plugin.** `npm test && npm run typecheck` → PASS. Then from the repo root, `claude plugin validate ./visual-qa && claude plugin validate .` → both report valid.
- [ ] **Step 5: Commit.**

```bash
git add -A .claude-plugin visual-qa
git commit -m "feat: package as the visual-qa plugin in the qa-no-qa marketplace, with test and setup skills"
```

---

### Task 10: Spike B — real plugin install (needs the person for interactive checks)

**Files:**
- Modify: `docs/superpowers/notes/2026-11-16-pm-ux-spike.md` (add items c–e)

- [ ] **Step 1: Install from a local path into a throwaway config.**
  - `export CLAUDE_CONFIG_DIR=$(mktemp -d)`
  - `claude plugin marketplace add "$PWD"`
  - `claude plugin install visual-qa@qa-no-qa`

  Record: the install time; whether `node_modules` appeared in the cached plugin folder (`ls ~/.claude/plugins/cache/qa-no-qa/visual-qa/*/node_modules` under the temp config dir); and whether dev dependencies were installed. If the install times out (60 s) or fails, note it: Step 4 then applies.
- [ ] **Step 2: Ask the person to run it from GitHub after the branch is pushed.** In their own Claude Code, on a throwaway branch pushed to `origin` with their OK: `claude plugin marketplace add dontdothatapp/qa-no-qa@<branch>` (or the documented ref syntax). Record:
  - **(d)** whether `/visual-qa:setup` is available without `/reload-plugins`, in the terminal and in the desktop app's Code tab;
  - **(e)** whether a `/visual-qa:test` run prompts for approval on `node …/bin/qa.ts` commands in a turn after a pause, or inside the `QA takeover` / `QA judge` subagents, or on their writes under `~/QA`.
- [ ] **Step 3: Record decisions in the notes file.**
  - (c) If the auto-install fails or is too slow: switch `package.json` to `playwright-core`, move nothing else, and re-measure. If it still fails, add the documented SessionStart hook that installs into `${CLAUDE_PLUGIN_DATA}`, and point `packagesPresent` at it.
  - (d) The exact person-facing wording for the README.
  - (e) Whether Task 11 is needed.
- [ ] **Step 4: Apply decision (c) if needed.** Run the tests (`npm test`) and commit:

```bash
git add -A visual-qa docs/superpowers/notes
git commit -m "chore: plugin install spike results"
```

---

### Task 11: Approval hook (only if Task 10 item e found prompts)

**Files:**
- Create: `visual-qa/hooks/hooks.json`
- Create: `visual-qa/bin/approve.ts` (built-ins only)
- Create: `visual-qa/src/approve.ts`
- Test: `visual-qa/test/approve.test.ts`

**Interfaces:**
- Produces: `decide(input: { tool_name: string; tool_input: Record<string, unknown> }, pluginRoot: string, home: string): 'allow' | null`.
  - **Bash:** `'allow'` only when `tool_input.command` is exactly `node <pluginRoot>/bin/qa.ts <args>` or `node <pluginRoot>/bin/setup.ts <args>`, and `<args>` has none of `; & | \` $( ) < > \n`. The path may be quoted.
  - **Write:** `'allow'` only when `path.resolve(tool_input.file_path)` is inside `<home>/QA/`.
  - Everything else → `null` (no opinion; the normal permission flow applies).
- `bin/approve.ts` reads the hook JSON from stdin.
  - On `'allow'` it prints `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","permissionDecisionReason":"Visual QA runner command"}}`.
  - On `null` it prints nothing and exits 0.
  - Confirm the output schema against the Claude Code hooks docs before implementing.
- `hooks/hooks.json`: a PreToolUse hook, matcher `Bash|Write`, command `node "${CLAUDE_PLUGIN_ROOT}/bin/approve.ts"`.

- [ ] **Step 1: Write failing tests in `test/approve.test.ts`.**
  - `allows the plugin's qa.ts and setup.ts commands`;
  - `refuses compound commands` (`node <root>/bin/qa.ts run S1; rm -rf ~` → null; `&&`, `|`, `$(` → null);
  - `refuses another plugin root or another script` (`node /other/bin/qa.ts run S1` → null; `node <root>/bin/other.ts` → null);
  - `allows writes inside ~/QA and nothing else` (`~/QA/x/judge.json` → allow; `~/QA/../.zshrc` → null; `~/.claude/settings.json` → null);
  - `CLI prints the allow JSON or nothing`.
- [ ] **Step 2: Run the tests and confirm they fail.** `node --test test/approve.test.ts` → FAIL.
- [ ] **Step 3: Implement `src/approve.ts`, `bin/approve.ts` and `hooks/hooks.json`.**
- [ ] **Step 4: Check it works.** `npm test` → PASS, and `claude plugin validate ./visual-qa` → valid. Ask the person to repeat Task 10 item (e): no prompts for runner commands or `~/QA` writes, and a normal prompt still appears for an unrelated command.
- [ ] **Step 5: Commit.**

```bash
git add visual-qa/hooks visual-qa/bin/approve.ts visual-qa/src/approve.ts visual-qa/test/approve.test.ts
git commit -m "feat: plugin approves only its own runner commands and report writes"
```

---

### Task 12: README for PMs and designers; acceptance

**Files:**
- Modify: `README.md`
- Modify: `visual-qa/test/acceptance/fixture-suite.yaml`
- Create: `docs/superpowers/notes/2026-11-16-pm-ux-acceptance.md`

- [ ] **Step 1: Rewrite `README.md`** in this order (spec §6.9):
  1. What it does (two lines).
  2. **Install:** the install line verbatim (Global Constraints) in a quote block, plus the human steps that follow (`/reload-plugins`, key, Chrome switch), worded per Task 10 (d).
  3. **Use:** `/visual-qa:test`, paste, with a 6–8 line example checklist; say plain "test this on <site>" works too.
  4. **During a run:** Allow, tabs coming to the front, pauses with go/skip, continuing later.
  5. **The report:** outcomes (PASS / FAIL / NEEDS REVIEW / NOT RUN) and "Ran on the right page?".
  6. **Privacy and safety:** keep today's points, minus saved logins, and add the TypeSafe note.
  7. **For developers:** clone, `cd visual-qa && npm ci && npx playwright install chromium` (tests only), `npm test`, local install via `claude plugin marketplace add ./`, pointers to `reference/scenario-format.md` and `docs/superpowers/`.

  No YAML outside "For developers". No `qa login`, `session:` or `browser:` anywhere. Check with `grep -n "session:\|qa login\|browser: \|isolated" README.md` → no matches.
- [ ] **Step 2: Convert `test/acceptance/fixture-suite.yaml`.**
  - Remove `session:` from ACC-01; it now needs the person signed in to the fixture site in Chrome.
  - Add a `logged_out: true` scenario on `/account.html`, expected to show the logged-out view.
  - Add a scenario with a `relies_on` that holds (passes).
  - Add a `BRK-` scenario whose `relies_on` is deliberately false. It must come out NEEDS REVIEW.
  - Add `groups` with two groups, so a pause happens.
- [ ] **Step 3: Live acceptance A (fixtures).** Serve the fixtures (`node visual-qa/test/fixtures/serve.ts`), then run `/visual-qa:test` on the converted suite with the person present. Expect:
  - no BRK-* PASS;
  - the false-`relies_on` scenario is NEEDS REVIEW with `Couldn't confirm the test ran on the right page:`;
  - one pause between groups;
  - the logged-out window opens and closes;
  - the person's tabs are untouched.
- [ ] **Step 4: Live acceptance B (the person's PBSA checklist on stage3).** The person pastes the spec §6.1 checklist verbatim. Expect:
  - questions only about hidden unit-type data and the landlord account or conversations, in one message;
  - four groups with pauses;
  - no PASS and no FAIL whose `relies_on` items are unconfirmed;
  - report rows show the original checklist lines.
- [ ] **Step 5: Live acceptance C (fresh install).** In a clean macOS user account, or with `HOME` and `CLAUDE_CONFIG_DIR` pointed at empty temp dirs, the person pastes only the README install line. Record each prompt and manual step until `/visual-qa:setup` reports ok.
- [ ] **Step 6: Write the acceptance notes** (results per scenario, deviations, follow-ups). Commit:

```bash
git add README.md visual-qa/test/acceptance/fixture-suite.yaml docs/superpowers/notes/2026-11-16-pm-ux-acceptance.md
git commit -m "docs: README for PMs and designers; acceptance results"
```
