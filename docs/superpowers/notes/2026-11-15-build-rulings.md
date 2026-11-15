# Visual QA build: rulings and deferred items (2026-11-15)

These are the decisions taken during the build where the plan was silent or wrong. Each one gives what it costs if the decision is wrong. The list ends with the reviewer's minor findings that were deferred.

## Rulings

- Setup: Ruling: no worktree; new repo, docs committed on main (65604c8), work on branch feat/visual-qa-skill — repo was created for this plan, nothing else on main — cost if wrong: none, branch can be rebased.
- Setup: Ruling: stray older spec copy "…design 2.md" (user's file, not mine) left on disk untouched and added to .git/info/exclude so `git add -A` never commits it — cost if wrong: user wanted it tracked; trivial to add.
- Setup: Ruling: .gitignore also excludes .superpowers/ and .DS_Store (plan listed 3 entries) — workspace must stay untracked.
- - T3→T6 Control.inputType consumed by missingFields: Ruling: reader sets inputType = input type attr, 'textarea', 'select', or null.
- - T7→T8 act refs: Ruling: daemon keeps lastSnapshot per scenario (Jev's or look's); act resolves ref against it; refs = data-qa-ref marks from the latest snapshot.
- - T4→T12 doctor ping: JevClient has only decide(); Ruling: pingJev wired in bin via TypeSafeClient.systemOne with one noul question; error classification reused from jev-client (export classifyError).
- - T8→T13 command table: Ruling: bin/qa.ts exports COMMANDS and runs main() only when invoked directly (realpath compare), so tests can import it.
- Task 1: Ruling: runFolderName falls back to ' HH-MM-SS' when ' HH-MM' also exists — Review Focus 2 says never overwrite; plan only named HH-MM — cost if wrong: none (extra suffix only on same-minute reruns).
- Task 3: Ruling: control context is computed for every control with a card/row ancestor, then kept only when the control's name is duplicated — plan said "ancestor contains >1 control", which fails the shop case (each card has one button) — cost if wrong: a few extra tokens or a missed disambiguation.
- Task 3: Ruling: formatControl shows "(empty)" for empty text-like fields — helps Jev see what still needs filling; not in plan — cost if wrong: a few tokens.
- Task 4: Ruling: transient retries delegated to the SDK's retry policy (maxRetries 2, backoff 500 ms doubling → 500/1000 ms) instead of a custom 500/1500 loop — avoids retries stacking (SDK default would multiply ours); tests inject a fast policy instead of a sleep — cost if wrong: second backoff is 1000 ms not 1500 ms.
- Task 4: Ruling: SDK-side request validation errors (TypeSafeError, not sent) classify as 'request' — they are our bug, not an outage — cost if wrong: none.
- Task 4: Ruling: createScriptedClient also exposes `requests` for assertions; createTypeSafeClient accepts apiKey/retry/timeoutMs options for tests — cost if wrong: none.
- Task 5: Ruling: operation descriptions reworded (click "not for filling in a text field", type "fill in a text field with a value") — spike run 1 split click/type ~50/50 on text fields (conf 0.47) → run 2 0.97–0.98 — cost if wrong: none observed.
- Task 5: Ruling: JevAnswer gains opProbabilities; Task 6 evaluate() treats click/type on a text-like target as one intent (confidence p(click)+p(type), executes type) — safety net for the split seen in run 1 — cost if wrong: a click intended as a click on a text field becomes a type (harmless).
- Task 5: Ruling: press_enter needs no target; runner presses Enter on target, else last field typed in this step, else focused element — spike: correct op 0.93–0.99 but target none — cost if wrong: Enter goes to the wrong field → no_progress hand-back.
- Task 6: Ruling: step-quoted value used only when the step has a typing verb (type/enter/search/fill/input/write/set) and the quote isn't the field's own label — otherwise 'Fill the "Straße" field' would type "Straße" and 'Click "X"' quotes would leak into fields — cost if wrong: an intended value needs a scenario `values` entry or a takeover.
- Task 6: Ruling: `done` is exempt from risky/no-progress/budget rules (it takes no action) — cost if wrong: none.
- Task 6: Ruling: missingFields takes optional stepText so step-quoted values count as available — cost if wrong: none.
- Task 7: Ruling: ScenarioState extends the plan's fields with lastTypedRef, lastSnapshot, stepActionLog, hashBeforeLastAction/unchangedCount, handbacks, gaveUp, openError — needed by press_enter rule, act ref resolution, Jev's actions_so_far and no-progress detection — cost if wrong: none.
- Task 7: Ruling: a navigation ending on a non-http URL (chrome-error page) hands back as `error`, not `left_allowed_hosts` — it's a failed load, not leaving the site — cost if wrong: wrong reason label only.
- Task 7: Ruling: openScenario navigation failure is stored (openError) and returned by runJev as an `error` hand-back instead of throwing — keeps the daemon alive (Review Focus 4) — cost if wrong: none.
- Task 8: Ruling: budget test uses startDaemon({takeoverBudget: 2}) instead of 26 real acts — same code path, 10× faster — cost if wrong: none (default 25 comes from DEFAULTS, covered by config test).
- Task 8: Ruling: added a made-up-values daemon test (run-wide cache + per-scenario list) — spec §6.3 behavior had no test in the plan — cost if wrong: none.
- Task 8: Ruling: daemon writes daemon.log in the run folder and run.json atomically (tmp + rename); commands are serialised through one queue — cost if wrong: none.
- Task 8: Ruling: completed/gave-up scenarios close their browser context immediately (evidence already captured) — keeps memory flat on long suites — cost if wrong: no live page to inspect after completion.
- Task 9: Ruling: a 'met' key point with empty evidence → needs_review — spec requires evidence per point and ranks false pass worst; plan had no rule for it — cost if wrong: a few extra needs-review verdicts when the judge omits evidence.
- Task 11: Ruling: scenarios that never finished and didn't give up (not_started/handback/running) get needs_review with reason "not run" / "run did not finish (<status>)" rather than "judge output missing" — clearer to the reader — cost if wrong: none.
- Task 11: Ruling: added writeReport(runDir) helper used by the daemon's report command, plus a daemon-level report test — cost if wrong: none.
- Task 12: Ruling: Step 4b (manual `qa login` with a headed window) deferred to Task 14's acceptance run with the user — it needs a person to sign in and close the window — cost if wrong: login bug found later, at acceptance.
- Task 12: Ruling: doctor pingJev uses the SDK directly with retries off (one cheap noul call); doctor exits 1 but still prints the full check list when an error-level check fails — cost if wrong: none. Real run: all checks ok, ANTHROPIC_API_KEY warning shown.
- Task 13: Ruling: briefs use placeholders ({{QA}}, {{SCENARIO}}, {{RUN_RESULT}}, {{EVIDENCE}}) that the main session fills; the takeover brief includes the scenario YAML block so the agent sees all steps — cost if wrong: none.
- Task 14: Ruling: scenario-format.md gains a "quote text containing ': '" rule — acceptance YAML hit that parse error — cost if wrong: none.

## Fixed after the final review

- C1 judge verdict disagreeing with all-met points → needs_review — "all points met but the judge says fail" RED→GREEN
- C2 press_enter implicit form submit — riskyEnter: step must ask to search/enter/submit/send/press/go/find, and Enter into a form whose default submit is risky (Place order…) hands back — 3 tests RED→GREEN
- I11 submit-button clicks not asked for → risky_target (page-reader isSubmit + formSubmitLabel) — 2 tests + snapshot test RED→GREEN
- M2 risky check limited to click/press_enter — "Confirm email" typing test RED→GREEN
- I4 select/choose/pick steps use the quoted option — "select steps take the quoted option" RED→GREEN
- M4 whole-word label matching ("Name" no longer fills "Username") — "labels match on whole words only" RED→GREEN
- M5 host checked at the top of every Jev loop (start-page redirect, after Claude acts); base_url host always allowed; port-less entries match hostname — 2 runner tests + 1 scenarios test RED→GREEN
- M8 judge_model and session names validated in loadSuite — "judge_model and session names are validated" RED→GREEN
- I1 (runner part) in-page evaluates race a timeout; a stuck main frame → error hand-back — "page whose main thread is stuck" RED (hung) →GREEN
- I2 crash between actions → error hand-back (main-frame read failure, page 'crash' listener, completeScenario wrapped) — "a crashed page" RED→GREEN
- I3 openError reported once then cleared — "after a failed start page, Jev can resume" RED→GREEN
- M1 new_tab flag cleared on hand-back — "resume does not loop on the same flag" RED→GREEN
- I1 (daemon part) stop/report bypass the command queue; sendCommand has a timeout (110 s; stop 10 s) — "stop and report answer while another command is stuck" RED (hung) →GREEN
- I7 liveness = PID alive AND `ps` shows `qa.ts … daemon`; reused PIDs are stale and never signalled — "a reused PID is treated as stale and never signalled" RED→GREEN (live-daemon refusal test now uses a real daemon)
- I8 idle self-stop (30 min), start-deadline failure kills the child, daemon.json written atomically + parse retry — "an idle daemon stops itself", "a daemon that misses the start deadline is killed" RED→GREEN
- I9 `qa report` falls back to writing the report from the run folder when the daemon is gone; `qa report <runDir>` works after stop — "qa report works without a live daemon" RED→GREEN
- I10 (code part) Claude `act` refuses typing into password fields and goto outside allow_hosts — "Claude may not type into password fields or goto other hosts" RED→GREEN
- M10 queue `.catch` so a failed send can't poison the queue (no dedicated test — covered by the stuck-command test path)
- I5 a transcript with no usage after run start → available:false; rows show "Claude n/a" — tokens + report tests RED→GREEN
- I6 judge brief: login wall / blank / browser error page → unclear (only the site's own error page is not_met) — skill-files test RED→GREEN
- I10 (brief part) takeover brief: no submit/buy/delete unless asked; how to handle risky_target, left_allowed_hosts, new_tab — skill-files test RED→GREEN
- I12 SKILL.md: runner {"error"} → giveup + continue; "already active" → ask + stop; jev_unavailable stop includes the current scenario — skill-files test RED→GREEN

## Deferred minors

- M3 password fields don't show filled/empty state to Jev.
- M6 run.json copies scenario `values` (incl. test passwords from the user's own YAML) into the run folder.
- M7 a 429 that actually means quota exhaustion is treated as transient (takeovers instead of pause-and-ask).
- M9 `qa act` values starting with "-" are rejected by strict parseArgs.
- M11 report embeds each viewport image twice; gave-up-without-capture shows "not run"; which steps Claude did isn't surfaced; tooling vs judge-unclear needs-review rows look alike.
- M12 very short judge quotes ("Cart") pass the quote check trivially (C1 fix reduces the risk).
- M13 login temp file perms before chmod; test/.tmp leftovers; takeover model not configurable; same-second triple-run folder collision.
