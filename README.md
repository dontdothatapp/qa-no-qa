# Visual QA for Claude Code

Paste a QA checklist into [Claude Code](https://claude.com/claude-code), and Visual QA tests every check in your own Chrome, then hands you a report with a verdict and a screenshot for each one.
A fast navigator, **Jev** by [TypeSafe](https://docs.typesafe.ai), clicks through the pages; **Claude** takes over when Jev gets stuck, and judges every result.

## Install

You need a Mac, Claude Code, Google Chrome 144 or newer, and a TypeSafe account for the key. TypeSafe bills Jev's usage; the Claude part runs on your Claude subscription.

Paste this into Claude Code:

> Install Visual QA: if Node.js 22.18 or newer isn't installed, install it. Then run `claude plugin marketplace add dontdothatapp/qa-no-qa` and `claude plugin install visual-qa@qa-no-qa`, and tell me to type /reload-plugins and then /visual-qa:setup.

Claude runs the install. If your Mac needs Node.js and Claude can't install it for you, it asks you to run the installer from nodejs.org (it may ask for your Mac password). Then:

1. Type `/reload-plugins` (or restart Claude Code).
2. Type `/visual-qa:setup`. It checks what's missing and walks you through it, one thing at a time. You'll do two things yourself:
   - **Add your TypeSafe key.** Your TypeSafe key page opens in the browser, and a small key file opens in TextEdit. Copy the key, paste it after `TYPESAFE_API_KEY=`, save, and tell Claude you're done. Never paste the key into the chat.
   - **Switch on remote debugging in Chrome.** A Chrome page opens with a remote-debugging switch near the top. Switch it on. This lets tests open tabs in your Chrome. You only do this once.

You can run `/visual-qa:setup` again any time. To get updates automatically: type `/plugin`, open Marketplaces, choose qa-no-qa and turn on auto-update.

## Use

Type `/visual-qa:test` and paste your checklist as it is: bullets, ☐ boxes, sections, notes. Include the site's address. For example:

```text
Tests on https://staging.example.com. I'm signed in as a test customer; the "new checkout" flag is ON.
☐ Product page shows the price and an "Add to cart" button
☐ Adding two items → the cart badge shows 2
☐ Checkout shows my saved address; a new address can be saved
☐ Promo code SAVE10 takes 10% off the total
Flag OFF
☐ Checkout shows the old one-page form
☐ Signed out: opening checkout asks you to sign in
```

Claude tells the checks apart from background notes, works out how to test each line, and finds the right pages on its own. It asks questions only when neither your checklist nor the site can answer them, such as which account to use, or a link to a record no page shows. All questions come in one message. Then it says something like "Running 6 checks in 2 groups" and starts.

You don't have to type the slash command. "Test this on staging.example.com", followed by your checklist, works too.

## During a run

- **Click Allow.** When a run starts, Chrome asks whether to allow the connection. Click **Allow**. This usually happens once per run.
- **Test tabs come to the front.** Each check opens a new tab in your Chrome, in front of your own tabs, signed in as you are. The tab closes when the check is done. Don't type in Chrome until the run finishes. Signed-out checks run in a separate signed-out Chrome window that closes by itself.
- **Pauses between groups.** Checks are grouped by the setup they need, for example the feature flag on or off, or which account is signed in. Between groups, the run pauses and tells you what to change. Make the change, then say **go**. Say **skip** to leave that group out, or **stop** to end the run there.
- **A report at every pause.** Each pause writes the report so far, so you have results even if you stop.
- **Continue later.** You can leave a run paused and pick it up in a new chat: type `/visual-qa:test continue`, or say "continue my last QA run". It runs only the checks that were left, as a new report that links back to the first one.

If a pause lasts a long time, Chrome may ask you to click **Allow** again.

## The report

When the run ends, Claude posts a short summary with a link to the report. Each run gets its own folder in `~/QA/`, named by date and topic. Its `report.html` is a single file with the screenshots built in, so you can send it to someone as it is.

Every check ends as one of:

- **PASS**: the page shows what the check expects.
- **FAIL**: it doesn't.
- **NEEDS REVIEW**: the tool can't vouch for the result. For example, it couldn't confirm the test ran on the right page, it hit a sign-in wall or bot protection, or its judgement didn't match its own evidence. Look at the screenshot and decide.
- **NOT RUN**: skipped at a pause, not reached, or something no page can show (an email, a background job).

A check is never counted as passed on a guess.

Each row shows your original checklist line, then how it was tested: the steps, and the result Claude expected. A vague line such as "can save" gets a concrete reading, and the row shows which one. Next to it are the verdict, the reason with quotes from the page, and a screenshot you can click to enlarge.

**Ran on the right page?** lists what the check depends on, such as "the listing is in France", and whether the page confirmed it. If any of these can't be confirmed, the check is NEEDS REVIEW, even if everything else looks right: a pass on the wrong page proves nothing.

Your pasted checklist is at the top of the report, and Jev and Claude usage is at the bottom.

## Privacy and safety

- While tests run, page text is sent to TypeSafe (Jev's provider) so Jev can choose the next step. That includes text from pages you're signed in to.
- Your TypeSafe key stays in a file on your Mac, `~/.visual-qa/.env`. Setup opens it in TextEdit for you, so the key never goes through the chat (chats are saved).
- Tests act in your real accounts. They don't submit, buy or delete anything unless a check asks for it, and they stay on the site you're testing.
- The tool never types passwords. Password fields stay empty, and signed-in checks use the sign-ins already in your Chrome. Leave passwords out of your checklist.
- The tool only touches tabs and windows it opened. It never signs you out, and never closes Chrome.
- **Bot protection is not bypassed.** When a site's reCAPTCHA, captcha or similar check refuses a request, the check stops as NEEDS REVIEW and the report shows the refusal. To test such flows, use an environment where the protection is off, or where it uses test keys.

## For developers

```bash
git clone https://github.com/dontdothatapp/qa-no-qa.git
cd qa-no-qa/visual-qa
npm ci
npx playwright install chromium   # only for the test suite
npm test                          # unit and browser tests against a local fixture site
npm run typecheck
```

To try your working copy as a plugin, run `claude plugin marketplace add ./` from the repo root, then `claude plugin install visual-qa@qa-no-qa`. A local marketplace copies the working tree as it is, including `node_modules`.

Claude turns a pasted checklist into an internal YAML scenario file in `~/QA/scenarios/`. The format is in [visual-qa/reference/scenario-format.md](visual-qa/reference/scenario-format.md). `/visual-qa:test path/to/file.yaml` runs a scenario file directly.

- `.claude-plugin/marketplace.json`: the `qa-no-qa` marketplace.
- `visual-qa/`: the `visual-qa` plugin.
  - `skills/test/SKILL.md` and `skills/setup/SKILL.md`: what Claude follows for `/visual-qa:test` and `/visual-qa:setup`.
  - `reference/`: briefs for intake (checklist to tests), takeovers and the judge, and the scenario format.
  - `bin/`: the `qa.ts` runner command and `setup.ts`.
  - `src/`: the runner, a small local daemon that drives Chrome with Playwright, asks Jev for each next action, collects evidence and writes the report.
  - `test/`: unit and browser tests; `test/acceptance/fixture-suite.yaml` is the live acceptance suite.
- `docs/superpowers/`: design specs, implementation plans and build notes.
- `reports/`, `research_notes/`: the research the design started from.

## License

[MIT](LICENSE)
