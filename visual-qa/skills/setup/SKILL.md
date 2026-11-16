---
name: setup
description: Set up Visual QA — checks Node, the runner's packages, the TypeSafe key and Chrome's remote-debugging switch, and walks the person through anything missing.
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/bin/setup.ts *) Bash(node --version)
---

# Visual QA: setup

Get Visual QA ready to use, one item at a time. Safe to re-run. The person is usually a PM or designer: tell them only what they have to do, in one or two plain lines, and never ask them to run a command.

Setup command: `node ${CLAUDE_PLUGIN_ROOT}/bin/setup.ts`. Run it in exactly that form, so it is pre-approved. It prints one JSON object.

## 1. Node.js

Run `node --version`. If it is missing or below v22.18, install Node:
- `brew` is installed → run `brew install node` (or `brew upgrade node`).
- Otherwise → ask them to download the macOS installer from https://nodejs.org (the LTS button), open it, finish the installer (it may ask for their Mac password), and tell you when done.

Then run `node --version` again.

## 2. Check, fix, repeat

Run `node ${CLAUDE_PLUGIN_ROOT}/bin/setup.ts --check`. While `next` is set:
1. Tell the person what to do, from `next.fix`, in one or two lines, and do what `next.name`'s entry below says. For a name not listed, run `next.command` if there is one.
2. When the fix is theirs, wait until they say done.
3. Run `--check` again.

Stop and tell the person plainly what is still wrong when a command fails (it prints `{"error"` or no JSON), or when the same item comes back with the same `detail` after its fix. They can run setup again later.

Items:
- **packages** → run `next.command` (it runs `npm ci --omit=dev` in `${CLAUDE_PLUGIN_ROOT}`; about a minute, so give it a long timeout), then re-check.
- **typesafe_key** with `next.command` set → run `node ${CLAUDE_PLUGIN_ROOT}/bin/setup.ts --open-key-file`. It opens TypeSafe's key page in their browser and the key file in TextEdit. Say: "Copy your key from the TypeSafe page, paste it right after `TYPESAFE_API_KEY=`, on the same line, in the TextEdit window, save, and tell me when done."
  - `next.command` is null → TypeSafe couldn't be reached just now. Tell them to check their internet connection and run setup again later, and stop.
  - Never ask for the key in chat, and never read or print the key file yourself; only `--open-key-file` opens it, for them.
  - If they paste the key into chat anyway, do not repeat it back. Ask them to put it in the file instead.
  - The re-check tests the key. If TypeSafe did not accept it, the next fix says so; run `--open-key-file` again.
- **chrome** → if `next.command` is set, run `node ${CLAUDE_PLUGIN_ROOT}/bin/setup.ts --open-chrome`, tell them to switch on remote debugging (the toggle near the top of the page that opened), then run `node ${CLAUDE_PLUGIN_ROOT}/bin/setup.ts --wait-chrome 110`.
  - `"opened":false` → ask them to paste the `address` it printed into Chrome's address bar.
  - `"on":false` → it waited about 2 minutes; remind them of the toggle and ask them to say done.
  - No `next.command` (Chrome missing or too old) → tell them `next.fix` and wait.
- **node** → step 1.

## 3. Done

When `ok` is true:
- Pass on each line of `notes` (what is sent where while tests run, and how to turn on updates), in plain words.
- If the `anthropic_api_key` item is not ok, add one line: Claude Code may be billing the API instead of their subscription; `/status` shows which.
- Say they can now type `/visual-qa:test` and paste a checklist.
