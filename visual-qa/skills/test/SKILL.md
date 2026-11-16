---
name: test
description: Test a pasted QA checklist or test cases on a website, in the person's own Chrome — Jev navigates, Claude takes over when stuck and judges each result from screenshots — and write an HTML report. Use when someone pastes test cases or a checklist and asks to test or QA them on a site, or asks to continue a paused QA run.
argument-hint: [paste your checklist]
model: sonnet
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/bin/qa.ts *) Bash(node ${CLAUDE_PLUGIN_ROOT}/bin/setup.ts *) Read Write Agent
---

# Visual QA: test a checklist

Test every check in the person's checklist in their Chrome, judge each result, and hand them a report. Work through the steps in order.

The person is usually a PM or designer. Keep your messages short and plain. Never show them YAML, file contents or command output, and never ask them to run a command.

Runner: `node ${CLAUDE_PLUGIN_ROOT}/bin/qa.ts <command>`, written `qa.ts <command>` below. Always run it in exactly that form, so it is pre-approved. Every command prints one JSON object (`look` prints text).

Input: `$ARGUMENTS`

## 1. Preflight

Run `node ${CLAUDE_PLUGIN_ROOT}/bin/setup.ts --check`.
- `ok` is false → Read `${CLAUDE_PLUGIN_ROOT}/skills/setup/SKILL.md` and follow its steps 1–2 until `ok`:
  - In that file the plugin folder is written as a `CLAUDE_PLUGIN_ROOT` variable; use `${CLAUDE_PLUGIN_ROOT}` in its place.
  - Skip its step 1 if `--check` printed JSON (Node already works).
  - Relay its `notes` once, then continue here. If setup stops without `ok`, stop here too.
- The `anthropic_api_key` item is not ok → say in one line that Claude Code may be billing the API instead of their subscription (`/status` shows which), and ask whether to continue. Wait for the answer.

## 2. Continue a paused run

Only when the person asks to continue (or the input is `continue`):
- If this chat has a run paused between groups, treat it as "go" (step 5).
- Otherwise run `qa.ts remaining`. `{"found":false}` → say there is no paused run to continue and ask for their checklist.
- Otherwise Read `<testsFile>` (takeovers need its YAML blocks and `notes`). Do step 4, saying in its message how many checks are left, with this start command: `qa.ts start <testsFile> --session ${CLAUDE_SESSION_ID} --only <every remaining id, comma-separated> --continues <runDir>`.
- Then do step 5, pausing before the first group too.

## 3. Intake

- The input is a path to a `.yaml`/`.yml` file → Read it (takeovers need its YAML blocks and `notes`) and go to step 4.
- Nothing was pasted → ask them to paste their checklist.
- Otherwise Read `${CLAUDE_PLUGIN_ROOT}/reference/intake.md` and follow it. It says what to ask (all in one numbered message, only if needed) and which files to write.
- Then send one line: `Running N checks in M groups. First group: <needs>.` (a single group: `Running N checks.`), plus the "won't test: …" lines unless your questions message already listed them.

## 4. Start

1. Send one line (with the start line, if there is one): Chrome will ask to let the test connect, so click **Allow**; test tabs will come to the front of their Chrome, so they should not type in Chrome until it finishes.
2. Run `qa.ts start <file> --session ${CLAUDE_SESSION_ID}`. Note `runDir`, `judgeModel` and `groups` (in run order, each `{id, needs, scenarios}`).
3. For each "won't test" check: `qa.ts skip <id> --reason "<why it can't be tested>"`.

Start errors:
- "a run is already active" → ask whether to end that run (`qa.ts stop`), then start again. If they say no, stop here.
- Chrome connection errors ("did not allow the connection", "refused the connection", "not reachable", "remote debugging is off") → tell them in plain words what to do: click **Allow** when Chrome asks, or switch remote debugging on (`node ${CLAUDE_PLUGIN_ROOT}/bin/setup.ts --open-chrome` opens the page). When they are ready, start again. Do not change the test file.
- "invalid scenario file" or another error → fix the file yourself (format: `${CLAUDE_PLUGIN_ROOT}/reference/scenario-format.md`) and start again.

