# Live acceptance run (2026-11-15)

- **Suite:** `visual-qa/test/acceptance/fixture-suite.yaml`, run with `/visual-qa` in Claude Code against the local fixture site, with the real Jev API.
- **Report:** `~/QA/2026-11-15 Fixture acceptance/report.html`, 669 KB, with 24 inline images and no external references.

## Result: 7 pass · 4 fail · 1 needs review

| Scenario | Verdict | Jev / Claude actions | Time | Notes |
|---|---|---|---|---|
| NAV-01 | PASS | 1 / 0 | 2.0 s | Jev only |
| SRCH-01 | NEEDS REVIEW | 2 / 0 | 2.1 s | **False alarm (safe direction).** The judge wrote its text evidence as a description (`Page text lists "Espresso — …"`) instead of a verbatim quote, so the quote check downgraded the verdict. |
| FORM-01 | PASS | 6 / 0 | 37 s | Jev filled the fields; a takeover marked step 1 done and Jev clicked Submit. |
| SHOP-01 | PASS | 1 / 0 | 1.6 s | Jev picked the right one of two identical "Add to cart" buttons. |
| IFR-01 | PASS | 0 / 1 | 27 s | The iframe is invisible to Jev, so a takeover clicked inside it. |
| UPL-01 | PASS | 0 / 1 | 26 s | A takeover uploaded the file. |
| ACC-01 | PASS | 0 / 0 | 1.0 s | The saved session worked; Jev answered "done" straight away. |
| DE-01 | PASS | 3 / 0 | 26 s | German labels worked; a takeover marked the fill step done. |
| BRK-01 | **FAIL** ✓ | 1 / 0 | 1.8 s | The cart stays at 0. |
| BRK-02 | **FAIL** ✓ | 1 / 0 | 1.5 s | The yearly price shows but the badge is missing. |
| BRK-03 | **FAIL** ✓ | 5 / 1 | 34 s | Submit does nothing. |
| BRK-04 | **FAIL** ✓ | 2 / 0 | 26 s | "No results". |

## Pass criteria (plan Task 14)

- **No broken scenario marked PASS:** met. All 4 are FAIL.
- **Report opens offline with all screenshots:** met.
- **Token footer shows Jev and Claude:** met.
  - Jev used 25.2k input and 4.2k output tokens, about $0.001.
  - Claude used Opus 14.9M (orchestration) and Sonnet 3.8M (takeovers and judges). Both totals are mostly cache reads.
  - The Opus orchestration figure is inflated because the run happened inside a very long build session. A fresh session would be far smaller.
- **Jev does most steps on simple flows:** met. Navigation, search, the shop, the saved login and two broken flows needed no Claude actions.
- **No human input after the doctor step:** met. The pause for the API-key warning and the session login happened before `start`.

## Findings to fix

1. **Judge evidence format (SRCH-01).** Even with `"source":"text"`, judges sometimes describe the text instead of quoting it. Two fixes:
   - tighten `judge.md` ("evidence must be only the copied words");
   - have the quote check accept a double-quoted substring inside the evidence that is found on the page.
2. **Secrets in final URLs.** FORM-01's fixture form uses GET, so the final URL carries `pw=…`, and the report shows it under "Final URL". The report should redact query parameters whose names look secret (pass, pwd, pw, token, secret, key, code). `run.json` also keeps scenario values: that is deferred minor M6.
3. **Takeover time dominates.** Each takeover adds about 25 s, which is subagent start-up plus a few commands. The common case is "Jev filled every field but was unsure whether the fill step is done". A cheap fix: when the step is a fill step and no fields are missing, treat a low-confidence `click` on a submit button as `done`. That would remove most of these takeovers.
4. **Iframe text missing from the evidence text file.** For IFR-01 the judge correctly relied on the screenshot. Adding iframe text to `page-text.txt` would make text evidence possible there too.
