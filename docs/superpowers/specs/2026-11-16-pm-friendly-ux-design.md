# Visual QA for PMs and designers — design

Date: 2026-11-16 · Status: draft for approval · Builds on: `2026-11-15-visual-qa-skill-design.md` (incl. §12, Chrome mode)

## 1. Intent

Visual QA works today, but only for someone comfortable with YAML, terminal commands and a repo checkout. The user wants **any product manager or designer** to be able to use it. Three things stand in the way:

1. **Input.** Today you write a `.yaml` scenario file, or Claude drafts one and asks you to approve it. A PM has a checklist in a ticket or a doc. They should paste it as-is. The tool decides whether it's clear enough, asks only what it must, and starts.
2. **Logins.** The README leads with saved logins (`session:`, `qa login`). The tool should simply use the person's own Chrome, signed in as whatever they're signed in as.
3. **Setup.** Today it's: clone, `npm ci`, install a browser, symlink, edit a dotfile, run `doctor`. It should be one instruction pasted to Claude Code, like TypeSafe's or ElevenLabs' install prompts, with the agent working out the details.

The reference input is the user's real checklist (PBSA / feature flag on `stage3.env.housinganywhere.dev`; quoted in §6.1). The design has to handle that paste well.

## 2. Goals

- G1. **Paste and go.** `/visual-qa:test`, paste a checklist in any shape (bullets, ☐ boxes, sections, notes, a URL in prose). If nothing is unclear, the run starts with a single line ("Running 11 checks in 4 groups…"). No file is shown and nothing needs approving.
- G2. **Only necessary questions.** When something is unclear, Claude asks all its questions in one message, and only about what neither the paste nor the site can answer.
- G3. **Finding the right page is part of the test.** A check such as "French listing → address shows" needs no URL. The test's steps find a French listing.
- G4. **No pass for the wrong reason.** Each test records what it relies on ("the listing is in France and from a PBSA advertiser"). A test is only a PASS when the evidence shows that condition was really met.
- G5. **Setup changes happen mid-run.** Checks are grouped by the setup they need (feature-flag state, which account is signed in). The tool runs what it can, then pauses: "Section 1 needs the flag OFF. Switch it and say go." The person can also say skip.
- G6. **Always the person's own Chrome.** Signed-in checks run as tabs in their Chrome. Logged-out checks run in a separate signed-out window inside the same Chrome. Nothing to download.
- G7. **One-paste install.** A non-developer pastes one instruction into Claude Code. After that, the only manual steps are typing `/reload-plugins`, entering the TypeSafe key and flipping Chrome's remote-debugging switch. The tool guides each one.
- G8. **The report speaks the checklist's language.** Each row shows the original checklist line it came from, grouped under the setup it ran in.

## 3. Non-goals

- Other agents (Codex, Cursor, etc.). The tool depends on Claude Code: subagents, transcripts for token accounting, and subscription billing.
- Windows and Linux. macOS only, as before.
- Switching feature flags, switching accounts, or creating test data (e.g. a booking in "Paid" state). The person does these when the tool pauses.
- A separate "explore the site first" phase. Discovery happens inside each test's steps (§6.2).
- A test run during setup. Removed at the user's request.
- Downloading a separate browser. Removed at the user's request.
- CI, parallel runs, pixel diffs. Unchanged from v1.

## 4. Anti-goals: failure even if it technically works

- A PM has to read or edit YAML, or type terminal commands. The exceptions are the paste-in install line, `/reload-plugins` and the slash commands.
- **A PASS where the page didn't meet the condition the check relies on.** Example: "French + unit type missing nationality → nationality hidden" passes on a non-PBSA listing, where nationality never shows anyway.
- Asking questions the paste or the site already answers, or asking one question at a time when they could be asked together.
- The TypeSafe key passing through the chat (the transcript is kept).
- Signing the person out, or touching tabs and windows the tool didn't open.
- Treating a skipped check as passed, or hiding it.

