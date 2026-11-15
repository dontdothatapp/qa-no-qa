# Visual QA skill — design

Date: 2026-11-15 · Status: draft for approval · Background research: `reports/Visual QA automation tooling.md`

## 1. Intent

A Claude Code skill, run as `/visual-qa`, that takes a list of plain-language test scenarios ("open this page → click there → fill this → expected result"). It does three things:

1. Executes each scenario in a real browser.
2. Captures a screenshot of the result.
3. Produces a local report: a table of scenario, expected result, verdict and screenshot, with the screenshots embedded in the page.

The user's priorities are **speed and low cost**. Claude stepping through every click is slow and burns usage, so:

- **Navigation:** Jev (TypeSafe AI's fast decision model) makes the per-step click/type decisions.
- **Claude's role:** Claude does only the two jobs that need judgment:
  - It **takes over when Jev is stuck or fails**, then hands control back to Jev.
  - It **judges the final result** from the screenshot and the page text.
- **Billing:** all Claude work runs inside Claude Code on the user's Pro/Max subscription, not the API.
- **Token visibility:** the report shows how many tokens the run used, for Claude and for Jev, for visibility only.

Who reads the report wasn't specified. **Design call:** the report must make sense on its own to someone who didn't run it.

## 2. Goals

- G1. `/visual-qa <scenarios.yaml>` runs every scenario and ends by printing the report path and a one-line summary (e.g. "8 pass · 1 fail · 1 needs review").
- G2. Jev performs the steps in a headless browser. Claude is only involved when the runner hands a scenario back (see §6.3).
- G3. After Claude unblocks a step, Jev resumes the remaining steps.
- G4. Each scenario gets a verdict of **pass**, **fail** or **needs review**, with a one-sentence reason and the evidence behind it.
- G5. One self-contained `report.html` per run, with every screenshot embedded inline. It opens offline in any browser and can be zipped or emailed.
- G6. Token usage is shown per scenario and in total, broken out as:
  - **Jev:** input and output tokens.
  - **Claude, per model:** new input, cache write, cache read and output.
- G7. The report also shows wall-clock time per scenario and how many steps Jev did versus Claude, so the real speed is visible.
- G8. Scenarios behind a login work, using a browser session the user saved once.

## 3. Non-goals (v1)

- Google Drive or any cloud upload. Dropped by the user; a local folder is enough.
- Compiling scenarios into replayable Playwright scripts. The user chose Jev navigating on every run.
- Pixel-diff visual regression baselines.
- Running scenarios in parallel. v1 is sequential; leave room to add it later.
- Dollar cost figures. The user wants tokens only.
- CI, team distribution, plugin packaging, and mobile-native apps.
- Using Jev's image questions. They are labelled not production-ready ("Dreamer-ready" in TypeSafe's docs).

## 4. Anti-goals: things that make this a failure even if it "works"

- **A report that says pass when the expected result wasn't met.** A false pass is the worst outcome. When in doubt, the verdict is needs review.
- **Hiding tooling trouble as product trouble.** If Jev or Claude couldn't complete the steps, the report says so explicitly. It must never look like an ordinary product failure.
- **Silently billing the Anthropic API instead of the subscription.**
- **Claude typing passwords or other secrets.** Logins come from a session the user saved themselves.
- **Unrequested side effects.** Jev must not submit, buy, delete or leave the allowed site unless the step asks for it. In published tests, Jev submitted forms it wasn't asked to.

## 5. Constraints and facts the builder must respect

- **Runtime:** macOS. Node **22.22** is installed. Python is **3.9.6**, which is too old for the Jev Python SDK (3.10+ required). `uv` is not installed. **Design call:** build the runner in **Node + TypeScript**, using Node 22's built-in TypeScript type-stripping (no build step), with Playwright for Node and `@typesafe-ai/sdk`. This is the better fit regardless of what's installed:
  - Playwright is native to Node (the Python package wraps the Node driver), and new features land there first.
  - The page-side code that builds Jev's controls table runs as JavaScript inside the browser in either language. With Node, the runner and the in-page code share one language and types.
  - Both Jev SDKs are official.
  - Most of the user's side projects are Node/TS (13 vs 3 Python).
  - Python's one edge is that jev-ultrafast is Python. But it drives Chrome over CDP rather than Playwright, so its ideas need adapting either way.
