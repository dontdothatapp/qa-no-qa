---
name: visual-qa
description: Run plain-language browser test scenarios — Jev navigates, Claude takes over when stuck and judges screenshots — and write a local HTML report with inline screenshots and token usage.
argument-hint: [scenarios.yaml]
disable-model-invocation: true
model: sonnet
allowed-tools: Bash(node ${CLAUDE_SKILL_DIR}/bin/qa.ts *) Read Write Agent
---

# Visual QA run

Run every scenario in a browser, judge each result, and hand the user a report. Work through the checklist in order. Every runner command prints one JSON object (`look` prints text). Keep your own messages short; the report is the deliverable.

Runner command prefix used below: `node ${CLAUDE_SKILL_DIR}/bin/qa.ts`

## 1. Preflight

Run `node ${CLAUDE_SKILL_DIR}/bin/qa.ts doctor`.
- Any failed check with `"level":"error"` → stop and tell the user the check's `detail` (it says how to fix it).
- `anthropic_api_key` warning → tell the user that Claude Code may be billing the API instead of their subscription (they can check with `/status`) and ask whether to continue. Wait for the answer.
- `chrome_remote_debugging` warning → only matters if the scenario file runs in Chrome (the default, `browser: chrome`): tell the user to switch it on at `chrome://inspect/#remote-debugging`, or use `browser: isolated`.
- Mention once, in one or two lines: page text is sent to TypeSafe (Jev's provider) while scenarios run — in Chrome mode that includes text from the user's signed-in pages — and Chrome-mode tests act in the user's real accounts.

## 2. Scenarios

Input: `$ARGUMENTS`
- If it is a path to a `.yaml`/`.yml` file, use it.
- Otherwise the user gave scenarios as text (or nothing — then ask for them). Read `${CLAUDE_SKILL_DIR}/reference/scenario-format.md`, draft the YAML, save it as `~/QA/scenarios/<topic>.yaml`, show it to the user, and wait for their OK before running.

## 3. Start the run

Run `node ${CLAUDE_SKILL_DIR}/bin/qa.ts start <file> --session ${CLAUDE_SESSION_ID}`.
- An error naming a missing session → show the user the exact `login` command from the error (they run it in their own terminal, sign in, close the window), then stop.
- "a run is already active" → ask the user whether to end that run (`node ${CLAUDE_SKILL_DIR}/bin/qa.ts stop`), then start again.
- Any other error (e.g. invalid scenario file) → show it, fix the YAML with the user, and start again.
- Chrome mode: before running `start`, tell the user to click **Allow** in Chrome when it asks (it waits about 100 s), and that scenario tabs will come to the front of their Chrome during the run, so they should not type in Chrome until it finishes.
- Chrome mode connection errors (Chrome "did not allow the connection", "refused the connection", "not reachable") → tell the user the message; they fix it (click Allow / switch on remote debugging) and you start again. Do not touch the YAML.
- On success, note `runDir`, `browser`, the `scenarios` list and `judgeModel`, and pass on any `note`.

## 4. Run each scenario, in order

For each id: `node ${CLAUDE_SKILL_DIR}/bin/qa.ts run <id>`.
- `"status":"completed"` → next scenario.
- `"status":"gave_up"` → the runner ended it (e.g. the site's bot protection refused a request; the reason is in `gaveUp`) → next scenario. Do not retry it.
- `"status":"handback"` with `"reason":"jev_unavailable"` → ask the user: should Claude drive the remaining scenarios, or stop?
  - Stop → for every scenario not finished, including the current one: `node ${CLAUDE_SKILL_DIR}/bin/qa.ts giveup <id> --class tooling_or_environment --reason "Jev unavailable"`, then go to step 6.
  - Claude drives → handle this and every remaining scenario with a takeover agent (below), calling `run` first so the page opens.
- Any other `"status":"handback"` → start a takeover agent and wait for it before the next scenario:
  - Agent tool, `description: "QA takeover <id>"` (exactly), `model: "sonnet"`.
  - Prompt: the contents of `${CLAUDE_SKILL_DIR}/reference/takeover.md` with `{{QA}}` replaced by `node ${CLAUDE_SKILL_DIR}/bin/qa.ts`, `{{SCENARIO}}` by this scenario's YAML block, and `{{RUN_RESULT}}` by the JSON the runner just printed.
  - The agent replies with one JSON line. Do not open its screenshots yourself.
- The runner prints `{"error": ...}` for a scenario (instead of a status) → record it with `node ${CLAUDE_SKILL_DIR}/bin/qa.ts giveup <id> --class tooling_or_environment --reason "runner error: <message>"` and continue with the next scenario.

## 5. Judge

For every scenario that completed (not given up): run `node ${CLAUDE_SKILL_DIR}/bin/qa.ts evidence <id>`, then start a judge agent:
- Agent tool, `description: "QA judge <id>"` (exactly), `model:` the run's `judgeModel`.
- Prompt: the contents of `${CLAUDE_SKILL_DIR}/reference/judge.md` with `{{EVIDENCE}}` replaced by the evidence JSON.
- Start all judge agents in one message so they run in parallel, then wait for all of them. Do not pass on anything about how the steps were carried out.

## 6. Report

1. `node ${CLAUDE_SKILL_DIR}/bin/qa.ts report` → note `reportPath` and `summary`.
2. `node ${CLAUDE_SKILL_DIR}/bin/qa.ts stop`.
3. Tell the user, in a few lines: the summary line, the report path (as a clickable link), and one line per failed or needs-review scenario with its reason. Mention that the token footer in the report shows Jev and Claude usage.

If anything goes wrong mid-run, still run `report` and `stop` so the user gets what was captured.