## 5. Constraints and facts

- **Plugin packaging** (checked against Claude Code docs, 2026-11-16):
  - A public GitHub repo can be its own marketplace. `.claude-plugin/marketplace.json` sits at the repo root, and the plugin can live in a subfolder (`"source": "./visual-qa"`).
  - The install id is `<plugin>@<marketplace name>`.
  - Plugin skills are invoked as `/<plugin>:<skill>`. A bare `/visual-qa` is not reliably available.
  - With `package.json` and a lockfile at the plugin root, Claude Code runs the npm install itself on install, on update and at first session start. Limits: lifecycle scripts are disabled, the timeout is 60 s, and only exact registry versions are allowed.
  - The documented fallback is a SessionStart hook that installs into `${CLAUDE_PLUGIN_DATA}`.
  - `${CLAUDE_PLUGIN_ROOT}` is a versioned cache folder that changes on every update. Never write state there. `${CLAUDE_PLUGIN_DATA}` survives updates.
  - A plugin installed from the shell becomes available after `/reload-plugins` or a restart. The docs don't say whether the model can run `/reload-plugins` itself, so plan on the person typing it.
  - Third-party marketplaces have auto-update **off** by default. People switch it on in `/plugin` → Marketplaces.
  - `${CLAUDE_SKILL_DIR}`, `${CLAUDE_PLUGIN_ROOT}` and `${CLAUDE_PLUGIN_DATA}` are substituted in skill Markdown and in `allowed-tools` Bash rules. That's documented but not yet tried with this skill.
  - A skill's `model:` applies only to the turn it's invoked in. After a pause, the next turn runs on the session's own model.
- **Repo:** `github.com/dontdothatapp/qa-no-qa` is public. Private marketplaces would need GitHub credentials, which is not PM-friendly.
- **Node:** the runner needs Node ≥ 22.18 (built-in TypeScript type stripping). The npm install that Claude Code runs also needs Node/npm on PATH. Most PM laptops don't have Node. The install line asks the agent to install it first.
- **Chrome:**
  - The person switches on remote debugging once, at `chrome://inspect/#remote-debugging` (Chrome ≥ 144).
  - Chrome asks them to click **Allow** on every new connection, so once per run.
  - Both are out of the tool's hands.
  - Playwright's `browser.newContext()` on a `connectOverCDP` browser creates a separate, signed-out browser context (its own window). The runner already has this code path (`openScenario`). Whether Chrome's remote-debugging mode allows it has to be confirmed in the spike (§9).
- **Evidence from the earlier live run** (`~/QA/2026-11-16 HousingAnywhere AI assistant`): a discovery step ("Open any listing that is not a Student residence") worked, but Jev handed back at step 1 and Claude did 20 of the 21 actions. Expect discovery steps to land mostly on Claude: slower and more Claude tokens. That's acceptable. The report already shows the Jev/Claude split.
- Everything from the v1 spec still holds unless changed here: hand-back rules, side-effect guards, allowed hosts, bot-protection handling, no passwords, verdict rules, and the token footer.

## 6. Design

### 6.1 The reference paste and what should happen

> PBSA advertisers uuids (nationality / Country of Birth only visible on listings from these users): • e2f754ed-… • 3b7777a7-… • 8764ef6c-…
> 1. Flag OFF ☐ Apply (French listing) / profile / talk — no address, employment, nationality, or country of birth
> 2. Flag ON — Apply ☐ French listing → address + employment show ☐ Non-French listing → those fields do not show ☐ French + unit type has nationality and CoB → those two also show ☐ French + unit type missing those → address/employment still show; nationality / CoB do not
> 3. Flag ON — Profile (tenant) ☐ Address + employment show; can save ☐ Nationality / CoB never show on profile
> 4. Flag ON — Landlord talk (under Occupation and finances) ☐ Not Paid + address/employment filled → those show; nationality / CoB hidden ☐ Paid + nationality / CoB filled → those show too ☐ Empty values → no blank rows
> Tests on https://stage3.env.housinganywhere.dev/, I'm logged in as a fresh user. The flag is currently ON.

