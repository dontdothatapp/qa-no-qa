# "Jev AI" identification and the AI-native QA / test-automation landscape (as of mid-Nov 2026)

## Q1. What does the user mean by "Jev AI"? Is it a real product, and what are the alternatives if it is a mishearing?

### Takeaway
High confidence: "Jev AI" is a real product and not a mishearing. It is **Jev, TypeSafe AI's "System One" decision model**, launched in early access on 15 Sep 2026. Two days later Browser Use paired it with its open-source **jev-ultrafast** browser agent, and several community Claude Code skills appeared within a week (jev-browse, jev-kit, jev-browser-use, jev-browser-skill). People use these to hand each per-step click or type decision to Jev instead of to Claude, which matches the user's description: "people use it to speed up and make Claude browser actions more efficient." The most plausible fallback, if the user meant something else, is SawyerHood's **dev-browser** skill ("dev" sounds like "Jev"), followed by Vercel **agent-browser**.

### Cited Findings
**Jev (TypeSafe AI): the primary candidate**
- TypeSafe's homepage calls Jev "TypeSafe's first public System One Model, optimized for automation." It returns typed decisions with calibrated probabilities instead of generated text, and it is "in early access." The API console is at console.typesafe.ai and the docs are at docs.typesafe.ai. — [TypeSafe AI homepage](https://typesafe.ai/)
- Launch date given as 15 Sep 2026, in early access. The name comes from System 1 in Kahneman's *Thinking, Fast and Slow*. — [Overchat explainer](https://overchat.ai/ai-hub/jev-ai); [TrueFoundry](https://www.truefoundry.com/blog/typesafe-ai-jev); [DigitalOcean "What is Jev"](https://www.digitalocean.com/resources/articles/what-is-jev)
- Jev takes a `state` plus typed questions of three kinds: Choice (pick one option), Score (place on an ordered scale) and a true/false type. It returns probabilities, not prose. The model id is `jev-latest`. — [Overchat](https://overchat.ai/ai-hub/jev-ai)
- Jev is reportedly also offered through DigitalOcean's Model Catalog (Serverless Inference). — [DigitalOcean](https://www.digitalocean.com/resources/articles/what-is-jev)
- **Browser Use jev-ultrafast:** this is the official repo `browser-use/jev-ultrafast`. It is MIT-licensed, has about 24.5k stars and 1.9k forks, and is described as "Fastest and cheapest web agent." Its README says the approach is now "ultrafast mode" in Browser Use and that the repo remains as the original experiment. — [GitHub browser-use/jev-ultrafast](https://github.com/browser-use/jev-ultrafast); [Browser Use GitHub org](https://github.com/browser-use)
- Browser Use co-founder Gregor Zunic posted an X demo of a Google Flights search done in about 7 s for $0.0039, roughly two days after Jev launched (about 17 Sep 2026). — [INSIDE (Taiwan)](https://www.inside.com.tw/article/42431-jev-ultrafast-browser-agent-gregpr07); [Alphasignal](https://alphasignal.ai/news/browser-use-s-jev-ultrafast-cuts-browser-agent-costs-90-with-indexed-dom-actions)
- **Community Claude Code skills built on Jev, all dated Sep 2026:**
  - `danielnc/jev-browse`: PyPI package, Claude Code plugin and MCP server.
  - `jonathanavis96/jev-kit`: Claude Code toolkit with a `browse` MCP tool.
  - `zurfyx/jev-browser-skill`: "Let Jev, TypeSafe's ~100ms decision model, drive your browser."
  - `damian87x/jev-browser-use`: "Fast browser QA from Claude Code."
  - `AuroraPixel/jev-browser-use`: derived from dev-browser.
  - `stkang9409/jev-fast-skills`: includes a fast-browser skill.
  - None of these is official.
  - Sources: [jev-browse](https://github.com/danielnc/jev-browse); [jev-kit](https://github.com/jonathanavis96/jev-kit); [jev-browser-skill](https://github.com/zurfyx/jev-browser-skill); [damian87x/jev-browser-use](https://github.com/damian87x/jev-browser-use); [AuroraPixel/jev-browser-use](https://github.com/AuroraPixel/jev-browser-use); [jev-fast-skills](https://github.com/stkang9409/jev-fast-skills)
- A MindStudio tutorial dated 9 Oct 2026 is titled "How to Build a Fast Browser Agent with Jev and Claude Code." This is direct evidence of the "Claude + Jev" usage pattern the user heard about. — [MindStudio](https://www.mindstudio.ai/blog/how-to-build-jev-browser-agent)
- A separate, unrelated "Jev Browser" product exists at digitalfoundry.ai: an autonomous parallel browser for AI agents with a vendor claim of "2.5x faster." It is a different offering from TypeSafe's model, and its claims are unverified. — [digitalfoundry.ai Jev Browser](https://digitalfoundry.ai/jev-browser/)

**Fallback candidates if "Jev" was misheard, ranked by plausibility**
1. **dev-browser (SawyerHood).** An MIT Claude skill built on TypeScript and Playwright that keeps page state across script runs. It has about 6.6k stars. Install with `/plugin marketplace add sawyerhood/dev-browser` or `npm i -g dev-browser` plus `dev-browser install-skill --claude`. The author's own eval reports Dev Browser at 3m 53s / $0.88 against Playwright MCP at $1.45 (self-reported). — [GitHub sawyerhood/dev-browser](https://github.com/sawyerhood/dev-browser); [community fork README with benchmark table](https://cdn.jsdelivr.net/gh/wrsmith108/dev-browser-claude-skill@main/README.md)
2. **Vercel agent-browser.** A CLI rather than an MCP server. It returns compact accessibility-tree snapshots with short element refs. Reported results: 1,364 tokens against 7,779 for Playwright MCP on a 6-step test, and "5.7x fewer tokens." One page snapshot shrank from 8,000+ characters with Playwright MCP to 280 characters. These are third-party measurements, and one Pulumi post with 6 scenarios underlies some of them. — [nocode.tech](https://www.nocode.tech/article/vercel-just-open-sourced-a-browser-that-ai-agents-can-actually-drive-heres-why-it-changes-automation); [Pulumi blog](https://www.pulumi.com/blog/self-verifying-ai-agents-vercels-agent-browser-in-the-ralph-wiggum-loop); [velog.io](https://velog.io/@qwerty55558/Vercel-agent-browser); [DEV Community](https://dev.to/chen_zhang_bac430bc7f6b95/why-vercels-agent-browser-is-winning-the-token-efficiency-war-for-ai-browser-automation-4p87)
3. **Playwright CLI (rather than Playwright MCP).** A typical task is cited at about 114K tokens through MCP against about 27K through the CLI (attributed to a Playwright-team benchmark), or about $0.34 against $0.08 on Sonnet. One comparison table lists about 7K tokens for agent-browser and about 50K for Chrome DevTools MCP on a 10-step task. — [Playwright CLI vs MCP token cost](https://playwright.aims-ai.com/blog/playwright-cli-vs-mcp-server-token-cost); [heyuan110 comparison of 5 tools](https://www.heyuan110.com/posts/ai/2026-01-28-claude-code-browser-automation/)

### Inferences
- The fit with the user's phrase is strong: Jev's whole pitch is to remove the main LLM from the per-step loop. The Claude Code community built skills for exactly that within days of launch, and the search engine returns "Jev AI" explainers framed around browser agents.
- I did not individually search Jam.dev, Jace AI, JetBrains Junie, Google Jules, Jarvis, Devin, Javelin, Kane AI, Midscene or Stagehand as "Jev" sound-alikes. A real, on-topic "Jev" exists, and none of those is a tool for "making Claude browser actions faster." Stagehand appears instead as a Jev integration partner (see Q2).
- dev-browser is the best fallback because the names are phonetically close and it is also pitched as a faster, cheaper alternative to Playwright MCP inside Claude Code. One Jev skill (AuroraPixel) is a fork of dev-browser, so the two ecosystems overlap.

### Gaps
- I found no Reddit or Hacker News threads about Jev. Community evidence is GitHub repos, an X demo and blog or press coverage. I could not confirm where the user heard about it.
- I could not verify TypeSafe's funding: one source says $40M seed, and the homepage links a "series-ai" post I did not read. I also could not confirm the model version history (one source cites "Jev 1.14" on 14 Oct).

## Q2. How does Jev work, how much faster or cheaper is it than Playwright MCP or Claude in Chrome, how do you use it with Claude Code, and does it fit visual QA?

### Takeaway
Jev turns the live page into a numbered list of DOM or ARIA controls. It picks one operation (CLICK, TYPE_TEXT, SELECT, SCROLL, WAIT, DONE, BLOCKED) plus a target in roughly 100–500 ms per decision. A small text LLM writes typed text, and Claude handles planning and verification.
- **Speed and cost:** self-reported gains are about 1.6–3x faster, about 2–5x cheaper per task, and over 200x less Claude spend per decision. All of these come from small samples (n=3) and vendor or author tests.
- **Limits:** no vision, iframes, shadow DOM, canvas, file uploads or pop-up tabs. It needs an early-access TypeSafe API key, and it can falsely report DONE.
- **Fit:** it can speed up the "navigate and click" half of a visual QA skill. It cannot do the "look at the screenshot and judge pass/fail" half, which still needs Claude's vision or deterministic checks.

### Cited Findings
**Mechanism**
- jev-ultrafast builds a numbered element table on each step, e.g. `[2] combobox Where from?`.
  - One TypeSafe request returns an operation plus target heads: "two decisions, one network round trip."
  - A small LLM writes text only for `TYPE_TEXT`, and its output must parse as JSON.
  - The default loop uses structured DOM state, not screenshots.
  - Model output never becomes selectors, coordinates, shell commands or JavaScript.
  - `DONE` still requires independent outcome verification.
  - The demo text model is `inception/mercury-2.5` via OpenRouter.
  - Source: [jev-ultrafast README](https://github.com/browser-use/jev-ultrafast)
- **Unsupported in jev-ultrafast:** shadow roots, frames, canvas, file uploads, pop-up tabs, nested scrolling and arbitrary keyboard widgets. The DOM reader does not implement the full accessible-name spec. — [jev-ultrafast README](https://github.com/browser-use/jev-ultrafast)
- In the MindStudio Claude Code pattern, Jev answers an action-type question and a target-element question in one call. Code executes the action if both confidences exceed a threshold (0.7 in the example); otherwise Claude steps in. Claude plans, writes text for "type" actions and verifies "done" claims. In their test, an agent reported finishing 10 page visits in 77 s, but most of its screenshots were not the target pages, which is why Claude verification is needed. — [MindStudio](https://www.mindstudio.ai/blog/how-to-build-jev-browser-agent)
- Integrations besides Browser Use: Stagehand (TypeScript, via `@typesafe-ai/sdk`) and LangChain (`langchain-typesafe`). — [Overchat](https://overchat.ai/ai-hub/jev-ai)

**Speed and cost numbers (all vendor- or author-reported; none independent)**
- **TypeSafe homepage (vendor):**
  - "193.6x Faster, 444.6x Cheaper" on System One-shaped workflows.
  - Example run: Jev $0.000081 in 0.114 s, against an LLM at $0.013880 in 8.566 s.
  - Input priced at **$42 per billion tokens ($0.042/M)**, with output free.
  - Claims to be "238x" cheaper on input than a named Claude model.
  - Claims "Zero Hallucinations," with no methodology given.
  - Source: [TypeSafe AI](https://typesafe.ai/); pricing corroborated by [Overchat](https://overchat.ai/ai-hub/jev-ai)
- **Latency:** cited as 70–500 ms per decision, TypeSafe-reported. — [search summary of TrueFoundry/ExplainX coverage](https://www.truefoundry.com/blog/typesafe-ai-jev)
- **jev-ultrafast README:**
  - Zürich→London on Google Flights took 7,073 ms.
  - Over six alternating runs (3/3 pass each), median time fell from 9.450 s to 7.092 s (−25%) and median browser-protocol calls fell from 1,092 to 101.
  - The README itself warns this is "not a general reliability benchmark."
  - It gives no cost figures and no comparison to Playwright MCP or Claude.
  - Source: [jev-ultrafast README](https://github.com/browser-use/jev-ultrafast)
- **jev-browse (danielnc), compared with the same Claude agent driving browser-harness directly, n=3:**
  - "1.6–3.0× faster and 2.1–5.3× cheaper," with the same pass rate.
  - Median run: 72.8 s / $2.34 direct against 24.7 s / $0.44 with jev-browse.
  - Source: [jev-browse README](https://github.com/danielnc/jev-browse)
- **jev-kit (n=3, 27 runs, author calls it "directional, not significant"):**

  | Decider | Goals reached | Median per decision | Claude spend per run |
  |---|---|---|---|
  | Jev | 9/9 | 314–486 ms | $0.0008 |
  | Claude Sonnet | 9/9 | 1.1–1.5 s | $0.1868 |
  | Claude Haiku | 4/9 | 0.76–2.8 s | — |

  On an 8-task Wikipedia suite, Jev named 15/18 hops in 7.1 s; Sonnet on Playwright MCP named 17/18 in 26.0 s, so Jev was faster but slightly less accurate. — [jev-kit README](https://github.com/jonathanavis96/jev-kit)
- **AuroraPixel/jev-browser-use** benchmarked against Codex, not Claude, over 60 trials. Jev was about 1.74x as fast as desktop Computer Use but only about 0.81x as fast as Codex's built-in Browser Use. The author says it is "not evidence that Jev is universally faster." — [AuroraPixel README](https://github.com/AuroraPixel/jev-browser-use)

**Install and use with Claude Code**
- **jev-browse:**
  - Needs `uv tool install jev-browse`, then `jev-browse install` and `jev-browse doctor`.
  - Requires Chrome, browser-harness, Python 3.11+ and a TypeSafe key.
  - Also ships as a Claude Code plugin and an MCP server (`jev-browse mcp`).
  - Claude calls `fast_run(url, goal, values={...})`, which hands back on unknown values, risky clicks, frames, uploads or sensitive fields.
  - The README says agents "rarely think to use it" without a global instruction.
  - Source: [jev-browse](https://github.com/danielnc/jev-browse)
- **jev-ultrafast setup:** `git clone`, `uv sync`, add `TYPESAFE_API_KEY` and `TEXT_MODEL_API_KEY` to `.env`, then `uv run jev`. Library use is `from jev_ultrafast import Agent`. — [jev-ultrafast](https://github.com/browser-use/jev-ultrafast)
- **AuroraPixel skill:** `/plugin marketplace add AuroraPixel/jev-browser-use`. `TYPESAFE_API_KEY` is needed only for Jev decisions; plain Puppeteer scripts work without it. — [AuroraPixel](https://github.com/AuroraPixel/jev-browser-use)

**Risks and skepticism**
- A security vendor told Computerworld that Jev is "even more susceptible to attack" than LLMs. In its test, an attacker-controlled ad diverted a browser agent from a simulated checkout. — [Computerworld](https://www.computerworld.com/article/4236138/typesafes-jev-even-more-susceptible-to-attack-than-llms-says-security-vendor-3.html)
- Critics say "can't hallucinate" only means answers stay inside the schema, not that they are correct. TypeSafe's workflow scores are vendor-published, and no calibration data, reliability diagram or ECE has been published. — [AgentConn](https://agentconn.com/blog/jev-typesafe-new-agent-layer-if-calibration-holds/); [KDnuggets](https://www.kdnuggets.com/what-everyone-is-getting-wrong-about-typesafe-ais-jev)
- jev-browse sends visible page text and non-personal field values to api.typesafe.ai by default. — [jev-browse](https://github.com/danielnc/jev-browse)

### Inferences
- **Where Jev helps in the user's skill:** it would replace Claude's per-step "which element do I click next" reasoning, which drives most of the latency and token cost in Playwright MCP or Claude-in-Chrome loops. Claude would only need to:
  - turn the plain-language scenario into a goal, text values and expectations;
  - handle hand-backs;
  - look at the final screenshot once to judge pass/fail.

  That would plausibly cut cost and time several-fold, but the evidence is n=3 author benchmarks.
- **Where Jev does not help:** it is text- and DOM-only. Visual assertions ("the button is blue", "the layout isn't broken") still need a vision pass by Claude or pixel-diffing. Unsupported widgets (iframes, Stripe or payment forms, file uploads, canvas, shadow DOM) would fall back to Claude or Playwright.
- **Practical blockers:** early-access API keys, metered per-decision billing, a young ecosystem (most skill repos have 0–91 stars) and unproven calibration. A deterministic option is worth weighing against Jev: Playwright CLI or agent-browser for actions, with Claude used only at checkpoints. It needs no third-party model and is already documented at about 4–6x fewer tokens than Playwright MCP.

### Gaps
- There is no head-to-head benchmark of Jev against Claude in Chrome. The only Playwright MCP comparison is jev-kit's Wikipedia suite.
- I did not confirm how early access or waitlist works, or whether the $0.042/M price is introductory. The homepage FAQ asks this, but the answer was not captured.
- I found no independent, third-party reproduction of any Jev speed or cost claim.

## Q3. What AI-native QA products already turn natural-language scenarios into executed browser tests with screenshots and reports? (buy-vs-build landscape)

### Takeaway
The market is crowded and moving fast, and Octomind has already shut down. Products fall into three groups:
- **Runtime-agent SaaS:** Momentic, QA.tech, testRigor, KaneAI.
- **Generate-real-Playwright-code tools:** Checksum, TestSprite, Test-Lab, Bugzy, Autonoma, and Playwright's own planner/generator/healer agents.
- **Managed services:** QA Wolf, Bug0, Spur, Ranger, Rainforest.

For a solo developer or small team, the cheap entry points are Playwright test agents (free, and run through Claude Code), KaneAI (from $17/mo), TestSprite ($19/mo), TestDriver ($20/mo) and free or usage tiers at Momentic, Test-Lab and Rainforest. Managed services start around $2.5k/mo. Most pricing data comes from vendor-written comparison pages and sources conflict, so treat figures as approximate.

### Cited Findings
**Free and open-source baseline**
- **Playwright Test Agents.**
  - Playwright ships three agents: a planner that explores the app and writes a Markdown plan, a generator that turns the plan into test files, and a healer that runs the suite and repairs failures.
  - Setup for Claude Code: `npx playwright init-agents --loop=claude` writes `.claude/agents/` and `.mcp.json`. Requires Playwright ≥1.56.
  - Sources: [playwright.dev test agents](https://playwright.dev/docs/test-agents); [Shiplight](https://www.shiplight.ai/blog/playwright-agents)
  - User caveats: one developer reported the planner alone used 78% of a 5-hour Claude Code usage window. The healer sometimes "fixes" tests by loosening assertions. — [DEV Community](https://dev.to/ben_weese/building-playwright-agents-lessons-from-the-deep-trenches-3mk7); [qaskills.sh guide](https://qaskills.sh/blog/playwright-test-agents-planner-generator-healer-guide)

**Runtime-agent and natural-language SaaS**
- **Momentic:** plain-English YAML steps resolved by intent at runtime, with self-healing and an element cache in the vendor cloud. Exports JUnit, Allure and Playwright-JSON reporters. Its proprietary format is flagged as a downside. — [TestAutomate (vendor, Sep 2026)](https://testautomate.ai/blog/best-agentic-qa-tools/); [Bugzy (vendor, Mar 2026)](https://www.bugzy.ai/compare/best-ai-qa-tools-2026)
  - Pricing conflicts across sources. TestAutomate lists a free tier and $125/mo for 10k credits. Other sources list "starts at $250/mo," a Free tier ($0 + $50 usage) with Scale at $500/mo, and private cloud from $3,000/mo. — [TestAutomate](https://testautomate.ai/blog/best-agentic-qa-tools/); [Kanopy Labs](https://kanopylabs.com/blog/ai-testing-tools-meticulous-vs-momentic-vs-qa-wolf); [Test-Lab best AI QA tools](https://www.test-lab.ai/best-ai-qa-tools)
- **QA.tech:** a runtime AI web agent, $499–$1,999/mo self-serve. — [Bugzy](https://www.bugzy.ai/compare/best-ai-qa-tools-2026)
- **testRigor:** plain-English tests. It has a free tier, but paid prices conflict: about $300/mo, about $450/mo, and plans up to $900/mo. — [search roundup: Fora Soft](https://www.forasoft.com/blog/article/ai-testing-optimization); [Quash](https://quashbugs.com/blog/new-ai-testing-tools-emerging); [Bug0 testRigor page (competitor)](https://bug0.com/alternatives/testrigor)
- **KaneAI (TestMu AI, renamed from LambdaTest in Jan 2026):** authoring by natural language, recorded click-throughs or Jira/PRD import. It stores versioned steps with a code view and runs in the cloud. From $17/mo billed annually, plus a free local Kane CLI. — [TestAutomate](https://testautomate.ai/blog/best-agentic-qa-tools/)
- **TestAutomate:** a runtime agent that stores intent and re-derives steps each run, with plain-English prompts plus expected outcomes in YAML. Pre-launch; BYOK. — [TestAutomate (self)](https://testautomate.ai/blog/best-agentic-qa-tools/)
- **mabl:** recorder-based, consumption pricing, custom quotes, 14-day trial. **Testim** (Tricentis): enterprise only. **Applitools:** a visual-AI engine added to existing frameworks, enterprise usage-based pricing. **Katalon:** from about $84/user/mo, free tier. **Autify:** enterprise quote. — [Test-Lab pricing (vendor, Jul 2026)](https://www.test-lab.ai/blog/ai-testing-pricing); [Bugzy](https://www.bugzy.ai/compare/best-ai-qa-tools-2026)

**Generate-code tools (you own the Playwright output)**
- **Checksum:** agents generate real Playwright code into the repo and verify it by running. It has an open-source runtime package and is sales-led with no public pricing. — [TestAutomate](https://testautomate.ai/blog/best-agentic-qa-tools/)
- **TestSprite:** natural-language plans from a PRD, URL or OpenAPI spec, compiled to Playwright or Cypress and run in the vendor cloud. It offers an MCP server. Free 150 credits/mo, then Starter $19/mo. — [TestAutomate](https://testautomate.ai/blog/best-agentic-qa-tools/)
- **Autonoma:** a planner CLI that drafts markdown tests from the codebase. The planner is MIT-licensed and self-hosting is free; cloud is 100K credits free, then $100 per 150K credits. — [TestAutomate](https://testautomate.ai/blog/best-agentic-qa-tools/)
- **Test-Lab:** pay-as-you-go from $0, Scale $149/mo. It says it generates standard Playwright. — [Test-Lab (vendor)](https://www.test-lab.ai/blog/ai-testing-pricing)
- **TestDriver:** Free; Pro $20/mo; Team $600/mo. — [Test-Lab](https://www.test-lab.ai/blog/ai-testing-pricing)
- **Bugzy:** generates standard Playwright from natural-language product descriptions. Its page says it "is now part of Felan." — [Bugzy](https://www.bugzy.ai/compare/best-ai-qa-tools-2026)

**Managed services (humans plus AI)**
- **QA Wolf:** AI plus human engineers write Playwright and Appium tests and attach video walkthroughs to bug reports.
  - Managed contracts are estimated at $60K–$250K+/yr.
  - One source lists a platform rate of 1¢ per AI credit plus 15¢ per runner minute.
  - Another claims $1 per web test run, which is unverified.
  - Sources: [Test-Lab](https://www.test-lab.ai/blog/ai-testing-pricing); [TestAutomate](https://testautomate.ai/blog/best-agentic-qa-tools/); [Test-Lab best tools](https://www.test-lab.ai/best-ai-qa-tools)
- **Bug0:** managed at $2,500/mo, covering up to 500 user flows with unlimited runs and a forward-deployed engineer. — [Bug0 blog](https://bug0.com/blog/best-qa-automation-tools-2026)
- **Spur:** about $4–8K/mo with no public pricing. This figure comes only from competitor Bug0. — [Bug0 Spur page](https://bug0.com/alternatives/spur)
- **Ranger:** no self-serve tier and no published price; sales consultation required. — [search roundup](https://resources.rework.com/tools/ai-agents/best-ai-agents-for-qa-testing-2026)
- **Rainforest QA:** from $200/mo, free 5 hrs/mo. — [Test-Lab](https://www.test-lab.ai/blog/ai-testing-pricing)

**Dead**
- **Octomind** announced its shutdown in April 2026. The product was turned off at the end of May 2026 and the company wound down by the end of June 2026. Old listings still show prices such as $89/mo Basic and OctoClaw $9.99/mo, which are stale. — [Octomind farewell letter (primary)](https://octomind.dev/blog/a-letter-to-our-users-customers-and-readers/); [Distill Intelligence](https://www.distillintelligence.com/news/octomind)

### Inferences
- **No cheap ready-made tool exactly matches the user's flow** ("plain-language scenario → run → screenshot → AI judges pass/fail → report") as a local Claude Code skill. SaaS tools do most of it but lock tests in their cloud or format and charge per credit or minute. Playwright agents are free but output code and are token-hungry.
- **Build looks reasonable** for a solo dev who already pays for Claude Code. The differentiator would be the screenshot-plus-vision pass/fail report, which most SaaS products do not foreground; the comparison pages rarely mention screenshot reports.
- **Pricing is volatile:** one vendor has shut down, one has been renamed and Bugzy has been absorbed. A solo dev should avoid long contracts.

### Gaps
- I could not find current details on Reflect or Applitools Autonomous, specifically their natural-language flow, pricing or screenshot reports.
- Nearly all landscape pricing comes from vendor-written comparison pages (Test-Lab, TestAutomate, Bugzy, Bug0) dated Mar–Sep 2026. I did not verify each vendor's live pricing page.
- Screenshot and report artifacts are poorly documented in these comparisons for most vendors.

## Q4. Are there open-source Claude Code skills or MCP servers for natural-language and visual QA that the user could reuse or fork?

### Takeaway
Yes, several. The closest fits:
- **Autodesk/claude-browser-test-skills** (Apache-2.0): plain-language markdown tests are the source of truth; it can author, refine and compile them to `.spec.ts`, or run them with screenshot evidence.
- **QA Scout** (MIT): headed Playwright with highlighted screenshots and an HTML report.
- **damian87x/jev-browser-use** (MIT): the only QA-focused skill that already uses Jev. It runs from Claude Code with a `--expect` pass check, but produces no screenshots.

dev-browser (MIT, about 6.6k stars) is the most mature base for fast Claude-driven browsing. All the QA-specific repos are very young and low-star.

### Cited Findings
- **Autodesk/claude-browser-test-skills** (Apache-2.0, ©2026 Autodesk; 10 stars, 11 commits):
  - Its four skills are Author (explores the live app and writes a markdown test from a feature description), Refiner (reruns until N consecutive passes), Compiler (replays and emits an LLM-free Playwright `.spec.ts`) and Runner (executes the markdown test and reports pass/fail with screenshots at failure points and expected vs actual).
  - It uses Playwright MCP accessibility snapshots and recommends Opus.
  - Install: `/plugin marketplace add https://github.com/Autodesk/claude-browser-test-skills` then `/plugin install browser-test@browser-test-skills`.
  - Source: [GitHub](https://github.com/Autodesk/claude-browser-test-skills)
- **QA Scout** (MIT, ©2026 Rady Elkasas; 0 stars, 2 commits):
  - A local setup page at 127.0.0.1:4777 takes URLs, accounts and cross-page workflows.
  - It runs headed Chromium with a visible red cursor and records one video per page.
  - Screenshots frame and label the problem element.
  - Output is a self-contained `report.html` dashboard plus Markdown reports.
  - Install with `./install.sh` into `~/.claude/skills/qa-scout`.
  - Source: [GitHub](https://github.com/radyelkasas/qa-scout)
- **damian87x/jev-browser-use** (MIT; 0 stars; dated Sep 2026):
  - Usage: `--url --goal --expect --text 'LABEL=VALUE' --allow-hosts --max-ticks`.
  - It verifies `--expect` against the live title, h1 or URL, or uses `--expect-field`.
  - It blocks risky clicks (submit, pay, delete) by default.
  - Exit codes: 0 pass, 4 not verified, 5 left the allowlist.
  - It produces JSON output but no screenshots.
  - It includes `bench/head_to_head.py`, which compares the Jev fast path with a plain playwright-cli loop.
  - Source: [GitHub](https://github.com/damian87x/jev-browser-use)
- **dev-browser (SawyerHood):** MIT, about 6.6k stars, Playwright-based with persistent page state. Available as a Claude Code plugin marketplace entry. — [GitHub](https://github.com/sawyerhood/dev-browser)
- **jev-browse and jev-kit:** MIT; both expose MCP servers or tools (`jev-browse mcp`; jev-kit's `browse`). jev-kit vendors jev-ultrafast at upstream commit `1231850`. — [jev-browse](https://github.com/danielnc/jev-browse); [jev-kit](https://github.com/jonathanavis96/jev-kit)
- **Other leads, unverified (seen only in search snippets or curated lists):**
  - `vostride/agent-qa`: natural-language web and mobile tests; license FSL-1.1-ALv2, so not plain open source.
  - `borghei/Claude-Skills` `qa-browser-automation` SKILL.md.
  - `24kchengYe/desktop-controller-skill`: QA checklist with desktop and mobile screenshots.
  - `garrytan/browse` (gstack).
  - Autonoma's MIT planner and Checksum's open-source runtime (see Q3).
  - Sources: [search results incl. borghei SKILL.md](https://github.com/borghei/Claude-Skills/blob/main/engineering/qa-browser-automation/SKILL.md); [desktop-controller-skill](https://github.com/24kchengYe/desktop-controller-skill); [VoltAgent awesome-agent-skills](https://github.com/VoltAgent/awesome-agent-skills)
- **Benchmark harness:** `nsosio/web-agent-bench` compares browser tools using one Claude model. It could be used to measure Jev against agent-browser against Playwright MCP on the user's own pages. — [GitHub](https://github.com/nsosio/web-agent-bench)

### Inferences
- **Best fork base for the user's exact flow:** Autodesk's skill pipeline for the scenario format and report concept, combined with QA Scout's screenshot and report UX.
- **Possible fast executor:** a swap-in executor such as jev-browse or jev-ultrafast, or agent-browser or Playwright CLI if the user wants to avoid a third-party model.
- **Ready-made speed test:** damian87x's head-to-head bench script already compares a Jev path with a playwright-cli path for QA checks.

### Gaps
- I did not verify licenses, activity or quality for the "unverified leads" list.
- I did not search the official Anthropic plugin marketplace directly for QA plugins.
- I found no star count or last-commit date for the Autodesk and QA Scout repos beyond commit counts.
