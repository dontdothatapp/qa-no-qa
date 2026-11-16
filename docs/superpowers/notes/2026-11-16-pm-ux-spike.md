# PM-friendly UX spike (plan 2026-11-16)

## Task 0 — the user's real Chrome (Chrome 157.0.8103.78, macOS)

### (a) Logged-out context over Chrome's remote-debugging connection — works

`node visual-qa/spike/pm-ux-spike.ts`, with the user clicking **Allow**:

```json
{"connectedAfterMs":2920,"userTabsBefore":5,"newContextOk":true,"title":"Example Domain","cookiesInNewContext":0,
 "viewport":[1280,800],"screenshotBytes":50934,"contextClosedOk":true,"userTabsAfter":5,"disconnectedOk":true}
```

- The user saw a separate window open on example.com and close by itself, with their own tabs untouched.
- `browser.newContext()` works on the `connectOverCDP` connection with `noDefaults: true`.
- The new context has no cookies, and its window can be screenshotted while it isn't the focused window.
- `context.close()` closes the window. `browser.close()` only disconnects, and Chrome stays open.

**Decision:** Task 2 uses `openLoggedOutScenario` (`browser.newContext`). The fallback branch is not needed.

### (b) `open -a "Google Chrome" "chrome://inspect/#remote-debugging"` — works

- Exit code 0. The user confirmed Chrome opened the remote-debugging page with the on/off switch.

**Decision:** Task 8's `--open-chrome` runs exactly this command and returns `{ opened: true }`. The `{ opened: false, address }` form is kept only for a non-zero exit, e.g. Chrome not installed.

## Task 10 — real plugin install (2026-11-16)

### (c) Install from GitHub, into a throwaway `CLAUDE_CONFIG_DIR` — works

Ran from the branch, pushed with the user's OK:

```
claude plugin marketplace add "https://github.com/dontdothatapp/qa-no-qa.git#pm-friendly-ux"
claude plugin install visual-qa@qa-no-qa
```

- The marketplace clone, validation and plugin install all succeeded. The `#<ref>` suffix selects the branch.
- Claude Code ran the npm install itself into `plugins/cache/qa-no-qa/visual-qa/<sha>/node_modules`, about a second after copying the files. The result is 53 MB, including dev dependencies, which is well inside the 60 s limit.
- From the cache, `bin/setup.ts --check` reports `node` and `packages` ok and stops at `typesafe_key` (empty HOME). `bin/qa.ts remaining` imports playwright and the SDK fine.
- A *local-path* marketplace (`claude plugin marketplace add "$PWD"`) copies the working tree as-is, including the gitignored `node_modules` and `test/.tmp`. It can't show whether the auto-install works, so only the GitHub install counts as evidence.

**Decision:** no change to `package.json`. `playwright-core` and the SessionStart-hook fallback aren't needed.

The user's old `~/.claude/skills/visual-qa` symlink was removed with their OK. The skill moved to `skills/test/`.

### (d) and (e)

- **(d)** Whether `/reload-plugins` is needed, in the terminal and in the desktop app.
- **(e)** Whether runner commands prompt for approval after a pause or inside the takeover and judge subagents.

Both are checked in the live acceptance session with the user (ruling R13 in the SDD ledger) and recorded below.