What the tool should do:

1. **Separate background from checks.** The PBSA UUIDs and "logged in as a fresh user, flag ON" are background. The ☐ lines are checks. "Apply / profile / talk" in section 1 splits into three checks.
2. **Group by setup**, ordered for the fewest switches:
   - Flag ON + current tenant account → sections 2, 3
   - Flag ON + landlord → section 4
   - Flag OFF + landlord → section 1 "talk"
   - Flag OFF + tenant → section 1 "apply", "profile"
3. **Ask only what no page shows.** All in one message, for example:
   - "Which PBSA listings have nationality and country of birth on their unit type, and which don't? A link to one of each is enough."
   - "Section 4 needs a landlord who has a conversation in Not Paid and one in Paid state. Which landlord account, and which conversations?"
   - Whether a listing is in France can be seen on the listing, so it isn't asked.
4. **Start.** "Running 12 checks in 4 groups. First group: flag ON, signed in as you are now."
5. **Pause between groups.** "Next 3 checks need a landlord signed in, flag still ON. Sign in as the landlord in Chrome, then say go (or skip)."

### 6.2 Intake: from paste to tests (Claude, in the `test` skill)

A new brief, `reference/intake.md`, tells Claude how to turn a paste into tests. Rules:

- **Site:** take the URL from the paste. If there's none, ask.
- **One check = one test.** A ☐ that bundles several pages splits into one test per page. Its title is short; its `source` is the original line, verbatim.
- **Steps include finding the right page**, phrased as goals: "Search for listings in France and open one from a PBSA advertiser (IDs in the notes)", "Open the apply form", "Do not submit the application". The existing step style rules still apply: one goal per step, quoted button text, and "say when to submit".
- **`relies_on`:** every condition the expected result depends on that a page can show, and the step after which it is visible ("the listing's address is in France", after step 1). If a condition can't be seen on any page (e.g. unit-type settings), it becomes a question, or the person supplies a link that settles it.
- **Expected result:** observable on the final page, as today. Vague wording gets a concrete, checkable reading. The judge sees only the final page, so a two-moment check is split: "can save" → steps that fill the form, click Save and reload the page; a `relies_on` item "A save confirmation shows" with `after_step` set to the Save step; and `expected` = what the reloaded page shows ("the saved values are still in the fields"). That reading is Claude's call, not a question. It is visible in the report.
- **Groups:** from the setup each check needs (flag state, account role, logged out). The first group is "as you are now", taken from what the paste says about current state.
- **Logged-out checks:** marked `logged_out: true` (§6.4). They don't need a group switch.
- **Ask only when the answer would otherwise be a guess that changes the result:** a missing site, a data property no page shows, or a specific account or record the person must provide. All questions go in one message, numbered, and each says why it's needed.
- **Untestable checks** (an email, a backend job) are listed in the first message as "won't test: …", and recorded as not run.

Claude writes the tests to the existing scenario-file format (extended below) at `~/QA/scenarios/<topic>.yaml`, and saves the paste verbatim next to it as `<topic>.checklist.txt`. Neither is shown to the person. Both are copied into the run folder.

### 6.3 Scenario-file changes (internal format)

Additions:

```yaml
notes: |                         # background from the paste, given to takeover agents (not to the judge)
  PBSA advertiser IDs: e2f754ed-…, 3b7777a7-…, 8764ef6c-…
groups:                          # in run order; the first is "as you are now"
  - id: g1
    needs: Feature flag ON; signed in as the tenant you're using now
  - id: g2
    needs: Feature flag ON; signed in as a landlord with a Not Paid and a Paid conversation
scenarios:
  - id: APPLY-FR
    group: g1
    source: "☐ French listing → address + employment show"
    title: Apply form on a French listing shows address and employment
    start: /
    steps: [...]
    relies_on:
      - what: The listing's address is in France
        after_step: 1            # 1-based; omitted = the final page
    expected: The apply form shows address fields and employment fields
  - id: LOGGEDOUT-X
    logged_out: true             # separate signed-out window in the person's Chrome
    ...
```

