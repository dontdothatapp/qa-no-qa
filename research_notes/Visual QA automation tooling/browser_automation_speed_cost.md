# Browser Automation for Natural-Language QA Scenarios: Speed and Cost (as of Nov 2026)

Scope note: research done 2026-11-15. Many figures come from vendors (Browser Use, Skyvern, Stagehand/Browserbase) or from secondary blogs that repeat each other's numbers. Every bullet says whether a number is vendor marketing, a third-party blog, or official docs. Model names such as "GPT-6 Luna", "Claude Fable 5.x" and "Claude Haiku 5.5" appear as written in the Nov 2026 sources.

## 1. Pure LLM-agent approaches (Claude computer use / Claude browser use tool / Claude in Chrome / Playwright MCP): tokens, time and cost per step

### Takeaway
A screenshot step on current Claude models costs about 1,300 to 2,700 visual tokens per image, plus a fixed 4.5k to 6.6k token toolset overhead on every request. History is resent each turn, so a 10-step screenshot-driven scenario comes to roughly 100k to 150k input tokens before caching (about $0.30 on Sonnet 5.5, or about $0.10 with prompt caching). Accessibility-tree tools that write snapshots to disk and return short refs now cost far less per step. The older finding of "Playwright MCP burns 114k tokens" was largely fixed in MCP releases from mid-2026.