- **Jev API:** `POST https://api.typesafe.ai/v1/systemone` with `Authorization: Bearer $TYPESAFE_API_KEY` and `model: "jev-latest"`.
  - Request: `state` plus typed `questions` (choice / score / noul).
  - Response: `answers` (with `confidence` and `probabilities`) plus `usage.input_tokens` and `usage.output_tokens`.
  - The user **has an early-access key**. It is stored in `qa_no_qa/.visual-qa/.env`, inside this project folder. The user does not want it in their shell profile.
    - The runner looks in three places, in order:
      1. the `TYPESAFE_API_KEY` environment variable;
      2. `.visual-qa/.env` in the skill's source project (resolved through the symlink, so it works when the skill runs from any project);
      3. `~/.visual-qa/.env`.
    - The project's `.gitignore` must exclude `.visual-qa/`, and the build should set the file to owner-only permissions (`chmod 600`).
    - The key must never be printed, logged, or pasted into chat.
- **Privacy:** every Jev decision sends the page's controls and visible text to TypeSafe's servers. The skill's help text must say this.
- **Subscription billing:**
  - Everything Claude does inside the session counts against the plan: main turn, subagents and screenshots.
  - **`ANTHROPIC_API_KEY` is currently set in the user's shell.** Claude Code prefers it over the subscription once approved (silently in `-p` mode). Preflight must warn about this.
  - Never call the Anthropic API from scripts; all Claude work happens in the session or its subagents.
- **Jev limitations, from published tests:**
  - Its DOM tooling has historically:
    - hidden password, file and hidden inputs from Jev;
    - never pressed Enter after typing;
    - mangled non-ASCII text;
    - confused identical button labels.
  - Iframes, shadow DOM, canvas, file uploads, pop-up tabs and nested scrolling were unsupported.
  - It sometimes claims "done" or "blocked" wrongly.
  - Our runner owns the DOM tooling, so it should avoid the first group of failures by design (see §6.2). Claude handles the rest.
- **Claude token logs:** Claude Code writes per-request `usage` into session transcripts:
  - main session: `~/.claude/projects/<encoded-project-dir>/<session-id>.jsonl`
  - subagents: `<session-id>/subagents/agent-*.jsonl`, each with a `.meta.json` containing its `description`
  - Lines repeat per content block, so **de-duplicate by `message.id`**. Fields: `input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, `output_tokens`, `model`.
  - The skill gets its session ID via the `${CLAUDE_SESSION_ID}` substitution in SKILL.md.
  - This format is **undocumented**. If parsing fails, the report shows "Claude tokens unavailable" and is still produced.
- **Image limits:** keep each image the judge views at the viewport size (1280×800 default). Full-page shots are for the human report.

## 6. Design

### 6.1 Overview

```
/visual-qa scenarios.yaml
   │
   ├─ preflight (qa doctor) ─ keys, browser installed, API-key warning
   ├─ validate scenarios ──── precise errors, or a free-text list → drafted YAML for user to confirm
   ├─ start run ───────────── run folder + background browser daemon
   │
   ├─ for each scenario (sequential):
   │     runner: Jev drives step by step ──► completed ──────────────┐
   │                 │                                               │
   │                 └─► hand-back (reason) ─► Claude takeover agent │
   │                        acts via runner commands, then resumes ──┤
   │                        Jev or finishes / gives up               │
   │     runner: capture evidence (screenshots, URL, text, errors) ◄─┘
   │
   ├─ judge: one fresh Claude subagent per scenario, sees evidence only
   ├─ runner: check judge quotes against page text; set final verdict
   ├─ tokens: sum Jev usage log + Claude transcripts since run start
   └─ report: ~/QA/<YYYY-MM-DD> <topic>/report.html  (+ results.json, screenshots/)