Removals:
- `browser:` (always Chrome)
- `session:` and saved sessions
- `qa login` and `src/login.ts`
- isolated-mode launching (`chromium.launch`)
- the doctor's Chromium check
- the `projectRoot` `.env` lookup (meaningless inside a plugin cache)

`viewport`, `allow_hosts` and `judge_model` stay as optional fields Claude may set. Validation keeps rejecting passwords.

### 6.4 Runner changes

- **Logged-out window:** `logged_out: true` → `browser.newContext()` on the connected Chrome (the existing `openScenario` path, without `storageState`). The context, and so its window, is closed after evidence capture. Nothing else in the person's Chrome is touched.
- **`relies_on` evidence:** when a test's step N is marked done, by Jev or Claude, and some `relies_on` item has `after_step: N`, the runner captures a viewport screenshot and page text into the scenario's evidence folder. `qa evidence <id>` lists these with their `what`.
- **Not run:** a new command, `qa skip <id> --reason "<text>"`, records a test as **not run**. This is a fourth outcome, distinct from NEEDS REVIEW: the person chose to skip it, or it is untestable. It works for tests that were never started.
- **Groups:** `qa start` returns the groups and their test ids in order. Pausing is the skill's job. The daemon only needs to survive a pause:
  - The idle timeout (30 min today) must not drop results captured so far.
  - If the daemon has stopped when the person says go, continuing must reuse the same run folder and report, even if Chrome asks for **Allow** again.
  - How is left to the builder.
- **Verdict:** `computeVerdict` gains `relies_on` results:
  - Any `relies_on` item not met or unclear → **NEEDS REVIEW**, with the reason "Couldn't confirm the test ran on the right page: <what>". This applies even if the expected points were met. It can't be FAIL either: a wrong page says nothing about the product.
  - Only when every `relies_on` item is met do the existing rules apply.
  - The same quote check applies to `relies_on` evidence.
- **Give-ups and `relies_on`** (design call, from the builder check):
  - **Couldn't find a matching page.** A new give-up class, `no_matching_page`, is for when the steps can't find a page that meets a `relies_on` condition (e.g. no French listing from a PBSA advertiser). It gives **NEEDS REVIEW**, with the reason "Couldn't find a page that matches: <what>". The takeover brief gets this third class.
  - **`app_problem` give-ups with a `relies_on` item due at or before the step where they stopped.** Such a test counts as FAIL only if a judge confirms those items from the evidence captured so far. So these give-ups are judged too, for `relies_on` only. Unconfirmed → NEEDS REVIEW ("Stopped on a page that may not be the right one: <what>").
  - Give-ups with no `relies_on` items due yet work as today.

### 6.5 Judge changes

`reference/judge.md` gains a second list. For each `relies_on` item, it reads that item's snapshot (or the final page) and marks it met, not met or unclear, with quoted or described evidence, the same as key points. The output JSON gets `reliesOn: [{what, status, evidence, source}]`. The judge still never sees how the steps were carried out, or the `notes`.

### 6.6 The `test` skill flow (replaces today's SKILL.md)