## 5. Each group, in order

1. **Pause** before every group except the first (in a continued run, before the first too):
   - Judge the tests finished so far (step 6), then run `qa.ts report` (skip both if none has finished).
   - Send: `Next N checks: <needs, as an instruction>. Say go when ready, or skip.`, with the report so far as a link if there is one. Wait.
   - skip → `qa.ts skip <id> --reason "skipped at the pause"` for each test in the group; go to the next group.
   - stop, or "that's enough" → step 7.
2. For each test id in the group: `qa.ts run <id>`.
   - `"status":"completed"` → next test.
   - `"status":"gave_up"` → the runner ended it (e.g. the site's bot protection refused; the reason is in `gaveUp`) → next test. Do not retry.
   - `"status":"handback"` with `"reason":"jev_unavailable"` → ask: the fast navigator isn't available; should Claude do the remaining checks itself (slower), or stop?
     - Stop → for every test not finished, including the current one: `qa.ts giveup <id> --class tooling_or_environment --reason "Jev unavailable"`, then step 7.
     - Claude → handle this and every remaining test with a takeover agent, calling `run` first so the page opens.
   - Any other `"status":"handback"` → start a takeover agent and wait for it before the next test:
     - Agent tool, `description: "QA takeover <id>"` (exactly), `model: "sonnet"`.
     - Prompt: the contents of `${CLAUDE_PLUGIN_ROOT}/reference/takeover.md` with `{{QA}}` replaced by `node ${CLAUDE_PLUGIN_ROOT}/bin/qa.ts`, `{{SCENARIO}}` by this test's YAML block, `{{RUN_RESULT}}` by the JSON `run` just printed, and `{{NOTES}}` by the file's `notes` (or `None.`).
     - It replies with one JSON line. Do not open its screenshots yourself.
3. Runner errors, for any command:
   - The error text contains `qa reopen` (the connection to Chrome ended, e.g. after a long pause) → tell them to click **Allow** in Chrome again, run `qa.ts reopen`, then repeat the command that failed.
   - `qa.ts reopen` itself fails (Allow not clicked in time, remote debugging is off, "no run to reopen") → do not retry. Tell them in plain words, run `qa.ts report` and `qa.ts stop`, and send the summary (step 7.3).
   - The runner prints `{"error": ...}` for a test instead of a status → record it with `qa.ts giveup <id> --class tooling_or_environment --reason "runner error: <message>"` and go on with the next test.

## 6. Judge

For every test that finished (completed or gave up) and is not judged yet: run `qa.ts evidence <id>`. For each one whose output says `"needsJudge":true`, start a judge agent:
- Agent tool, `description: "QA judge <id>"` (exactly), `model:` the run's `judgeModel`.
- Prompt: the contents of `${CLAUDE_PLUGIN_ROOT}/reference/judge.md` with `{{EVIDENCE}}` replaced by the evidence JSON.
- Start them all in one message so they run in parallel, and wait for all of them. Pass on nothing about how the steps were carried out, and not the `notes`.

## 7. Report

1. Judge anything not judged yet (step 6).
2. `qa.ts report` → note `reportPath` and `summary`. Then `qa.ts stop`.
3. Read `<runDir>/results.json` and send a short summary:
   - the `summary` line (e.g. "7 pass · 1 fail · 2 needs review · 2 not run");
   - the report as a clickable link to `reportPath`;
   - one line per row whose `verdict` is `fail`, `needs_review` or `not_run`: its `source` in quotes (or `title` if there is none), then its `reason`;
   - if any row's reason is "paused before this group": they can type `/visual-qa:test continue` later to run the rest.

If anything goes wrong mid-run, still run `report` and `stop` so they get what was captured.
