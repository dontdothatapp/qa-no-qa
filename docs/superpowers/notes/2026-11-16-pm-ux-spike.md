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