1. **Preflight:** `qa doctor`. If anything is missing (Node, key, Chrome switch), run the setup flow (§6.8) inline, then continue.
2. **Intake** (§6.2). Ask questions only if needed. Otherwise send one line and start.
3. **Start:** remind the person once, in one line, to click **Allow** in Chrome and not to type in Chrome during the run.
4. **For each group:**
   - Before every group except the first, pause with that group's `needs`, phrased as an instruction. Wait.
   - On "go", run its tests. On "skip", `qa skip` each test in it.
   - Hand-backs, takeovers, bot blocks and give-ups work as today, plus `no_matching_page` (§6.4).
   - The takeover brief also gets `notes`.
   - **At every pause,** first judge the tests finished so far and write the report so far (design call). Someone who never comes back still has results. The report is rewritten at the end. Tests not reached yet show as NOT RUN ("paused before this group").
   - **Coming back later in a new chat** (user decision):
     - `/visual-qa:test continue`, or "continue my last QA run", finds the latest run folder that has tests not reached.
     - It says which groups are left and pauses for the first group's setup.
     - It then runs only those tests as a **new run with its own report**. The header links back to the earlier report.
     - No merging of reports, and no token counting across chats.
     - The run folder must record enough to do this: the scenario file, the groups, and which tests were not reached.
     - How the new run is started (e.g. `qa start <file> --only <ids>`, or a trimmed copy of the file) is left to the builder.
5. **Judge** all completed tests in parallel, as today.
6. **Report and stop.** Then a short summary in chat:
   - the counts line;
   - the report link;
   - one line per FAIL, NEEDS REVIEW and NOT RUN, each quoting its checklist line.

Frontmatter:
- name `test` in the `visual-qa` plugin (invoked as `/visual-qa:test`);
- `argument-hint: [paste your checklist]`;
- `model: sonnet`;
- `allowed-tools` using `${CLAUDE_PLUGIN_ROOT}`.

**Design call:** model invocation stays **on**, so "test this checklist on stage3" works without the slash command. The description is narrow (browser QA of a checklist on a website), and the start line says it's about to use the person's Chrome. The privacy note (page text goes to TypeSafe; tests act in real accounts) moves to setup and the README. It is said once, not every run.

### 6.7 Report changes

- Rows are grouped under their group's `needs` line. Each row shows its `source` (the original checklist line) above the generated title, steps and expected result.
- **NOT RUN** is a fourth outcome with its own colour and count. The summary reads e.g. "7 pass · 1 fail · 2 needs review · 2 not run".
- `relies_on` results are shown with the key points, labelled "Ran on the right page?". A snapshot thumbnail is shown when one was captured.
- The original paste goes in a collapsible "Your checklist" section at the top.
- The header always says "Ran in your Chrome (your sign-ins)". The isolated-mode wording goes.

### 6.8 Setup

**Repo layout:**

```
.claude-plugin/marketplace.json      { name: "qa-no-qa", owner: {...}, plugins: [{ name: "visual-qa", source: "./visual-qa", description }] }
visual-qa/.claude-plugin/plugin.json { name: "visual-qa", description, ... }
visual-qa/skills/test/SKILL.md       (today's SKILL.md, rewritten per §6.6)
visual-qa/skills/setup/SKILL.md
visual-qa/bin, src, reference, package.json, package-lock.json   (unchanged locations)
```

**The install line** (top of the README, in a copy box):

> Install Visual QA: if Node.js 22.18 or newer isn't installed, install it. Then run `claude plugin marketplace add dontdothatapp/qa-no-qa` and `claude plugin install visual-qa@qa-no-qa`, and tell me to type /reload-plugins and then /visual-qa:setup.

**`/visual-qa:setup`** is a short skill backed by a deterministic `qa setup` command. It prints the state of each item and the single next thing the person must do (the ElevenLabs "follow what it prints" pattern). It is safe to re-run. Items, in order:

1. **Node ≥ 22.18 and the runner's npm packages present.** If the packages are missing, it says so and tells the agent to install them. Where they go depends on §5's install path.
2. **TypeSafe key.**
   - It creates `~/.visual-qa/.env` with a placeholder line, if the file is missing.
   - It opens TypeSafe's key page in the browser (the builder finds the exact URL), and opens the `.env` file in TextEdit.
   - The person pastes the key, saves and says done. Setup checks the key with one cheap Jev call (today's `jev_reachable`). That is a key check, not a test run.
   - The key never appears in chat or in command output.
3. **Chrome remote debugging.**
   - Checks for Chrome ≥ 144.
   - Opens `chrome://inspect/#remote-debugging` in Chrome. If macOS won't open `chrome://` addresses, it shows the address to paste instead.
   - Waits, up to a few minutes, until `DevToolsActivePort` appears.
4. **Updates:** tells the person how to switch on auto-update for the qa-no-qa marketplace.
5. **The one-time privacy note:**
   - Page text goes to TypeSafe during runs, including text from signed-in pages.
   - Tests act in the person's real accounts.
   - The safety guards still apply.

**Approval prompts** (user decision):
- If the spike (§9, item e) shows that the `test` skill's `allowed-tools` don't cover the whole run, the plugin ships a **PreToolUse hook** that approves only its own commands. "The whole run" means turns after a pause, plus the takeover and judge subagents.
- "Its own commands" means Bash calls to `node ${CLAUDE_PLUGIN_ROOT}/bin/qa.ts …` and Write calls to files under `~/QA/`.
- Everything else goes through the normal permission flow.
- The hook comes and goes with the plugin, and keeps working across updates. Setup never edits the person's Claude Code settings.

`doctor` keeps its role as the fast check that `test` runs first. It drops the Chromium check and adds the Node-packages check. It keeps the `ANTHROPIC_API_KEY` warning.

### 6.9 README

Rewritten for PMs and designers. It leads with:
1. what it does (two lines);
2. the install line;
3. how to use it: `/visual-qa:test` plus paste, with a short example paste;
4. what you'll be asked during a run (Allow, pauses, skip);
5. what the report looks like.

Privacy and safety stay. Below a "For developers" heading go the local dev setup, `npm test`, a pointer to the internal file format, and the project layout. YAML no longer appears in the user-facing part.

## 7. Approaches considered

| | Approach | Trade-off | Outcome |
|---|---|---|---|
| **A** | **Keep the runner; change what's around it.** Claude turns the paste into the existing scenario file behind the scenes. The runner gains `relies_on`, groups, logged-out windows and "not run". Saved logins and isolated mode go. Packaged as a plugin. | Keeps all the tested hand-back, safety and report logic. The file stays in the run folder as a record. Moderate change. | **Chosen** |
| B | No file: Claude feeds checks to the runner one at a time. | More flexible mid-run. Loses the written record and reproducibility, and `start`/run logic needs rewriting. | Rejected |
| C | Claude drives every pasted check itself, no Jev. | Least code. Slow and costly, against the tool's reason to exist. | Rejected |

Finding data:
- **Discovery inside the test steps** is chosen, by the user, citing their Berlin run.
- Rejected: a separate Claude "look first" phase, and asking the person for every URL.

Setup packaging:
- **Claude Code plugin from this repo, plus a guided `setup` command** is chosen. It is documented, Claude Code installs the dependencies, and updates come through the plugin system.
- Rejected: clone plus an agent-readable SETUP.md (manual updates, less deterministic); an `npx` installer (needs Node already, and npm publishing).

Logged-out checks:
- **A signed-out window in the person's Chrome** is chosen. It avoids downloading a browser, which the user ruled out, and is gentler with bot protection.
- Rejected: keeping the downloaded headless browser; dropping logged-out checks.

## 8. Decided by the user vs. design calls

**User:**
- Paste anything; start without approval when clear.
- Finding pages is part of the test.
- Always the person's Chrome; no saved logins.
- One-paste install.
- No separate browser download.
- No test run in setup.
- Route A.
- If approval prompts appear mid-run, the plugin approves its own commands with a hook.
- Coming back in a new chat runs the remaining tests as a new report.

**Design calls (check these):**
- Questions all in one message.
- Groups ordered for the fewest switches.
- Pauses with go/skip.
- "Not run" as a fourth outcome.
- `relies_on` misses → NEEDS REVIEW, never FAIL.
- `no_matching_page` give-ups → NEEDS REVIEW.
- An `app_problem` give-up is only FAIL once its due `relies_on` items are confirmed.
- A report is written at every pause.
- Logged-out checks in a signed-out Chrome window.
- The key is entered in a TextEdit-opened file, not in chat or Claude Code's plugin settings.
- Model invocation on for `test`.
- The privacy note moves to setup.
- Plugin commands `/visual-qa:test` and `/visual-qa:setup`.

## 9. Build order and acceptance

1. **Spike** (throwaway) against the real Chrome and a real plugin install:
   - (a) `newContext()` over Chrome's remote-debugging connection gives a signed-out window that closes cleanly;
   - (b) `open -a "Google Chrome" "chrome://inspect/#remote-debugging"` works;
   - (c) installing the plugin from a local marketplace path and from GitHub installs the npm packages within the limits, and `${CLAUDE_PLUGIN_ROOT}` works in `allowed-tools`;
   - (d) whether `/reload-plugins` is needed, in the terminal and in the desktop app;
   - (e) whether the skill's `allowed-tools` still apply in turns after a pause and inside the takeover and judge subagents. If not, the approval hook in §6.8 is built.

   Results go to `docs/superpowers/notes/`.
2. **Runner and format:** remove isolated mode, sessions and login. Add `notes`, `groups`, `source`, `relies_on`, `logged_out`, `qa skip`, `relies_on` evidence capture, and the verdict changes. Unit tests use the existing fixture site and the Chromium-with-debug-port stand-in.
3. **Judge brief, intake brief, test skill, setup skill and `qa setup`.**
4. **Report changes.**
5. **Plugin packaging, README.** `claude plugin validate` passes for the plugin and the marketplace.
6. **Acceptance:**
   - (a) The user's PBSA checklist pasted verbatim on stage3. Expect: questions only about hidden unit-type data and the landlord account/conversations; four groups with pauses; no PASS and no FAIL whose `relies_on` items are unconfirmed.
   - (b) The fixture acceptance suite, still green after conversion to the new format.
   - (c) A fresh-install test in a clean macOS user account (or clean `HOME`) using only the README's install line.

## 10. Left to the builder

- Exact field names and CLI flags, if the ones above clash with existing code.
- `playwright` vs `playwright-core` (only CDP connections are needed now). Trimming dev dependencies so the plugin's npm install fits the 60 s limit, or falling back to the SessionStart hook into `${CLAUDE_PLUGIN_DATA}`.
- How the daemon survives long pauses (§6.4).
- Plugin versioning: commit-tracking (no `version`) vs tagged releases. Default to no `version`, so pushes to `main` reach people with auto-update on.
- The exact TypeSafe key page URL.
- Whether Claude Code's plugin `userConfig` (sensitive values) can replace the `.env` file. Use it only if the value reliably reaches the runner's Bash commands.
- How to migrate today's tests (`skill-files.test.ts` asserts `disable-model-invocation: true`, `CLAUDE_SKILL_DIR`, etc.).

## 11. Risks

- **Discovery steps mostly run on Claude** (seen in the Berlin run). Runs on pasted checklists will be slower and use more Claude tokens than the "Jev clicks" pitch suggests. The report makes this visible.
- **Chrome may refuse `newContext()` over its remote-debugging connection.** Fallback: a logged-out check pauses and asks the person to sign out (or skip). Signing out affects the rest of the run, so such tests go last.
- **The plugin npm install may time out** on slow networks. Fallback: the SessionStart hook, with setup reporting the state.
- **Node install on a PM laptop may need an admin password** (official installer) or Homebrew. The agent handles it, but it is the least predictable step.
- **The `model: sonnet` override covers only the invoking turn.** Turns after a pause run on the session's model.