```

The parts:

- **Runner (scripts):** a small Node CLI plus a background daemon that keeps one browser alive for the whole run. That way Jev and Claude act on the same page and the same session state.
- **Skill (`SKILL.md`):** a short checklist for Claude. It calls the CLI, reads compact JSON results, starts takeover and judge subagents, and never parses HTML or screenshots itself except through those subagents.
- **Scenario isolation (design call):** every scenario runs in a **fresh browser context**. It is loaded only from that scenario's saved session, if any. Nothing carries over from earlier scenarios: no cookies, storage or cart. Any precondition ("cart has 1 item") must be part of the scenario's own steps. This rules out false passes from leftover state, keeps a failure from cascading into later scenarios, and keeps parallel runs possible later. A paused scenario keeps its context open until its takeover finishes.

### 6.2 Runner: Jev loop (decided behaviour)

- **One step at a time.** Each plain-language step ("click Checkout", "fill the shipping form") is a separate goal for Jev. A step ends when Jev answers `done`. This gives Jev simpler decisions and lets the runner say exactly which step got stuck. The runner moves to the next step itself.
- **State sent to Jev on each decision:**
  - current URL and title;
  - the step goal and the actions already taken in this step;
  - a numbered table of visible interactive controls: role, accessible name, input type, current value or state, and a short nearby context such as the row or card text, so identical labels can be told apart;
  - a trimmed excerpt of visible text.
  - **Non-ASCII text is preserved as-is.**
- **Questions per decision, sent in one request:**
  - `operation`: a choice of click, type, select, press_enter, scroll, wait, done or blocked.
  - `target`: a choice of a control number, or none.
- **Acting:**
  - The runner executes with Playwright when both confidences are at least the threshold (default **0.7**, configurable).
  - **Typed values never come from Jev.** They come from the step text (quoted values), the scenario's `values` map, or values Claude made up earlier in this run (§6.3), matched by field label.
  - When values are missing, the runner hands back **once per form**, listing every visible empty field it has no value for. It does not hand back once per field.
- **Jev API errors (design call):**
  - **Transient errors** (timeout, 429, 5xx): retry twice with backoff, then hand that step back to Claude.
  - **Auth or quota errors mid-run:** pause the run. The skill asks the user whether Claude should drive the remaining scenarios or the run should stop. If it stops, the remaining scenarios are marked needs review with "Jev unavailable".
- **Password fields** are listed to Jev as `[password field]`, never with their value. The runner types into one only if the scenario explicitly supplies the value, and never logs it. Saved sessions (§6.5) are the preferred way to log in.
- **Hand back to Claude** (scenario paused, browser kept open) when any of these happens:
  - Jev says `blocked`.
  - Confidence is below the threshold.
  - A text value is needed but not provided.
  - No progress: the page state is unchanged after 2 actions, or the same action repeats.
  - The step action budget (default 8) or scenario budget (default 40) is exceeded.
  - The page navigates outside `allow_hosts`, or a new tab or popup opens.
  - A "risky" target is chosen that the step doesn't ask for: label matches pay, purchase, place order, delete, remove or confirm.
  - Navigation or Playwright errors.

  Each hand-back carries a machine-readable reason, the step index, and a fresh snapshot.
- **Logging:** every Jev call is appended to the run's event log with scenario, step, latency, chosen operation and target, confidences, and `usage`.

### 6.3 Claude takeover

- **When:** a hand-back makes the skill start **one subagent per affected scenario** (model: `sonnet`, configurable).
- **What the subagent gets:** the scenario, the stuck step, the hand-back reason, and the snapshot.
- **What it can do:** act only through runner commands on the same page:
  - **look:** a richer snapshot than Jev's, covering iframes and shadow DOM;
  - **act:** click, type, select, press, scroll, goto, upload a file, switch tab;
  - **shot:** a screenshot for it to view;
  - **step-done**, **resume Jev**, and **give up** with a classification.
- **Ownership:** it owns that scenario until the scenario completes. It resumes Jev after each unblocked step and handles any later hand-backs in the same context.
- **Giving up:** when the steps can't be completed, it classifies why:
  - `app_problem` (the page doesn't allow the step, e.g. the button is missing) → verdict **fail**;
  - `tooling_or_environment` (captcha, expired session, unsupported widget) → verdict **needs review**.

  Either way the stuck-page screenshot goes in the report, with the reason.
- **Never types passwords.** If a login wall appears, it gives up as `tooling_or_environment` with "session expired — run `qa login`".
- **Missing values (design call):** Claude may make up **obviously fake test data** for fields the scenario left unspecified, for example "Test User", "1 Test Street", `qa+CO-01@example.com`.
  - Never passwords, payment details or real personal data. If those are required and not supplied, it gives up as `tooling_or_environment`.
  - Made-up values are listed in the scenario's report row and reused by field label for later scenarios in the same run, so each form costs at most one takeover.
  - If the app rejects a made-up value (e.g. postcode format), the verdict is **needs review**, not fail.
- **Takeover budget (design call):** at most **25 Claude actions per scenario** (configurable). Beyond that, it gives up as `tooling_or_environment`. This keeps one stubborn scenario from eating the usage window.
- **Returns** compact JSON only (status, steps it performed, one-line note). The main skill context never sees its screenshots.

### 6.4 Evidence and judging

- **Evidence capture** (after the last step, or after give-up):
  - Wait for load plus a short settle, **not** `networkidle`.
  - Then capture:
    - a **viewport** screenshot (JPEG, quality ~80);
    - a **full-page** screenshot;
    - final URL, title and HTTP status of the main document;
    - console errors;
    - the visible text (trimmed).
- **Judge:** one fresh subagent per scenario (model: `sonnet`, configurable to `haiku`/`opus` in the scenario file).
  - It sees **only evidence**: the expected result, URL, title, status, console errors, the text excerpt, the viewport screenshot, and the full-page one if the expected item is below the fold. It never sees Jev's or Claude's action log or notes.
  - Judges can run in parallel after all scenarios finish.
- **Judge output** (JSON):
  - The expected result is split into key points. Each point is marked `met` / `not_met` / `unclear`, with a verbatim evidence quote and its source (`text` or `screenshot`).
  - Overall verdict plus a one-sentence reason.
- **Rules applied by the runner, not trusted to the judge:**
  - Pass only if every key point is `met`.
  - Any `not_met` → fail. Any `unclear` → needs review.
  - Any `text`-sourced quote that doesn't appear in the page text (normalised whitespace and case) → downgrade to **needs review**.
  - Gate checks are recorded and shown, but don't decide the verdict alone:
    - HTTP status ≥ 400;
    - an uncaught console error;
    - an error-page phrase ("Something went wrong", "404").

  Builder may make an error-status gate an automatic fail.

### 6.5 Logins: saved sessions

- `qa login <name> <url>` opens a **visible** browser window. The user signs in themselves and closes the window; the runner then saves the session (cookies and storage) to `~/.visual-qa/sessions/<name>.json`, outside any repo.
- A scenario file references it with `session: <name>`.
- The user runs this command in their own terminal. The skill tells them the exact command when a session is missing or expired.

### 6.6 Scenario file

A YAML file, matching how the user already describes tests:

```yaml
topic: Checkout flow            # used in the run folder name
base_url: https://staging.example.com
viewport: {width: 1280, height: 800}   # optional, default shown
session: staging-user           # optional default for all scenarios, saved via `qa login`
allow_hosts: [staging.example.com]     # optional, default = base_url host
judge_model: sonnet             # optional
scenarios:
  - id: CO-01
    title: Guest can reach the payment step
    session: none               # optional per-scenario override; "none" = logged out
    start: /products/backpack   # path or full URL
    steps:
      - Click "Add to cart"
      - Open the cart and click "Checkout"
      - Fill the shipping form
      - Click "Continue"
    values:                     # optional, typed values by field label
      Full name: Test User
      Postcode: "10115"
    expected: Payment form is visible with card fields; order summary shows 1 item