### Cited Findings
**Official Anthropic token mechanics**
- Image cost formula: `⌈width/28⌉ × ⌈height/28⌉` visual tokens (28×28-px patches). — [Anthropic Vision docs](https://platform.claude.com/docs/en/build-with-claude/vision)
- Resolution tiers: "High-resolution" tier (Claude 4.7 and later) has a max long edge of 2,576 px and max 4,784 visual tokens. The "Standard" tier (all other models) has a max of 1,568 px and 1,568 tokens. — [Anthropic Vision docs](https://platform.claude.com/docs/en/build-with-claude/vision)
- Example costs: a 1920×1080 screenshot is 2,691 tokens on the high-res tier (not resized), or 1,560 tokens on the standard tier (downsized to 1456×819). A 1000×1000 image is 1,296 tokens on both. Anthropic's worked example: a 1000×1000 image costs about $1.30 per thousand images on Haiku 4.5 and about $5.18 per thousand on Opus 5.5 (high-res). — [Anthropic Vision docs](https://platform.claude.com/docs/en/build-with-claude/vision)
- High-res images "can use up to roughly three times more visual tokens than the same image on a standard-tier model". The docs recommend downsampling when the extra fidelity isn't needed. For the computer use and browser use toolsets, the API rejects (does not downscale) oversized `tool_result` screenshots, so the app must resize them. — [Anthropic Vision docs](https://platform.claude.com/docs/en/build-with-claude/vision)
- Requests with more than 20 images have a stricter per-image size limit, and screenshots from earlier turns that are resent count toward that 20. This matters for long screenshot loops. — [Anthropic Vision docs](https://platform.claude.com/docs/en/build-with-claude/vision)
- Computer use toolset overhead: declaring `computer_toolset_20260801` adds about 4,500 input tokens per request (about 4,590 on Sonnet 5, about 4,520 on other models). Disabling `zoom` saves about 410. The older `computer_20250124`/`computer_20251124` versions add 466–499 system-prompt tokens plus about 735 tokens per tool definition. — [Anthropic Pricing docs](https://platform.claude.com/docs/en/about-claude/pricing)
- Browser use toolset overhead: declaring `browser_toolset_20260801` adds about 6,600 input tokens (about 6,670 on Sonnet 5, about 6,610 on others). Enabling all four optional members adds about 880. — [Anthropic Pricing docs](https://platform.claude.com/docs/en/about-claude/pricing)
- The Claude API browser use tool (`browser_toolset_20260801`) has 27 member tools by default plus 4 optional ones. Among them are `navigate`, `screenshot`, `zoom`, clicks/typing, `read_page` (accessibility tree with refs), `find` (natural-language element search, up to 20 matches), `get_page_text`, `form_input` and tabs. The app executes every call, and nothing runs on Anthropic's side. — [Anthropic Browser use tool docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/browser-use-tool)
- Anthropic's own token guidance for that tool: "a tree read of a typical page often costs fewer input tokens than a screenshot while giving Claude references it can act on immediately." Screenshots "remain the right observation when visual layout, images, or rendering state matter". You don't need a screenshot after every action, and Claude can batch several actions (click, type, key) in one turn. `read_page` output is capped at 50,000 characters. — [Anthropic Browser use tool docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/browser-use-tool)
- The browser use tool docs give no latency numbers and no model recommendation for speed or cost. — [Anthropic Browser use tool docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/browser-use-tool)

**Measured or claimed per-task speed for Claude-driven loops (mostly older or vendor-measured)**
- Browser Use (vendor, Oct 9, 2025, so pre-2026 models): average time per Online-Mind2Web task was Claude Sonnet 4.5 at 285 s, Claude Sonnet 4 at 295 s, Gemini 2.5 Computer Use at 225 s, OpenAI CUA at 330 s, and BU 1.0 at 68 s. BU 1.0 averages "3 seconds per step". "Each screenshot adds about 0.8 seconds to LLM inference latency". Output tokens cost "~215x more time" than input tokens (on their infra, 1,000 input tokens took 29.1 ms and 10 output tokens took 62.6 ms). — [Browser Use "Speed Matters"](https://browser-use.com/posts/speed-matters)
- A third-party guide says AI-driven actions cost "LLM latency (typically 2-5 seconds)" per action. — [Search summary of Stagehand guides, e.g. qaskills.sh](https://qaskills.sh/blog/stagehand-ai-browser-automation-guide-2026) (third-party, not a benchmark)

**Playwright MCP vs Playwright CLI vs agent-browser token usage**
- Widely repeated older numbers: a 10-step automation used about 114,000 tokens with Playwright MCP vs about 27,000 with Playwright CLI. A single page snapshot was about 15,000 vs about 200. A test flow with screenshots was about 150,000 vs about 5,000. The heyuan110 post attributes these to TestCollab/SupaTest and gives no methodology. — [heyuan110 "5 Tools Compared" (Jan 28, 2026)](https://www.heyuan110.com/posts/ai/2026-01-28-claude-code-browser-automation/)
- The same post claims agent-browser cut a 10-step workflow from about 100,000 to about 7,000 tokens ("93% reduction"), and on one task listed about 50,000 for DevTools MCP. No source or methodology is given. It reports no timing numbers. — [heyuan110](https://www.heyuan110.com/posts/ai/2026-01-28-claude-code-browser-automation/)
- **Contradicting newer measurement (July 24, 2026):** on `@playwright/mcp@0.0.78` vs `@playwright/cli@0.1.17`, a 7-step login → dashboard flow returned about 3,580 characters into context (MCP) vs about 3,620 (CLI), "within ~1% of each other, step for step". Current MCP "writes the snapshot to disk and returns a file path, as the CLI does". A navigate on a 300-row page returned a ~230-character path, while the full accessibility tree was about 97,000 characters. A scoped `find` returned about 450 chars. Fixed overhead was MCP's ~24 tool definitions at about 18k chars vs the CLI skill file at about 12.6k chars. No timing measured. — [DEV Community, Aswani Kumar (updated Jul 24, 2026)](https://dev.to/aswani25/playwright-cli-vs-playwright-mcp-which-should-you-use-with-claude-code-1olh)
- Playwright CLI README: "Token-efficient. Does not force page data into LLM." It avoids "loading large tool schemas and verbose accessibility trees into the model context". Snapshots are saved as YAML files. `find <text>` returns matching nodes with 3 lines of context. Elements are targeted by ref (`click e15`). The README gives no numeric benchmark. `npx playwright cli` needs Playwright 1.59 or later. — [microsoft/playwright-cli README](https://github.com/microsoft/playwright-cli)
- agent-browser (Vercel Labs) README: a native Rust CLI plus a background daemon over CDP. `snapshot -i` gives a compact list of interactive elements with `@e1`-style refs. A click fails loudly if the target is hidden or covered. It ships an MCP mode and a "skills" loader. The README makes no token-usage or speed claims (repo had 51.4k stars at fetch time). — [vercel-labs/agent-browser](https://github.com/vercel-labs/agent-browser)
- dev-browser (SawyerHood Claude skill): one report puts it at 3m53s and $0.88 vs Playwright MCP at 4m31s and $1.45 (29 vs 51 iterations, 100% success for both) on the author's game-tracker benchmark. SourcePulse cites a smaller gap (14% faster, 39% fewer turns). These are author-maintained single-task evals, and the eval repo README shows no results table. — [dev.to "Browser Tools for AI Agents Part 1"](https://dev.to/stevengonsalvez/browser-tools-for-ai-agents-part-1-playwright-puppeteer-and-why-your-agent-picked-playwright-k71) (figures via search summary, not directly verified); [SourcePulse](https://www.sourcepulse.org/projects/20491810); [dev-browser-eval repo](https://github.com/SawyerHood/dev-browser-eval)

### Inferences
- **Worked estimate (my calculation, not a source):** take a 10-step scenario with one 1280×800 screenshot per step. That is ⌈1280/28⌉×⌈800/28⌉ = 46×29 = 1,334 visual tokens on 4.7+ models. Add about 4,500 toolset tokens, about 1,000 prompt tokens and about 300 text tokens per step, with the full history resent each turn. Total input is about 145k tokens and output about 3k.
  - Without caching that costs about $0.32 on Sonnet 5.5, $0.64 on Opus 5.5 and $0.016 on Haiku 5.5.
  - With prompt caching, cache reads cost 0.05x on Sonnet/Opus 5.5 and new content is written at 1.25x. Sonnet 5.5 then drops to about $0.10 per scenario.
  - Latency: at about 3–5 s per LLM turn, plus about 0.8 s extra per screenshot, a 10-step scenario takes roughly 30–60 s of wall-clock before any browser waits.
- In a screenshot loop, the history resend dominates cost, not the single new screenshot. Dropping old screenshots from history (keep only the latest one or two) and using refs instead of coordinates cuts cost more than switching tools does.
- The July 2026 re-test suggests the "MCP is 4x worse" result is mostly obsolete for current @playwright/mcp. The remaining differences are fixed tool-schema overhead (about 18k vs 12.6k chars) and whether the agent has filesystem access.
- For a Claude Code skill, the per-step cost of Claude reasoning in the main session (big system prompt plus conversation) likely dwarfs the tool's own token cost. Delegating to a cheap subagent or model, or not using an LLM per step at all, matters more than choosing between MCP and CLI.

### Gaps
- I found no independent, recent (2026-model) benchmark of per-step latency for Claude computer use or the browser use tool. The newest latency comparison that includes Claude is Browser Use's Oct 2025 post, which used Sonnet 4/4.5.
- No published numbers for Claude in Chrome speed or token use per step.
- The heyuan110 and "TestCollab/SupaTest" figures have no methodology, and I could not locate their original sources.

## 2. Faster/cheaper agent frameworks (Browser Use, Stagehand, Skyvern, agent-browser, dev-browser, Playwright CLI, Midscene): how they work, speed/cost claims, caching and self-healing

### Takeaway
The cheapest live-agent option is a DOM-first agent running a small or fast model. Browser Use's vendor-measured median is 22 s and $0.0064 per task for its Ultrafast tier. The biggest structural saving comes from frameworks that cache or compile actions. Stagehand (`cacheDir`), Skyvern (`run_with="code"`) and Midscene (cache) replay recorded actions with no LLM call and fall back to the LLM when the page changes. CLI tools like agent-browser, Playwright CLI and dev-browser reduce context but still call the LLM on every step.

### Cited Findings
**Browser Use**
- BU 2.0 (Jan 27, 2026 changelog): 83.3% accuracy with a 62 s average task duration, vs 74.7% and 58 s for BU 1.0. Token price $0.60/1M input, $0.06/1M cached, $3.50/1M output. Vendor-measured. — [Browser Use changelog, BU 2.0](https://browser-use.com/changelog/27-1-2026)
- BU Ultrafast (Oct 31, 2026): median task 22 s and $0.0064, vs 79 s and $0.0098 for the default GPT-6 Luna agent. It was faster and cheaper on all 8 projects with 20+ runs on both agents. It runs GPT-6 Luna on OpenAI's priority tier, so tokens bill at 2x standard rates. Cost covers model plus search, with browser and proxy billed separately. Sample: 12,238 runs across 134 projects (Oct 16–29, 2026). No accuracy reported. Vendor-measured on customer traffic. — [Browser Use "BU Ultrafast is live"](https://browser-use.com/posts/bu-ultrafast-is-live)
- Speed techniques: KV-cache-friendly prompt ordering (history before browser state), DOM-first navigation with screenshots only when needed, a separate `extract` LLM call on DOM markdown, and actions of about 10–15 output tokens. — [Browser Use "Speed Matters" (Oct 2025)](https://browser-use.com/posts/speed-matters)
- Cloud pricing per a third-party review (Nov 2026): about $0.02 per browser-hour, agent steps from $0.006, and about $0.01 per task. — [WTF Radar review](https://wetheflywheel.com/en/radar/browser-use-review/) (third-party, so check the vendor pricing page)

**Stagehand (Browserbase)**
- Local cache: "When you specify a `cacheDir`, Stagehand saves every action and agent step to a local file on first run, then replays those cached actions on subsequent runs." It works in LOCAL and BROWSERBASE environments, and cache files can be committed to version control for CI. It covers `act()` and agent steps, including Computer Use Agent actions. The agent-cache key is instruction + start URL + execution options + agent config. — [Stagehand docs: Caching](https://docs.stagehand.dev/v3/best-practices/caching)
- Server cache (Browserbase): the key is instruction + page content + options. "Repeated calls with the same inputs return instantly without consuming any LLM tokens." `act()` returns `cacheStatus` HIT or MISS. You enable it by emailing Browserbase support. It only works with `env: "BROWSERBASE"`. — [Stagehand docs: Caching](https://docs.stagehand.dev/v3/best-practices/caching)
- Self-healing: with the server cache, if page content or structure changes there is no HIT and the LLM is called again, then later calls hit the new entry. With the local cache, the docs say to clear the cache directory manually after significant DOM changes. The docs give no numbers for cost or latency savings. — [Stagehand docs: Caching](https://docs.stagehand.dev/v3/best-practices/caching)
- A third-party comparison flags reported issue #1767, about silent server-cache failures for extract/act/observe. Unverified. — [bug0 "Expect vs Agent-Browser vs Stagehand vs Passmark"](https://bug0.com/blog/expect-vs-agent-browser-vs-stagehand-vs-passmark)
- Stagehand docs exist for v3 and v4 (`/v4/basics/act`, `/v4/basics/observe`), so v4 is current as of late 2026. — [Stagehand v4 Act docs](https://docs.stagehand.dev/v4/basics/act)

**Skyvern**
- Code caching: after a successful agent run, Skyvern generates code "from the actions it took". Later runs execute that code instead of asking the model each step, which "makes them faster and cheaper". You set it with `run_with="code"` or `"agent"`. "AI Fallback (cached scripts)" is on by default: if cached code fails, Skyvern falls back to the agent and regenerates the code. The docs give no numbers. — [Skyvern docs: Code caching](https://www.skyvern.com/docs/developers/features/code-caching.md)
- A Clear Cached Scripts API was added in v1.0.17 (Feb 19, 2026), and code caching requires `engine="skyvern-2.0"`. — [Skyvern changelog](https://docs-new.skyvern.com/changelog) (via search summary)
- Vendor marketing claims repeat runs are "3–5× faster, up to 70% cheaper, fully deterministic". — [Skyvern products page](https://www.skyvern.com/md/products.md) (via search summary)
- TinyFish (Apr 8, 2026) cites Skyvern compiled runs at $0.11 → $0.04 per run and 279 s → 120 s. The original measurement source isn't specified. — [TinyFish "Compile to Code"](https://current.tinyfish.ai/issue/24/practitioners-corner/article/12828/compile-to-code-the-pattern-that-turns-agent)

**Midscene.js (ByteDance web-infra-dev)**
- Vision-driven (VLM). It supports Qwen-VL and UI-TARS models and has a cache option with a configurable directory for replay. Official docs say each planning/query step calls the AI, so runtime can be several times longer than plain Playwright. Image resolution and UI context size drive token cost. The v1.0 changelog added per-model token-usage summaries in reports. — [Midscene API docs](https://midscenejs.com/api); [Midscene v1 changelog](https://v1.midscenejs.com/zh/changelog) (via search summary)
- The older v0 model-selection guide says UI-TARS can produce non-deterministic action paths and is weaker on assertions than GPT-4o or Qwen 2.5. This is a 2025-era doc. — [Midscene v0 "Choose a model"](https://v0.midscenejs.com/choose-a-model)
- A single secondary report claims Qwen-2.5-VL cut input tokens 35% and per-run cost 89% vs GPT-4o. Unverified and older. — [besthub.dev](https://besthub.dev/articles/midscene-js-integrates-qwen-2-5-vl-model-cost-effective-high-resolution-ui-automation-d65ccb680fe1)

**agent-browser, Playwright CLI, dev-browser**
- agent-browser: daemon plus CLI, with compact ref snapshots, `record` and `diff` commands (undocumented on the README), and session persistence. No caching or replay of LLM decisions is described. — [vercel-labs/agent-browser](https://github.com/vercel-labs/agent-browser)
- Playwright CLI: `recording-start`/`recording-stop` "print actions as Playwright code". `generate-locator <ref>` produces a stable Playwright locator. A reference guide covers "Test generation (plan / generate / heal)". — [microsoft/playwright-cli](https://github.com/microsoft/playwright-cli)
- dev-browser: a Claude skill/plugin. The author's eval is discussed in section 1. The dev.to author notes it isn't meant to replace Playwright for CI/regression. — [dev.to Part 1](https://dev.to/stevengonsalvez/browser-tools-for-ai-agents-part-1-playwright-puppeteer-and-why-your-agent-picked-playwright-k71) (via search summary)

### Inferences
- For "LLM only on first run or when something breaks", these do it natively: Stagehand `cacheDir`, Skyvern code caching with AI fallback, and Midscene cache. Playwright CLI (`recording-stop` → Playwright code, `generate-locator`) and Playwright Test Agents give the raw pieces to build it yourself in a Claude Code skill.
- Stagehand's local cache doesn't detect staleness on its own. Its docs say to clear it manually, so a wrapper should catch replay failures and re-run the LLM step.
- Browser Use Ultrafast's $0.0064 per task suggests a fast small model plus DOM state can make live agent runs nearly free in dollars. Even so, 22 s per task is slow next to a deterministic replay that takes seconds.

### Gaps
- No independent benchmark of Stagehand cache hit rates or savings, and the Browserbase blog post referenced by the docs wasn't retrieved.
- No published numbers for how often Skyvern's or Stagehand's cached replays fall back to the LLM in practice.
- I did not find newer 2025–2026 tools beyond those listed (e.g., "Passmark" and "Expect" appear in a bug0 comparison) with hard numbers.

## 3. "Compile once, replay deterministically" (LLM writes a Playwright script once, LLM invoked only on failure)

### Takeaway
This is now mainstream. Playwright ships Planner/Generator/Healer agent definitions (since v1.56). Skyvern and Stagehand cache or compile agent runs. Commercial tools (Checksum, Octomind, QA Wolf, Momentic) generate or maintain tests and self-heal. Hard public data on how well healing works (heal success rate, false "passes") is basically absent, and Playwright's healer can mark a test as skipped when it decides the feature is broken. A QA tool must treat that as a failure signal, not hide it.

### Cited Findings
- Playwright Test Agents: the Planner explores the app and writes a Markdown plan under `specs/` (inputs are a request, a seed test, and an optional PRD). The Generator turns the plan into Playwright Test files under `tests/` and "verifies selectors and assertions live as it performs the scenarios". The Healer runs a failing test, replays the failing steps, inspects the current UI, patches, and re-runs "until it passes or until guardrails stop the loop". Its output is a passing test, or "a skipped test if the healer believes the functionality is broken". Setup is `npx playwright init-agents --loop=<vscode|claude|codex|opencode>`, and definitions should be regenerated on Playwright updates. The docs make no accuracy, speed or cost claims. — [playwright.dev Test Agents](https://playwright.dev/docs/test-agents)
- The agents were introduced in Playwright 1.56.0. For Claude Code, `init-agents` creates `.claude/agents/` definitions plus an `.mcp.json` entry. They are role definitions for a coding-agent loop, not something that runs inside `npx playwright test`. — [newreleases.io Playwright 1.56.0](https://newreleases.io/project/npm/playwright/release/1.56.0); [TestDino guide](https://testdino.com/blog/playwright-test-agents/) (secondary)
- The 1.59 release notes reportedly added `npx playwright test --debug=cli` for attaching a CLI agent to a paused test. Secondary and unverified. — [TestDino 2026 release summary](https://testdino.com/blog/playwright-2026-new-features/)
- TinyFish (Apr 2026) describes the pattern as "Think expensive thoughts exactly once": agent explores once, compiles to deterministic Playwright, and repairs using intent metadata when the site changes. Its "$0.50 per LLM-in-the-loop execution becomes $50,000 a month at scale" is an illustrative extrapolation. It reports no replay or heal success rates. — [TinyFish "Compile to Code"](https://current.tinyfish.ai/issue/24/practitioners-corner/article/12828/compile-to-code-the-pattern-that-turns-agent)
- Skyvern: run with code plus "AI Fallback" (on by default) regenerates the code on failure. — [Skyvern docs](https://www.skyvern.com/docs/developers/features/code-caching.md)
- Stagehand: `cacheDir` replays recorded actions. The server cache re-invokes the LLM on a cache miss when the page changes. — [Stagehand docs](https://docs.stagehand.dev/v3/best-practices/caching)
- Commercial landscape (third-party roundups, possibly promotional):
  - Checksum's agents generate Playwright from repo analysis, app scanning and optional session recording. Pricing is sales-led, and "healed" in its results means the agent edited the test.
  - Momentic uses intent-based steps stored in its own proprietary format.
  - QA Wolf is a managed service (AI plus human QA engineers) delivering Playwright/Appium code, quoted at "$60K+/year".
  - Octomind generated exportable standard Playwright (Basic $89/mo for 80 test cases and 240 cloud runs in older listings). One source says Octomind announced a shutdown in April 2026, which conflicts with other listings.
  — [Kanopy Labs: Meticulous vs Momentic vs QA Wolf](https://kanopylabs.com/blog/ai-testing-tools-meticulous-vs-momentic-vs-qa-wolf); [rywalker.com Octomind research](https://rywalker.com/research/octomind); [test-lab.ai best AI QA tools](https://www.test-lab.ai/best-ai-qa-tools); [TestAutomate agentic QA tools](https://testautomate.ai/blog/best-agentic-qa-tools/) (all via search summary; Octomind status unverified)

### Inferences
- For the user's skill, a practical design is:
  1. On the first run, Claude (or the Playwright Generator agent) turns the plain-language scenario into a Playwright test, using refs → `generate-locator` for stable locators.
  2. Later runs execute `npx playwright test` with zero LLM tokens.
  3. When a run fails, a Healer-style subagent patches it.
  4. A separate screenshot judge assesses visual pass/fail.
  The LLM cost then scales with the number of changes and failures, not with the number of runs.
- Key risk: a healer that "fixes" a test by relaxing assertions turns real regressions into green tests. The skill should log every heal as a diff, never auto-heal assertions (only locators and waits), and surface "skipped because functionality broken" outcomes as failures.
- Generated tests must keep the original natural-language step text as comments or metadata ("intent metadata" per TinyFish). The healer can then re-derive intent rather than guessing from a stale selector.

### Gaps
- No public, independent data on heal success rate, false-heal rate, or the share of runs needing LLM fallback for any of these tools.
- Official Playwright release notes were not fetched directly, so the 1.56 introduction date rests on secondary sources plus newreleases.io.
- No current pricing for Checksum or Momentic, and Octomind's operating status in Nov 2026 is unconfirmed.

## 4. Model choice for the browser-driving step: small vs frontier models, current Claude prices, accuracy tradeoffs

### Takeaway
Haiku 5.5 is now dramatically cheaper than Sonnet or Opus: $0.10/$0.50 per MTok for prompts up to 100k, vs $2/$10 for Sonnet 5.5 and $4/$20 for Opus 5.5. On Browser Use's 180-task live-web benchmark it gives up about 8–11 points of score: Haiku 5.5 high scored 64.3 at 23¢ per task and 9.3 min, vs Sonnet 5.5 high at 72.7, $1.53 and 9.4 min, and Opus 5.5 high at 75.0, $2.35 and 11.8 min. Short, scripted QA scenarios on one's own app are far easier than those open-web tasks, so a small model for navigation plus a stronger model only for judging or healing is the cost-optimal split.

### Cited Findings
**Official Claude API prices (per MTok)**

| Model | Input | 5m cache write | 1h cache write | Cache hit | Output |
|---|---|---|---|---|---|
| Fable 5.2 / Mythos 5.2 | $8 | $10 | $16 | $0.20 | $40 |
| Opus 5.5 | $4 | $5 | $8 | $0.20 | $20 |
| Opus 5 / 4.8 / 4.7 / 4.6 / 4.5 | $5 | $6.25 | $10 | $0.50 | $25 |
| Sonnet 5.5 | $2 | $2.50 | $4 | $0.10 | $10 |
| Sonnet 5 | $2 | $2.50 | $4 | $0.20 | $10 |
| Sonnet 4.6 / 4.5 | $3 | $3.75 | $6 | $0.30 | $15 |
| Haiku 5.5, prompts ≤100k tokens | $0.10 | $0.125 | $0.20 | $0.01 | $0.50 |
| Haiku 5.5, prompts >100k tokens | $0.50 | $0.625 | $1 | $0.05 | $2.50 |
| Haiku 4.5 | $1 | $1.25 | $2 | $0.10 | $5 |

  — [Anthropic Pricing docs](https://platform.claude.com/docs/en/about-claude/pricing)
- Cache hits on Opus 5.5 and Sonnet 5.5 cost 0.05x base input, on Fable/Mythos 5.1–5.2 0.025x, and 0.1x on others. The Sonnet 5 $2/$10 introductory price became standard, and the planned Sept 1, 2026 increase to $3/$15 "will not occur". — [Anthropic Pricing docs](https://platform.claude.com/docs/en/about-claude/pricing)
- Haiku 5.5 is priced per request by prompt length. A prompt over 100,000 tokens (cache reads and writes included) pays the higher tier for that whole request. — [Anthropic Pricing docs](https://platform.claude.com/docs/en/about-claude/pricing)
- Claude 4.7 and later models use a newer tokenizer that produces "approximately 30% more tokens for the same text". — [Anthropic Pricing docs](https://platform.claude.com/docs/en/about-claude/pricing)
- Batch API: 50% off input and output, and it stacks with caching. It can't be combined with fast mode. — [Anthropic Pricing docs](https://platform.claude.com/docs/en/about-claude/pricing)
- Fast mode: "up to 2.5x higher output tokens per second" at premium prices (Opus 5.5 fast is $8/$40, Fable 5.2 fast is $16/$80). — [Anthropic Pricing docs](https://platform.claude.com/docs/en/about-claude/pricing)
- Browser Use Bench v2.1 (updated Oct 29, 2026; 180 live-website tasks; score 0–100 by LLM-judge rubric; cost is model tokens only; time is median minutes):

| Agent | Score | Cost/task | Median time |
|---|---|---|---|
| Claude Opus 5.5 high | 75.0 | $2.35 | 11.8 min |
| Claude Sonnet 5.5 high | 72.7 | $1.53 | 9.4 min |
| Claude Fable 5.1 high | 72.0 | $5.19 | 17.2 min |
| Claude Haiku 5.5 xhigh | 69.5 | 46¢ | 14.2 min |
| Claude Haiku 5.5 high | 64.3 | 23¢ | 9.3 min |
| Claude Haiku 5.5 medium | 53.4 | 9.2¢ | 5.2 min |
| Claude Haiku 5.5 low | 45.6 | 2.7¢ | 2.4 min |
| Claude Opus 5 | 66.8 | $4.72 | 19.0 min |
| GPT-6.1 Sol high (top) | 81.3 | $1.92 | 14.3 min |
| GPT-6.1 Terra high | 79.0 | $1.26 | 8.8 min |
| GPT-6 Luna max (mini-tier) | 69.2 | 22¢ | 16.6 min |
| DeepSeek V4.1 Flash 1017 max | 75.0 | 22¢ | — |
| Browser Use BU fast | 72.9 | 11¢ | 9.2 min |

  Gemini Flash is not on this board. This is a vendor-run benchmark, with judge GPT-5.6 Luna xhigh. — [Browser Use agent benchmarks](https://browser-use.com/benchmarks/agents)
- Online-Mind2Web, an independent academic benchmark from the OSU NLP group whose original Apr 2025 paper found Operator at only 61%:
  - Steel's aggregate leaderboard (last updated Apr 16, 2026) lists GPT-5.4 Native Computer Use at 93.0% (self-reported), Gemini 2.5 Computer Use at about 69.0%, and Claude Computer Use 3.7 at 56.3%.
  - Browser Use claims 97%.
  - Scores differ by evaluator (human vs WebJudge vs self-reported), so they aren't directly comparable.
  — [arXiv 2504.01382 "An Illusion of Progress?"](https://arxiv.org/html/2504.01382v4); [Steel leaderboard: Online-Mind2Web](https://leaderboard.steel.dev/leaderboards/online-mind2web); [Browser Use Online-Mind2Web post](https://browser-use.com/posts/online-mind2web-benchmark); [OSU HF leaderboard](https://osunlp-online-mind2web-leaderboard.hf.space/) (figures via search summary, not directly opened)

### Inferences
- Per input token, Haiku 5.5 (≤100k prompt) is 20x cheaper than Sonnet 5.5 and 40x cheaper than Opus 5.5. On Browser Use's bench, Haiku 5.5 "high" costs about 1/7 of Sonnet 5.5 per task, at a similar median time and about 8 points lower score.
- Keep the Haiku 5.5 navigation loop under 100k prompt tokens (trim old screenshots and history) to stay on the cheap tier. Crossing it raises the price of that whole request 5x.
- Screenshot pass/fail judging after a run isn't latency-critical. The Batch API (50% off) or a single Haiku/Sonnet call per final screenshot makes judging cost negligible: a 1280×800 screenshot is about 1.3k tokens, roughly $0.00013 on Haiku 5.5 or $0.0027 on Sonnet 5.5, before the batch discount.
- Open-web benchmark scores (unknown sites, long tasks, 9–20 min medians) understate how well small models do on short scripted flows on a known app with explicit steps. I found no benchmark that measures that easier QA setting directly.

### Gaps
- No Gemini Flash numbers on the Browser Use bench, and no current Gemini Flash or GPT mini prices were fetched.
- No 2026 Online-Mind2Web entries for Claude 5.x models were verified, and the "claude-fable-5" entry at 86.0% on Yutori's board ([Yutori leaderboards](https://yutori.com/leaderboards.md)) was not verified.
- No benchmark specific to QA-test execution (scripted steps on one's own app) comparing small and frontier models.

## 5. Accessibility tree / DOM-based vs vision (screenshot) control: token cost and reliability

### Takeaway
DOM or accessibility-tree control with refs is cheaper and more robust for standard web UIs, and Anthropic's own browser-use docs recommend it. The catch is that a full tree can be huge (about 97k chars on a 300-row page), so the win depends on snapshot-to-file plus scoped `find`/interactive-filter queries. Vision is still needed for canvas, video, cross-origin iframes and, crucially for this skill, for judging visual correctness.

### Cited Findings
- Anthropic: prefer refs "where the page has a usable accessibility tree. A reference survives layout shifts and reflows that make pixel coordinates fragile". Fall back to coordinates for "canvas-rendered interfaces, embedded video or remote-desktop surfaces, heavily virtualized lists, and elements inside cross-origin iframes". Refs stay valid "until that tab navigates or its DOM changes materially", and the executor must report stale refs. — [Anthropic Browser use tool docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/browser-use-tool)
- Anthropic: `read_page` with `filter: "interactive"` or a container ref returns a focused subtree and "often costs fewer input tokens than a screenshot". — [Anthropic Browser use tool docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/browser-use-tool)
- A full accessibility tree for a 300-row page was about 97,000 chars. A navigate response that writes the snapshot to file returned about 230 chars, and a scoped `find` about 450 chars. — [DEV Community re-benchmark (Jul 2026)](https://dev.to/aswani25/playwright-cli-vs-playwright-mcp-which-should-you-use-with-claude-code-1olh)
- A single page snapshot was cited at about 15,000 tokens for older Playwright MCP (full tree inline) vs about 200 for Playwright CLI. Older numbers, methodology unknown. — [heyuan110](https://www.heyuan110.com/posts/ai/2026-01-28-claude-code-browser-automation/)
- Browser Use: DOM-first, with screenshots only when visual context is needed. Each screenshot adds about 0.8 s inference latency. — [Browser Use "Speed Matters"](https://browser-use.com/posts/speed-matters)
- agent-browser: a click "fails instead of reporting success when the target is hidden, disabled, outside the viewport, or covered (for example, by a consent banner)", a reliability feature of ref-based control. — [vercel-labs/agent-browser](https://github.com/vercel-labs/agent-browser)
- Midscene (vision-first): token cost is driven by image resolution and UI context size, and each planning step calls the VLM. — [Midscene API docs](https://midscenejs.com/api) (via search summary)
- A screenshot costs 1,296–2,691 visual tokens at typical sizes on 4.7+ models. — [Anthropic Vision docs](https://platform.claude.com/docs/en/build-with-claude/vision)

### Inferences
- Hybrid is optimal for visual QA. Navigate and act with refs from a scoped accessibility snapshot (about 100–500 tokens per step when scoped). Take a screenshot only at checkpoints and at the end, for the "expected result" visual assessment.
- Refs from the accessibility tree map directly to Playwright role/name locators (e.g., Playwright CLI `generate-locator`), which makes the compile-to-script step (section 3) easier than with coordinate-based vision runs.

### Gaps
- No controlled, independent study in 2026 comparing task success between accessibility-tree and screenshot control on the same model and tasks.

## 6. Parallelism: running scenarios in parallel (local headless, Browserbase/cloud) and its cost

### Takeaway
Cloud browsers are cheap per hour: Browserbase charges $0.10–$0.12 per browser-hour in overage with 25–100 concurrent browsers on the $20 and $99 plans, and a third-party review puts Browser Use at about $0.02 per browser-hour. Browser time is negligible next to LLM tokens in agent mode. Once scenarios are compiled to Playwright, local parallel headless runs cost nothing beyond compute.

### Cited Findings
- Browserbase plans:
  - Free: $0, 1 browser-hour, 3 concurrent browsers, $5 in model tokens included.
  - Developer: $20/mo, 100 hours, $0.12/hr overage, 25 concurrent, 1 GB proxy then $12/GB.
  - Startup: $99/mo, 500 hours, $0.10/hr overage, 100 concurrent, 5 GB proxy then $10/GB.
  - Scale: custom, 250+ concurrent.
  - A Model Gateway bills model tokens "at market price".
  — [Browserbase pricing](https://www.browserbase.com/pricing)
- Browser Use cloud: about $0.02 per browser-hour, steps from $0.006 (third-party review, Nov 2026). Browser and proxy are billed separately from the per-task model cost in the BU Ultrafast numbers. — [WTF Radar review](https://wetheflywheel.com/en/radar/browser-use-review/); [BU Ultrafast post](https://browser-use.com/posts/bu-ultrafast-is-live)
- agent-browser runs a separate daemon and browser for each `--session`, which allows parallel isolated sessions locally, and it lists several cloud browser providers. — [vercel-labs/agent-browser](https://github.com/vercel-labs/agent-browser)
- The Stagehand server cache only works on Browserbase. The local `cacheDir` works on local and cloud browsers. — [Stagehand docs](https://docs.stagehand.dev/v3/best-practices/caching)
- Anthropic's many-image limit: more than 20 images in one request triggers stricter per-image dimension limits, which limits long single-context screenshot loops rather than parallel runs. — [Anthropic Vision docs](https://platform.claude.com/docs/en/build-with-claude/vision)

### Inferences
- Example (my calculation): 50 scenarios × 1 minute each in parallel cloud browsers is about 0.83 browser-hours, roughly $0.10 at Browserbase overage. The same 50 scenarios in a Sonnet 5.5 screenshot loop cost about $5–16 in tokens (from the section 1 estimate of $0.10–0.32 per scenario), so tokens, not browsers, set the bill.
- In a Claude Code skill, parallelism means spawning parallel subagents or processes, each with its own browser session (agent-browser `--session`, separate Playwright contexts, or Playwright Test workers for compiled scripts). Anthropic API rate limits, not browser cost, will likely be the parallelism ceiling for live agent runs.

### Gaps
- Anthropic per-tier rate limits (RPM/ITPM) were not retrieved, so the practical ceiling on parallel live-agent scenarios is not quantified.
- No published benchmarks for wall-clock gains from parallel agent runs (vs deterministic Playwright parallel workers).
