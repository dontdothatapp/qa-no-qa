# Visual QA for Claude Code

A [Claude Code](https://claude.com/claude-code) skill that runs plain-language browser test scenarios and gives you an HTML report with a verdict and a screenshot for each one.

You describe what to test ("open the shop → add the backpack to the cart → the cart shows 1 item"). A fast navigator model, **Jev** by [TypeSafe](https://docs.typesafe.ai), clicks through the steps in a real browser. **Claude** takes over whenever Jev gets stuck, then judges every result from its screenshot and page text.

```
scenarios (YAML or plain words)
   → Jev drives the browser, step by step      (fast, cheap)
   → Claude takes over when Jev is unsure      (only when needed)
   → Claude judges each result                 (screenshots + page text)
   → ~/QA/<date> <topic>/report.html           (verdicts, inline screenshots, token usage)
```

Each scenario ends as **PASS**, **FAIL** or **NEEDS REVIEW**. NEEDS REVIEW covers anything the tool cannot vouch for: a sign-in wall, bot protection such as reCAPTCHA, or a judgement that doesn't match its own evidence. A test is never counted as passed on a guess.

## Requirements

- macOS (the only platform tested)
- [Claude Code](https://claude.com/claude-code). The Claude part runs on your Claude subscription.
- Node.js 22.18 or newer
- A TypeSafe API key for Jev. TypeSafe bills Jev usage.
- Google Chrome 144 or newer, if you want tests to run in your own signed-in Chrome

## Setup

```bash
git clone https://github.com/dontdothatapp/qa-no-qa.git ~/Projects/qa-no-qa
cd ~/Projects/qa-no-qa/visual-qa
npm ci
npx playwright install chromium
```

Register the skill with Claude Code:

```bash
mkdir -p ~/.claude/skills
ln -s ~/Projects/qa-no-qa/visual-qa ~/.claude/skills/visual-qa
```

Add your TypeSafe key to `~/.visual-qa/.env`, or to `.visual-qa/.env` in the repo root. The repo's `.gitignore` excludes `.visual-qa/`.

```
TYPESAFE_API_KEY=your-key-here
```

Check the setup:

```bash
node ~/.claude/skills/visual-qa/bin/qa.ts doctor
```

Every check should report `"ok":true`. Warnings don't stop a run.

To test in your own Chrome, open `chrome://inspect/#remote-debugging` in Chrome and switch remote debugging on. Chrome asks you to **Allow** the connection when a run starts.

## Usage

Start a new Claude Code session and run:

```
/visual-qa path/to/scenarios.yaml
```

Or run `/visual-qa` and describe the scenarios in plain words. Claude drafts the YAML file, saves it to `~/QA/scenarios/`, shows it to you, and waits for your OK before running it.

A scenario file:

```yaml
topic: Checkout flow
base_url: https://staging.example.com
browser: isolated            # isolated = fresh browser, logged out (default: chrome = your own Chrome)
scenarios:
  - id: CO-01
    title: Guest can reach the payment step
    start: /products/backpack
    steps:
      - Click "Add to cart"
      - Open the cart and click "Checkout"
      - Fill the shipping form
      - Click "Continue"
    values:
      Full name: Test User
      Postcode: "10115"
    expected: 'Payment form is visible; order summary shows "1 item"'
```

The full format and tips for writing good scenarios are in [visual-qa/reference/scenario-format.md](visual-qa/reference/scenario-format.md).

**Browser modes**
- `chrome` (the default): scenarios run as new tabs in your running Chrome, using your existing sign-ins. The tool only touches tabs it opened, and never closes Chrome.
- `isolated`: every scenario starts in a fresh, invisible Chromium. To test a signed-in flow, save a login once and point the scenario's `session:` at it:
  ```bash
  node ~/.claude/skills/visual-qa/bin/qa.ts login staging-user https://staging.example.com/login
  ```
  A browser window opens. Sign in, then close the window. The login is saved to `~/.visual-qa/sessions/`.

**Output:** each run gets a folder `~/QA/<YYYY-MM-DD> <topic>/`. Its `report.html` is self-contained, with screenshots embedded in the page, so you can send it as a single file. The folder also holds the raw evidence: full-page screenshots, page text, an event log, and Jev and Claude token usage.

## Privacy and safety

- While scenarios run, page text is sent to TypeSafe so Jev can choose the next action. In Chrome mode that includes text from pages you're signed in to.
- The tool never types passwords. Password fields stay empty, and scenario files that contain passwords are rejected. Signed-in flows use your Chrome or a saved login instead.
- The tool doesn't submit, buy or delete anything unless a step explicitly asks for it. It also stays on the hosts you allow (`allow_hosts`, which defaults to the `base_url` host).
- **Bot protection is not bypassed.** When a site's reCAPTCHA, captcha or similar check refuses a request, the scenario stops as NEEDS REVIEW and the report shows the refusal. To test such flows, use an environment where the protection is off, or where it uses test keys.

## Development

```bash
cd visual-qa
npm test            # unit and browser tests against a local fixture site
npm run typecheck
```

- `visual-qa/SKILL.md`: the checklist Claude follows during a run.
- `visual-qa/reference/`: briefs for the takeover and judge agents, and the scenario format.
- `visual-qa/src/`: the runner, a small local daemon that drives Playwright, asks Jev for each next action, collects evidence and writes the report.
- `docs/superpowers/`: the design spec, implementation plans and build notes.
- `reports/`, `research_notes/`: the research the design started from.

## License

[MIT](LICENSE)