```

Each scenario is self-contained (§6.1). Its steps must create whatever state its expected result depends on.

- **Free text instead of YAML:** if the user gives a plain list, Claude drafts the YAML, saves it next to the run (`~/QA/scenarios/<topic>.yaml`), shows it, and asks to confirm before running.
- **Validation errors** name the scenario and field.

### 6.7 Report

**Location:** `~/QA/<YYYY-MM-DD> <topic>/`, mirroring the user's original "QA → date + topic" structure. If the folder already exists, add the time (`… 14-30`). It contains:

- `report.html`: self-contained, screenshots embedded as data URIs.
- `results.json`: everything in the report, machine-readable.
- `screenshots/`: viewport and full-page JPEGs per scenario.
- `events.jsonl`: the runner's event log.

**Sketch:**

```
┌───────────────────────────────────────────────────────────────────────────┐
│ Visual QA — Checkout flow            2026-11-15 14:30 · staging.example.com │
│ 8 pass · 1 fail · 1 needs review     Total 3m 12s                         │
├────┬──────────────────────┬──────────────────┬──────────────┬─────────────┤
│ #  │ Scenario             │ Expected         │ Verdict      │ Screenshot  │
├────┼──────────────────────┼──────────────────┼──────────────┼─────────────┤
│CO-1│ Guest reaches payment│ Payment form     │ ✅ PASS      │ [ image   ] │
│    │ 1. Click "Checkout"  │ visible; summary │ ✓ card fields│ [ inline, ] │
│    │ 2. Fill shipping     │ shows 1 item     │ ✓ "1 item"   │ [ click to] │
│    │ 3. Click "Continue"  │                  │              │ [ enlarge ] │
│    │ 14s · Jev 6 · Claude 1 · Jev 9.1k tok · Claude 18.4k tok              │
├────┼──────────────────────┼──────────────────┼──────────────┼─────────────┤
│CO-2│ …                    │ …                │ ❌ FAIL       │ [ image   ] │
│    │                      │                  │ Badge missing│             │
├────┴──────────────────────┴──────────────────┴──────────────┴─────────────┤
│ Tokens   Jev: 61.2k in / 0.9k out                                         │
│          Claude sonnet: 4.1k in · 52.0k cache write · 310k cache read ·   │
│                          9.8k out   (orchestration + takeovers + judges)  │
└───────────────────────────────────────────────────────────────────────────┘
```

- **Details:**
  - Rows are filterable by verdict.
  - Each row can expand to show the key-point checks, gate results, hand-backs (reason and which steps Claude did), and the full-page shot.
  - Needs review and fail rows sort first.
- **Token attribution:**
  - Jev tokens are attributed per scenario from the event log.
  - Claude subagent tokens are attributed to a scenario by putting the scenario ID in each subagent's description.
  - The main-session tokens show as "orchestration".
  - Only transcript entries after the run's start timestamp count.

### 6.8 Skill packaging

- **Source:** lives in this project folder (`qa_no_qa/`). It is installed by symlinking `visual-qa/` into `~/.claude/skills/`, so it works from any project.
- **`SKILL.md`:** a short checklist (well under 500 lines).
- **Frontmatter:**
  - `disable-model-invocation: true`: runs only when typed as `/visual-qa`.
  - `model: sonnet`: keeps orchestration off the more expensive model.
  - `allowed-tools` for the runner CLI.
  - `argument-hint: [scenarios.yaml]`.
- **Dependencies:** installed once with `npm install` and `npx playwright install chromium` inside the skill folder. `qa doctor` reports anything missing.
- **Preflight (`qa doctor`)** checks:
  - Node version;
  - Playwright Chromium installed;
  - `TYPESAFE_API_KEY` present (never printed);
  - Jev reachable (a cheap test call);
  - `ANTHROPIC_API_KEY` present → a warning that Claude Code may bill the API instead of the subscription, with "check `/status`". The skill stops and asks the user before continuing.

## 7. Approaches considered

| | Approach | Trade-off | Outcome |
|---|---|---|---|
| A | Build on **jev-browse** (community add-on, Sept 2026). It already has typed hand-backs and resume-after-handback, and runs in the user's own Chrome. | Less code. But it has no token reporting (would need patching), undocumented screenshots, runs in the user's real browser profile, and depends on a 2-month-old project. | Rejected |
| **B** | **Own runner**: Playwright plus TypeSafe's official SDK, reusing jev-ultrafast's (MIT) ideas for the controls table. | More code (a few hundred lines). Full control over tokens, screenshots, saved logins and hand-back rules. We can fix the tooling-side failures seen in published tests. Each part can be tested without the others. | **Chosen by the user** |
| C | Browser Use library's "ultrafast" mode | Mature library with built-in cost tracking. But it couldn't be confirmed that the open-source version runs on Jev. | Dropped |

Earlier options also dropped: Claude driving every step (slow), compile-and-replay (the user prefers Jev on every run), Google Drive delivery (not needed).

## 8. Left to the builder

- Exact CLI command names and the daemon's local protocol: localhost HTTP or a socket.
- Jev question wording, state layout, and how the controls table is built (port ideas from jev-ultrafast).
- Default thresholds and budgets beyond those stated, and how to match values to field labels.
- Report HTML/CSS details within the sketch.
- How `look` represents iframes and shadow DOM for Claude.
- Test fixtures and tooling.

## 9. Testing and acceptance

- **Build order: Jev spike first.** The user has a key, so the first task is a short spike against the real Jev API on 2–3 local fixture pages and one busy real page. It establishes:
  - a working `state` layout;
  - how many `target` options one choice can hold before quality or size limits bite;
  - the real confidence distribution against the 0.7 threshold;
  - per-decision latency.
  
  Spike responses are recorded and become the fixtures for the fake Jev client.
- **Unit tests** (no network, no keys):
  - controls-table builder on local fixture pages;
  - hand-back rules;
  - verdict rules and quote check;
  - transcript token parser (with de-duplication), against a sample transcript;
  - report rendering.
- **Runner tests** with a **fake Jev client** that replays recorded answers, against local fixture pages served from disk.
- **Live acceptance**, needing the user's `TYPESAFE_API_KEY`: a local fixture site with ~12 scenarios.
  - It covers: simple navigation, search with Enter, a form with an explicit submit, identical "Add to cart" labels, an iframe widget, a file upload, a login via saved session, and a non-English label.
  - About a third of the scenarios are deliberately broken.
  - Pass criteria:
    - the run completes with no human input after login setup;
    - **no broken scenario is marked pass**;
    - the report opens offline with all screenshots;
    - the token footer shows both Jev and Claude numbers;
    - the step counts show Jev doing most steps on the simple flows.

## 10. Risks

- **Jev access and reliability.** Early access can be slow, and Jev's API or answers may change between releases. Published tests show high failure rates on mixed flows. If takeovers are frequent, runs get slower and use more Claude. The report's Jev/Claude step counts make this visible.
- **Claude Code's transcript format can change.** Token counting fails soft.
- **Usage limits.** Screenshots stay in context. Takeover and judge subagents keep them out of the main session, but a large run can still hit the plan's 5-hour or weekly limit.

## 11. Design calls the user should check

These were decided while writing this document, not by the user:

1. The report stands on its own and is filed locally under `~/QA/<YYYY-MM-DD> <topic>/` (§1, §6.7).
2. The runner is Node + TypeScript, because local Python is 3.9 (§5).
3. Every scenario starts from a clean browser; preconditions go in its own steps (§6.1).
4. Claude may make up obviously fake test data for unspecified fields; these values are shown in the report (§6.3).
5. Takeover budget of 25 Claude actions per scenario; Jev API outages pause the run and ask (§6.2, §6.3).
6. Sonnet for orchestration, takeovers and judging, configurable per scenario file (§6.3, §6.4, §6.8).
7. Logins via a saved session the user creates by signing in themselves (§6.5).
8. Scenarios run one at a time in v1 (§3).
