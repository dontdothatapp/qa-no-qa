# Pass/Fail Assessment for UI Test Scenarios (screenshots + page state), as of Nov 2026

Scope: how a Claude Code visual-QA skill should decide whether a plain-language "expected result" was met after running a scenario in a browser. Covers: LLM/VLM judging accuracy and failure modes, hybrid deterministic + VLM checks, visual regression, judge prompting, cost per judgment, and screenshot capture. Research done 2026-11-15. Older items are flagged. Vendor claims are labelled as such.

---

## 1. LLM-as-judge on screenshots: accuracy and failure modes

### Takeaway
No public study measures VLMs on exactly this task (one end-state screenshot plus a short expected-result sentence). The closest independent evidence comes from web-agent success judging (2025 models). The best judges there agree with humans about 80-87% of the time, but precision tops out near 70% on harder trajectory benchmarks, and LLM judges have a documented bias toward saying "pass". Small text and small UI targets in large screenshots are a second known weak spot. A screenshot-only VLM verdict is useful evidence, but on its own it is not a reliable oracle.

### Cited Findings
**Closest independent benchmarks (web-agent "did the task succeed?" judging)**
- AgentRewardBench (Mila/McGill/Google DeepMind, arXiv 2504.08942, v2 Oct 2025) has 1,302 expert-annotated web-agent trajectories across 5 benchmarks, with 12 LLM judges evaluated. "No judge achieves above 70% precision." The best was GPT-4o with accessibility tree: 69.8% precision, 83.1% recall. Claude 3.7 Sonnet scored 68.8% with the a11y tree and 69.4% with screenshots. GPT-4o-mini scored 61.5% (a11y) and 64.5% (screenshot). So at least about 30% of trajectories the judges marked "success" were actually failures. Human inter-annotator agreement was 89.3%. — [AgentRewardBench](https://arxiv.org/html/2504.08942v2)
- In the same paper, rule-based (official benchmark) evaluation had 83.8% precision but only 55.9% recall. It rejects many real successes over "inconsequential differences" such as phrasing that differs from the expected string. The paper's examples: GPT-4o's true WebArena success was 42.3% versus 25.6% by rules, and VisualWebArena was 35.9% versus 17.4%. — [AgentRewardBench](https://arxiv.org/html/2504.08942v2)
- Input ablation (GPT-4o-mini judge), precision/recall/F1: a11y tree + screenshot 62.1/81.7/70.6; a11y only 61.5/86.1/71.7; screenshot only 64.5/78.3/70.8; neither 60.7/73.9/66.7. The authors' conclusion: "more information distracts rather than assists the judge." Screenshots gave higher precision and a11y trees gave higher recall. — [AgentRewardBench](https://arxiv.org/html/2504.08942v2)
- The AgentRewardBench judge error taxonomy has four categories:
  1. Grounding mismatch: the agent's reasoning misdescribes the screen, and a judge without screenshots believes it.
  2. Misleading agent reasoning: the agent claims success, for example says a filter was applied when it was not, and the judge is persuaded.
  3. Missed instruction details: for example, an item was added to the cart but not purchased.
  4. Misunderstanding action intents.

  — [AgentRewardBench](https://arxiv.org/html/2504.08942v2)
- WebJudge (Online-Mind2Web, OSU, arXiv 2504.01382): 300 tasks on 136 live sites. Agreement with humans: GPT-4o 83.6%, o4-mini 85.7% (success-rate gap 3.8%), fine-tuned WebJudge-7B 87.0%. Per-agent agreement for GPT-4o ranged from 79.1% to 86.7%. — [Online-Mind2Web paper](https://arxiv.org/html/2504.01382v4); [GitHub README](https://github.com/OSU-NLP-Group/Online-Mind2Web)
- WebJudge findings on how judges fail:
  - WebVoyager's evaluator relied on the agent's final answer, and hallucinated final answers "frequently [lead] to a high false positive rate".
  - Final-screenshot-only evaluators lose agreement as trajectories get longer.
  - o4-mini was "overly conservative", with low recall and a 10.5% success-rate gap on AgentRewardBench.
  - Prior auto-evaluation inflated results: a simple search agent scored 51% on WebVoyager versus 22% on Online-Mind2Web.

  — [Online-Mind2Web paper](https://arxiv.org/html/2504.01382v4)
- Average gap to human success rates on AgentRewardBench: rule-based 9.8 points, prior GPT-4o (a11y) judge 8.1, WebJudge (GPT-4o) 5.9. — [Online-Mind2Web paper](https://arxiv.org/html/2504.01382v4)

**Requirement or expected-result verification on GUIs (closest to the skill's task)**
- GUISpector (arXiv 2510.04791, Oct 2025) is an MLLM agent that verifies natural-language requirements and acceptance criteria (ACs) on GUI prototypes. Dataset: 150 requirements and 900 AC annotations across 5 apps. Human ground truth: Krippendorff's α 0.929, Cohen's κ 0.921. Reported F1: met ACs about 0.94, unmet ACs about 0.87. At requirement level: met 0.905, unmet 0.878, partially met 0.631. Reported cost was about $0.67 per requirement. These numbers come from secondary summaries of the paper; check them against the PDF before quoting. — [GUISpector PDF](https://arxiv.org/pdf/2510.04791); [summary](https://www.themoonlight.io/en/review/guispector-an-mllm-agent-framework-for-automated-verification-of-natural-language-requirements-in-gui-prototypes)
- AUITestAgent (arXiv 2407.09018, 2024, older) breaks test oracles into simpler verification points for MLLM function checking. — [AUITestAgent](https://arxiv.org/pdf/2407.09018)
- LLM-Guided Scenario-based GUI Testing (arXiv 2506.05079, v3 Oct 2025): a multimodal LLM judges app state from the current and previous screenshots, explicitly checks for loading states, and decides when a scenario is complete. v3 adds temporal screenshot analysis to catch brief popups. — [arXiv 2506.05079v3](https://arxiv.org/html/2506.05079v3)

**Bug-finding oracles (a harder task than spec checking, but they show the noise level)**
- Trident/VisionDroid (arXiv 2407.03037, IEEE TSE 2025): vision-driven non-crash functional bug detection on 590 bugs, with 50-72% precision and 42-52% recall. Secondary sources disagree on which of the reported improvement figures refer to precision and which to recall. — [arXiv 2407.03037](https://arxiv.org/abs/2407.03037v2)
- Ju et al. (APSEC 2024, older) used MLLMs as test oracles for non-crash functional bugs and reported a 49% detection rate. They list "performance degradation, inherent randomness, and false positives" as limitations. — [arXiv 2407.19053](https://arxiv.org/abs/2407.19053v1); [APSEC listing](https://conf.researchr.org/details/apsec-2024/apsec-2024-technical-track/33/A-Study-of-Using-Multimodal-LLMs-for-Non-Crash-Functional-Bug-Detection-in-Android-Ap)

**Bias toward "pass" (sycophancy / agreeableness)**
- "Beyond Consensus" (arXiv 2510.11822, Oct/Dec 2025) tested 14 LLM validators. True-positive rate was above 96%, but true-negative rate was usually below 25%: judges accept valid outputs and miss invalid ones. A "minority-veto" ensemble (flag the output if enough judges object) cut maximum error to 2.8%. A regression correction calibrated on a small human-labelled set is also proposed. Caveat: the domain is code-feedback validation, not UI screenshots. — [arXiv 2510.11822v2](https://arxiv.org/html/2510.11822v2)

**Small text and small targets**
- ScreenSpot-Pro (Apr 2025, ACM MM 2025) is a GUI grounding benchmark: 1,581 tasks on full high-resolution professional-app screenshots. The best model at launch scored 18.9%. Planner-guided cascaded visual search (ScreenSeekeR) reached 48.1% with no training. Icons are much harder than text. This is older and measures grounding rather than verification, but it shows that small targets in large screenshots are hard and that crop/zoom helps. — [ScreenSpot-Pro](https://arxiv.org/abs/2504.07981v1)
- A third-party 2026 leaderboard lists 79.3% without tools and 93.0% with tools. Entries are self-reported and unverified. — [benchmarklist ScreenSpot-Pro](https://benchmarklist.com/benchmarks/screenspot_pro/)

**Limitations stated by model vendors**
- Anthropic: Claude "might hallucinate or make mistakes when interpreting low-quality, rotated, or very small images under 200 pixels". Counts are approximate. Downscaling large images "might... make text less legible". "Heavy JPEG compression can make text difficult to read." — [Claude vision docs](https://platform.claude.com/docs/en/build-with-claude/vision)
- OpenAI: small text may be missed ("Enlarge it, and use `original` detail"). Object counts are approximate. Captions are occasionally wrong. Precise spatial tasks are weak. — [OpenAI vision guide](https://developers.openai.com/api/docs/guides/images-vision)

**Vendor practice**
- Momentic (vendor docs): AI `assert` steps check "the page and a screenshot of the viewport". Typos are tolerated by default, so exact text must be quoted. Assertion patterns that fail: ambiguous wording, multiple focuses, imperceptible details such as exact hex colours, subjective judgments, and time-sensitive claims. Its docs also say that if the mobile evaluator cannot return a result, the run "keeps its passed status". That is a fail-open design to avoid. — [Momentic: Writing assertions](https://momentic.ai/docs/prompting/writing-assertions)
- A comparison site says Momentic claims AI assertions cut false positives by 99%. This is a vendor claim with no independent verification found. — [TestSprite comparison](https://www.testsprite.com/use-cases/en/compare/momentic-vs-octomind)

### Inferences
- The skill's task (one end state, one short expected sentence) is easier than judging a full trajectory. Accuracy is probably above AgentRewardBench's roughly 70% precision, especially with 2026 models. But no measurement exists, so the skill should be calibrated on its own labelled cases.
- The AgentRewardBench failure modes map directly onto this skill:
  - **Do not feed the executing agent's own narration ("I clicked Annual and the prices updated") into the judge.** The judge should see only the evidence (screenshot, DOM/a11y facts, URL) plus the expected result. Otherwise "misleading agent reasoning" causes false passes.
  - **Break the expected result into key points** (WebJudge, AUITestAgent). Example: "prices show yearly totals" AND "'Save 20%' badge visible". Verify each point, so missed details cannot slip through.
- The agreeableness-bias evidence means a false **pass** is the main risk. A "fail" from a VLM is more trustworthy than a "pass". Options for cheaply raising confidence in a pass: require cited evidence for every key point; use a second, independent judge only when the first says pass (asymmetric checking); default to "needs review" when evidence is missing.
- **Failure modes not covered by any study found:**
  - Loading states: spinners or skeletons captured as the "result".
  - Stale state: the screenshot taken before a re-render.
  - Below-the-fold content missing from viewport shots.
  - Toasts that have already disappeared.
  - Overlays such as cookie banners and modals hiding the target.
  - Dark patterns.

  Each needs deterministic waits or DOM checks rather than better prompting.

### Gaps
- No published accuracy study (independent or vendor) of 2026-generation models (Claude 5.x, Gemini 3.x, GPT-5.x) as single-screenshot UI test oracles. All quantitative judge evidence above uses 2024-2025 models (GPT-4o, Claude 3.7, o4-mini).
- No independent data on Momentic, QA Wolf, Octomind or Applitools assertion accuracy. Only vendor claims or anecdotes were found.
- No sources specifically on VLM judging of dark patterns or of loading/skeleton states.
- GUISpector's exact protocol and numbers were not verified from the PDF (only from summaries).

---

## 2. Hybrid approaches: deterministic checks + VLM judgment, and LLM-compiled assertions

### Takeaway
Practitioners and Anthropic's own eval guidance agree: use deterministic graders wherever possible, and use the LLM only where the expected result is visual or semantic. The cheapest robust design has three steps:
1. Have the LLM translate the expected result once into concrete Playwright-style assertions (URL, text, visibility, ARIA snapshot with regex/partial matching).
2. Run those assertions for free on every run.
3. Call the VLM only for the visual remainder, or when assertions are ambiguous.

Exact-string assertions underreport success, so prefer regex and partial matching.

### Cited Findings
**Anthropic's eval guidance**
- Recommends "choosing deterministic graders where possible, LLM graders where necessary or for additional flexibility."
- Code graders are fast, cheap and reproducible, but "brittle to valid variations". LLM graders are non-deterministic, cost more, and need calibration against human experts.

— [Anthropic: Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)

- Anthropic says to grade outcomes and state, not paths: for WebArena, "confirming an order was actually placed, not just that the confirmation page appeared". OSWorld graders inspect "file system state, application configs, database contents, and UI element properties." — [Anthropic evals post](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
- Anthropic notes the token trade-off: "DOM-based interactions execute quickly but consume many tokens," while screenshots are "slower but more token-efficient". — [Anthropic evals post](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)

**Why rule-based checks fail: brittleness**
- Rule-based checks have high precision (83.8%) and low recall (55.9%), and they miss successes because of phrasing differences. — [AgentRewardBench](https://arxiv.org/html/2504.08942v2)

**Playwright deterministic primitives**
- `toHaveURL` accepts a string, RegExp, URLPattern or predicate. `toHaveTitle` accepts a string or RegExp. Assertions auto-retry until the timeout. — [Playwright PageAssertions](https://playwright.dev/docs/api/class-pageassertions)
- `toMatchAriaSnapshot` asserts the accessibility tree against a YAML template:
  - "A template is a constraint, not necessarily a complete serialization".
  - Supports partial matching (omit names/attributes), regex names (`- heading /Issues \d+/`), and children modes `contain` (default), `equal` and `deep-equal`.
  - Snapshots can be generated with `page.ariaSnapshot()`, codegen, or `--update-snapshots`.
  - Order-sensitive, case-sensitive, whitespace-normalized.

  — [Playwright ARIA snapshots](https://playwright.dev/docs/aria-snapshots)
- Playwright says not to use `networkidle` for testing: "rely on web assertions to assess readiness instead." — [Playwright Page API (goto waitUntil)](https://playwright.dev/docs/api/class-page)

**LLM-written deterministic tests in the Playwright ecosystem**
- Playwright v1.56 shipped Planner, Generator and Healer agents. The Generator turns a Markdown plan into Playwright code and checks selectors and assertions against the live app. The Healer patches broken tests. These are secondary sources, and they disagree on the Planner's exact role. — [Bug0: Playwright test agents](https://bug0.com/blog/playwright-test-agents); [Currents: Playwright AI ecosystem 2026](https://currents.dev/posts/state-of-playwright-ai-ecosystem-in-2026)

**Caching in AI-testing frameworks (assertions stay model-dependent)**
- Midscene caches AI *plans* by instruction, but "aiBoolean, aiQuery, aiAssert will never be cached", so every assertion calls the model again. — [Midscene caching docs](https://midscenejs.com/caching)
- Stagehand caches resolved selectors and validates them before reuse. On a cache miss it re-runs inference, which may produce different selectors. A common practitioner recommendation is Stagehand for semantic flows and plain Playwright for deterministic assertions. — [Browserbase: Stagehand caching](https://browserbase.com/blog/stagehand-caching); [Stagehand deterministic agents](https://www.mintlify.com/browserbase/stagehand/best-practices/deterministic-agents)

**Momentic's guidance on deterministic vs AI checks**
- For time-sensitive content, "Assert on DOM state instead." Assert durable outcomes, such as a populated table, not toasts or spinners. — [Momentic docs](https://momentic.ai/docs/prompting/writing-assertions)

### Inferences
- A suggested decision flow for each scenario (synthesis, not from a single source):
  1. **Gate checks, always free.** Navigation succeeded (no 4xx/5xx on the main document), no uncaught console errors, no error boundary or "Something went wrong" text, and the target page readiness assertion passed (a key element visible, no spinner). If a gate fails, the verdict is fail or "blocked" without any VLM call.
  2. **Compiled assertions.** On the first run (or when the scenario text changes), the LLM converts the expected result into key points. Each key point becomes, where possible, a Playwright assertion with regex/partial matching, for example `getByText(/Save\s*20%/)`, `toBeVisible`, or an ARIA snapshot fragment. Store them alongside the scenario, so re-runs pay nothing.
  3. **VLM judgment only for non-assertable key points.** Examples: layout, "looks like yearly totals", visual state, colour/contrast, and "is the badge actually visible and not clipped". Pass the screenshot plus a short text digest of the relevant DOM/a11y region.
  4. **Reconcile.** Any deterministic failure means fail, with evidence. Deterministic pass plus VLM pass means pass. Disagreement, or the VLM returning "uncertain", means needs review.
- Because AgentRewardBench found that a11y + screenshot can be worse than screenshot alone, keep the text context **targeted**: the subtree or snippet relevant to the key points, not a full a11y dump. Selecting relevant context is what helps WebJudge.
- LLM-compiled assertions have their own risk: the LLM may write an assertion that passes trivially, for example matching text that already exists in a hidden template. Show the compiled assertions in the report, so humans can review the oracle itself.

### Gaps
- No quantitative study found comparing the "LLM compiles assertions once" pattern against "VLM judges every run" for accuracy or cost.
- Not verified on official Playwright docs: whether v1.56+ test agents emit `toMatchAriaSnapshot` or `toBeVisible` by default, and their accuracy.

---

## 3. Visual regression testing (baseline diffs) as a complement

### Takeaway
Visual regression detects *change against an approved baseline*. It does not detect *correctness against an expected result*. It cannot judge a scenario's first run, and it needs a stable rendering environment. It fits as an optional second layer: after a scenario passes and a human approves its screenshot, later runs can diff against it to catch unintended layout regressions cheaply. Playwright's built-in `toHaveScreenshot` is free and sufficient for a local Claude Code skill. Hosted services charge per snapshot.

### Cited Findings
**Playwright `toHaveScreenshot`**
- Takes screenshots repeatedly "until two consecutive screenshots matched", then compares against the baseline.
- Baselines are named `<name>-<browser>-<platform>.png` because rendering differs across browsers and OSes.
- The docs warn that rendering varies by "host OS, version, settings, hardware", headless mode, and power source, and recommend running "in the same environment where the baseline screenshots were generated."

— [Playwright visual comparisons](https://playwright.dev/docs/test-snapshots)

- `toHaveScreenshot` defaults:
  - `animations: "disabled"`, `caret: "hide"`, `scale: "css"`, `fullPage: false`
  - `threshold: 0.2` (per-pixel colour tolerance, 0-1), `maskColor: #FF00FF`
  - `maxDiffPixels` and `maxDiffPixelRatio` come from config
  - Options include `mask` (Locators) and `stylePath`
  - The name must end in `.png` or `.webp`

  — [Playwright PageAssertions](https://playwright.dev/docs/api/class-pageassertions)
- With `animations: "disabled"`:
  - "finite animations are fast-forwarded to completion"
  - "infinite animations are canceled to initial state"

  `style` / `stylePath` inject CSS that "pierces the Shadow DOM" to hide dynamic elements. `mask` overlays a pink box and also applies to invisible elements. — [Playwright params.md (main branch)](https://github.com/microsoft/playwright/blob/main/docs/src/api/params.md)
- Hover effects get captured, so move the mouse away first (`page.mouse.move(-1,-1)`). — [Playwright visual comparisons](https://playwright.dev/docs/test-snapshots)

**Open-source alternatives**
- BackstopJS: `readySelector`, `readyEvent` and `delay` for readiness; `hideSelectors` and `removeSelectors` for ads and dynamic banners. — [QASkills BackstopJS guide](https://qaskills.sh/blog/backstopjs-visual-regression-testing-guide)
- Lost Pixel: open-source engine with masking, thresholds, and a `beforeScreenshot` hook for injecting styles. The source is the vendor's own promotional post. — [Lost Pixel blog](https://lost-pixel-landing.vercel.app/blog/post/handling-flaky-visual-regression-tests-with-lost-pixel-platform); [HelpMeTest on Lost Pixel](https://helpmetest.com/blog/lost-pixel-visual-regression/)

**Hosted pricing**
- Chromatic (official page, Nov 2026):

  | Plan | Price | Snapshots/month | Browsers / notes |
  |---|---|---|---|
  | Free | $0 | 5,000 | Chrome only |
  | Starter | $179/mo | 35,000 | 4 browsers; extra snapshots $0.008 each |
  | Pro | $399/mo | 85,000 | |
  | Enterprise | Custom | Custom | |

  TurboSnap counts unchanged snapshots at a fraction of the cost (a 5x "turbosnap equivalent"). — [Chromatic pricing](https://www.chromatic.com/pricing)
- Percy: about $199/mo billed annually for 10,000 screenshots, $0.036 per extra. Applitools Starter: about $667/mo billed annually, for 100,000 component or 1,000 page checkpoints. Figures conflict across sources: another says about $399/mo for 1,000 validations, and another says it is custom-quote only. Most of this comes from a competitor (Argos) via search summaries, not fetched from the vendor pages. — [Argos: visual testing pricing 2026](https://argos-ci.com/blog/visual-testing-pricing) (returned 404 when fetched; figures from search snippet); [checkthat.ai Applitools pricing](https://checkthat.ai/brands/applitools/pricing)
- Dynamic content is the most-cited cause of flaky visual tests. Standard fixes are masking regions, CSS injection to hide elements, and higher thresholds. — [DEV: why visual regression tests fail](https://dev.to/maria_bueno/why-your-visual-regression-tests-are-failing-and-how-to-fix-them-26kg); [QASkills BackstopJS guide](https://qaskills.sh/blog/backstopjs-visual-regression-testing-guide)

### Inferences
- For this skill, use visual diffs as an **opt-in "lock this screen" step**. When a user approves a passing screenshot, save it as the baseline. Later runs flag "changed vs approved" as a separate signal from pass/fail against the expected result. A pixel diff on a scenario whose expected result is a change (clicking "Annual" changes prices) would fail by design, so diff only the *end state* against an approved end state, never before against after.
- Baselines are environment-specific: local Mac versus CI Linux, and font differences. A skill running on each user's laptop should store baselines per machine/browser (Playwright already does this by name) and warn when they are compared across environments.
- Cost: Playwright local diffs are free and fast (milliseconds of CPU). Hosted Visual AI (Applitools) mainly adds cross-browser rendering grids and smarter diff noise suppression. For 50 scenarios × 1 viewport that fits Chromatic's free tier, but it is unlikely to be worth the integration work for a local skill.
- A pixel diff can also serve as a cheap pre-filter for the VLM. If the end state is pixel-identical (within threshold) to an approved passing baseline, reuse the previous verdict and skip the VLM call.

### Gaps
- No independent, quantitative measurement of Applitools Visual AI false-positive or negative rates versus pixel diffs was found (only vendor marketing).
- Percy and Applitools prices were not confirmed from the vendors' own pages.

---

## 4. Prompting and output design for a trustworthy judge

### Takeaway
Use a structured, evidence-first rubric:
- Decompose the expected result into key points.
- Ask the model to describe what it sees for each point (quoting visible text) before giving a verdict.
- Return `pass` / `fail` / `uncertain` per point and overall.
- Give an explicit "Unknown/needs review" way out.

Put the image before the text. Supply small targeted DOM/a11y text. Crop or zoom for small text instead of sending huge full-page images.

### Cited Findings
**Anthropic grader guidance**
- "Give the LLM a way out", for example by returning "Unknown" when information is insufficient, to reduce hallucination.
- Use "clear, structured rubrics" and grade "each dimension with an isolated LLM-as-judge rather than using one to grade all dimensions".
- "Vague rubrics produce inconsistent judgments".
- Calibrate against human experts. After that, "use human review only occasionally."

— [Anthropic evals post](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)

**Image placement and labelling**
- "Claude works best when images come before text". When sending several images, label them "Image 1:", "Image 2:". — [Claude vision docs](https://platform.claude.com/docs/en/build-with-claude/vision)
- Avoid heavy or repeated lossy compression for text-heavy images. Consider "pre-resizing your images, cropping them, or both", but avoid "cropping out key visual context solely to enlarge the text." — [Claude vision docs](https://platform.claude.com/docs/en/build-with-claude/vision)

**WebJudge's three-stage design**
1. Key-point identification.
2. Key-screenshot selection (relevance scored 1-5, keep ≥3; θ=3 gave the best agreement, 81.8%).
3. Outcome judgement.

The CoT judgement mode beat strict per-key-point judging when there were more than 3 key points (86.1% vs 76.3%), because generated key points are "not always accurate or necessary". — [Online-Mind2Web paper](https://arxiv.org/html/2504.01382v4)

**Momentic assertion-writing rules**
- "Aim for under 20 words; split compound assertions into multiple steps".
- "The answer should be clearly true or false given the page state". Use single quotes for exact text.
- Avoid transient elements, exact hex colours, and subjective claims.

— [Momentic docs](https://momentic.ai/docs/prompting/writing-assertions)

**Three-state verdicts and ensembles**
- GUISpector's "partially met" class had much lower F1 (0.631) than met/unmet (about 0.9). Partial verdicts are the least reliable. — [GUISpector summary](https://www.themoonlight.io/en/review/guispector-an-mllm-agent-framework-for-automated-verification-of-natural-language-requirements-in-gui-prototypes)
- A minority-veto ensemble (fail if any or enough judges object) counters judges' positive bias. — [arXiv 2510.11822v2](https://arxiv.org/html/2510.11822v2)

**Resolution and zoom controls**
- Gemini 3+ `media_resolution`: `low` 280 tokens, `medium` 560, `high` 1120 (default), `ultra_high` 2240 (per item only, aimed at "computer use"-type tasks). — [Gemini media resolution](https://aistudio.google.com/docs/media-resolution)
- OpenAI exposes `detail: low|high|original|auto` (default `auto`). `original` preserves dimensions on newer models and is recommended for small text. — [OpenAI vision guide](https://developers.openai.com/api/docs/guides/images-vision)
- Cascaded crop/zoom search raised small-target grounding from 18.9% to 48.1% on ScreenSpot-Pro (2025). — [ScreenSpot-Pro](https://arxiv.org/abs/2504.07981v1)

### Inferences
- Suggested judge output schema (synthesis of the sources above):

  ```json
  {"verdict":"pass|fail|needs_review",
   "key_points":[{"point":"Prices show yearly totals",
                  "status":"met|not_met|cannot_determine",
                  "evidence":"Visible text: '$192/year' under Pro card",
                  "source":"screenshot|dom|both"}],
   "blocking_issues":["cookie banner covers pricing cards"],
   "confidence":"high|medium|low"}
  ```

- Rules for the judge:
  - Overall `pass` only if every key point is `met` with quoted evidence.
  - Any `not_met` gives `fail`.
  - Any `cannot_determine`, a spinner or skeleton visible, or a modal covering the target gives `needs_review`.
- Require the evidence field to quote **visible text verbatim**, then cross-check the quote against DOM text deterministically. A cheap guard against invented evidence: if the quoted string is not in `document.body.innerText`, downgrade to `needs_review`.
- Ask for evidence *before* the verdict field (or use structured outputs ordered that way), so the verdict depends on the described evidence rather than being rationalized afterwards. This follows the CoT judgement mode in WebJudge.
- Use viewport screenshots for the judge by default, plus an element-level crop or `clip` of the region the key point refers to (for example, the pricing cards). Use full-page screenshots for the human-facing report, not as the primary judge input. A tall full-page image is downscaled (see section 5), which shrinks text.
- Show per-key-point verdicts in the report next to the screenshot. This makes the judge auditable and lets humans spot wrong oracles fast.

### Gaps
- No controlled study found on whether evidence-first ordering, or an explicit "uncertain" option, measurably reduces false passes for VLM UI judges. These practices are recommended by Anthropic and vendors but not measured for this task.
- No measured data found on how much a full a11y snapshot alongside the image helps or hurts 2026 models. The only data point is the 2025 GPT-4o-mini ablation, where it hurt slightly.

---

## 5. Cost per judgment (Claude vs Gemini Flash vs GPT mini/nano), Nov 2026 prices

### Takeaway
Image tokens are cheap at current prices. One 1280×800 screenshot is about 1,334 tokens on Claude, about 1,200 on GPT-5.4/5.6-family models, and 1,120 by default on Gemini 3+. Judging 50 scenarios (screenshot + about 1.5k tokens of text + about 300 output tokens each) costs about $0.02 on Claude Haiku 5.5, about $0.05 on Gemini 3.1 Flash-Lite or GPT-5.4-nano, about $0.43 on Claude Sonnet 5.5, and about $0.87 on Opus 5.5. Cost is not the constraint. Context growth and per-request image limits inside a Claude Code session matter more.

### Cited Findings
**Claude image tokens (current formula)**
- "Each patch is a 28×28-pixel block… An image… costs ⌈width / 28⌉ × ⌈height / 28⌉ visual tokens." The older rule of thumb (tokens ≈ width×height/750) is superseded but gives similar numbers. — [Claude vision docs](https://platform.claude.com/docs/en/build-with-claude/vision)
- Resolution tiers. Larger images are downscaled, preserving aspect ratio. — [Claude vision docs](https://platform.claude.com/docs/en/build-with-claude/vision)

  | Tier | Models | Max long edge | Max visual tokens |
  |---|---|---|---|
  | High-resolution | "Claude 4.7 and later models" | 2,576 px | 4,784 |
  | Standard | All others, e.g. Haiku 4.5 | 1,568 px | 1,568 |

- Documented examples. — [Claude vision docs](https://platform.claude.com/docs/en/build-with-claude/vision)

  | Image | Standard tier | High-res tier |
  |---|---|---|
  | 1000×1000 | 1,296 tokens | 1,296 tokens |
  | 1920×1080 | 1,560 tokens (downsized to 1456×819) | 2,691 tokens |
  | 3840×2160 | 1,560 tokens | 4,784 tokens (2576×1449) |

  - Cost examples: the 1000×1000 image is about $1.30 per 1,000 images on Haiku 4.5 ($1/MTok) and about $5.18 per 1,000 on Opus 5.5 ($4/MTok).
  - "High-resolution images can use up to roughly three times more visual tokens."
- Request limits:
  - 600 images per request (100 for 200k-context models).
  - Max 8000×8000 px.
  - 10 MB per image base64 on the Claude API (5 MB on Bedrock); 128 MB request limit.
  - JPEG, PNG, GIF (first frame) and WebP accepted.
  - **If a request has more than 20 images, a stricter per-image dimension limit applies. This counts "images from earlier conversation turns that you resend" and screenshots in `tool_result`. Keep each side ≤3,000 px to be safe.**
  - Oversized `tool_result` screenshots for computer/browser-use tools are rejected rather than downscaled.

  — [Claude vision docs](https://platform.claude.com/docs/en/build-with-claude/vision)

**Claude prices (per MTok, input/output)**
- Haiku 5.5: $0.10/$0.50 (prompts ≤100k tokens; $0.50/$2.50 above).
- Haiku 4.5: $1/$5.
- Sonnet 5.5: $2/$10 (cache hits $0.10). Sonnet 5: $2/$10, introductory pricing made standard. Sonnet 4.6: $3/$15.
- Opus 5.5: $4/$20. Opus 5 / 4.x: $5/$25.
- Fable 5.2: $8/$40.
- Batch API is 50% off. The Claude 4.7+ tokenizer produces about 30% more tokens for the same text.

— [Claude pricing](https://platform.claude.com/docs/en/about-claude/pricing)

**Gemini**
- Gemini 3/4 image tokens by `media_resolution`: default 1,120; low 280; medium 560; ultra_high 2,240. — [Gemini media resolution](https://aistudio.google.com/docs/media-resolution)
- Prices per MTok, input/output (image input billed at the text rate): — [Gemini pricing](https://aistudio.google.com/docs/pricing)

  | Model | Input | Output (incl. thinking) | Notes |
  |---|---|---|---|
  | Gemini 3.8 Flash | $0.75 | $3.75 | Through 2026-12-31, then $1.50 / $7.50 |
  | Gemini 3.5 Flash-Lite | $0.30 | $2.50 | |
  | Gemini 3.1 Flash-Lite | $0.25 | $1.50 | |
  | Gemini 3 Flash Preview | $0.50 | $3.00 | |
  | Gemini 2.5 Flash-Lite | $0.10 | $0.40 | |
  | Gemini 3.1 Pro Preview | $2.00 | $12.00 | |

  - Batch is 50% off.
  - Free tiers exist for most Flash and Flash-Lite models.
  - Gemini 2.5 Flash/Pro are deprecated: from 2026-12-01, 2.5 Flash routes to 3.5 Flash-Lite and 2.5 Pro routes to 3.8 Flash.

**OpenAI**
- Patch-based image tokens: `ceil(w/32)×ceil(h/32)` patches × a model multiplier:
  - 1.2 for gpt-5.4 / 5.4-mini / 5.4-nano / 5.5 / 5.6-* / 6-astra
  - 1.5 for gpt-5-nano
  - 1.62 for gpt-4.1-mini
- High detail allows up to 2,500 patches. Odd quirk: for the gpt-5.4 family, `low` uses a 2048-px max and a 6,144-patch budget, "so it can use more tokens than `high`". `auto` is the default.

— [OpenAI vision guide](https://developers.openai.com/api/docs/guides/images-vision)

- Prices per MTok, input/output: — [OpenAI pricing](https://developers.openai.com/api/docs/pricing)

  | Model | Input | Output | Notes |
  |---|---|---|---|
  | gpt-5.4-nano | $0.20 | $1.25 | |
  | gpt-5.4-mini | $0.75 | $4.50 | |
  | gpt-5.6-luna | $0.20 | $1.20 | |
  | gpt-5.6-terra | $2.00 | $12.00 | |
  | gpt-5.6-sol | $4.00 | $20.00 | Promo "until November 30, 2026" |
  | gpt-5-mini (deprecated) | $0.25 | $2.00 | |
  | gpt-5-nano | $0.05 | $0.40 | |

  Batch is 50% off.

### Inferences (computed estimates, not vendor-published)
**Image tokens for common captures**, using the formulas above. Resize results are approximate; Anthropic publishes the exact rule separately.
- **Claude**
  - 1280×800: 46×29 = **1,334 tokens** on both tiers.
  - 1440×900: 52×33 = 1,716 tokens on the high-res tier; downscaled to about 1,568 on the standard tier.
  - 390×844 mobile (CSS scale): 14×31 = **434 tokens**.
  - 1280×4000 full page:
    - High-res tier: downscaled to about 824×2576, about **2,760 tokens**. Text renders at about 64% size.
    - Standard tier: about 502×1568, about 1,008 tokens. Text at about 39% size, so small text likely becomes illegible.
  - 2560×1600 (DPR-2 capture of 1280×800): exceeds 4,784 tokens and gets downscaled. Use `scale: "css"`.
- **OpenAI** (5.4/5.6 family): 1280×800 → 40×25 = 1,000 patches × 1.2 = **1,200 tokens**. A 1280×4000 full page exceeds 2,500 patches, so it shrinks to about 2,500 patches, about 3,000 tokens.
- **Gemini 3+**: fixed 1,120 tokens per image at the default regardless of size, so tall full-page images lose detail.

**Per-judgment and 50-scenario estimates.** Assumptions: 1280×800 image + 1,500 input text tokens (instructions, scenario, key points, targeted DOM snippet) + 300 output tokens, no thinking tokens, standard (non-batch) pricing.

| Model | Per judgment | 50 scenarios |
|---|---|---|
| Claude Haiku 5.5 | ≈ $0.00043 | ≈ **$0.02** |
| Claude Haiku 4.5 | ≈ $0.0043 | ≈ $0.22 |
| Claude Sonnet 5.5 | ≈ $0.0087 | ≈ **$0.43** (full-page ≈ $0.58) |
| Claude Opus 5.5 | ≈ $0.0173 | ≈ $0.87 |
| Gemini 3.1 Flash-Lite | ≈ $0.0011 | ≈ **$0.055** |
| Gemini 3.8 Flash | ≈ $0.0031 | ≈ $0.15 (≈ $0.31 after Jan 2027) |
| GPT-5.4-nano / GPT-5.6-luna | ≈ $0.0009 | ≈ **$0.045** |
| GPT-5.4-mini | ≈ $0.0034 | ≈ $0.17 |

Batch API halves these, but adds latency that does not suit an interactive skill.

- Reasoning/"thinking" output tokens are billed as output on GPT-5.x and Gemini ("Output (incl. thinking)"). A judge that thinks for 2,000 tokens would multiply the output cost roughly 7×. Keep thinking effort low, or keep the evidence-first schema as the reasoning.
- **Claude Code-specific cost and limit implications.** If the skill judges inside the main Claude Code conversation, the judge is the session model (subscription usage, not separate API dollars). But every screenshot stays in context and is re-sent on each later turn: 50 × 1,334 ≈ 67k tokens of images alone. Past 20 images, the stricter per-image dimension limit applies to all images in the request. This argues for one of:
  - judging each scenario in a fresh subagent or headless call, or
  - judging with a direct API call to a cheap model (Haiku 5.5, Flash-Lite), keeping only the verdict JSON in the main context.
- Prompt caching of the fixed judge instructions (rubric, schema, examples) cuts the text part further. Cache hits are 0.05-0.1× the input price on Claude.

### Gaps
- Not confirmed from docs which resolution tier Claude Haiku 5.5 uses. "Claude 4.7 and later" implies high-res, but Haiku 5.5 is not named explicitly in the tier table.
- Gemini 2.5-generation image token rules (the legacy 258-tokens-per-768px-tile figure) could not be confirmed from the current docs page.
- No published latency figures per judgment were gathered. From general experience, small/flash models answer a single-image judgment in about 1-3 s, but this is unsourced.

---

## 6. Screenshot capture practicalities (readiness, full page, viewports, file sizes for the HTML report)

### Takeaway
- Wait on **web assertions** (the target element visible, the spinner gone), not `networkidle`, which Playwright discourages.
- Disable animations, hide the caret, and use `scale: "css"`.
- Mask volatile regions only for diffing, not for judging.
- For the report, store viewport shots as WebP (lossy q≈80) or JPEG q≈80. These measured 35-60% smaller than PNG, and lossy WebP beat JPEG at the same nominal quality.
- Send the model a lossless or high-quality version, because heavy compression hurts text reading.

### Cited Findings
**Readiness**
- `networkidle` is "DISCOURAGED… Don't use this method for testing, rely on web assertions to assess readiness instead." — [Playwright Page API](https://playwright.dev/docs/api/class-page)
- `toHaveScreenshot` waits for two consecutive identical screenshots, which gives a built-in stability check. — [Playwright visual comparisons](https://playwright.dev/docs/test-snapshots)

**`page.screenshot` options** — [Playwright params.md](https://github.com/microsoft/playwright/blob/main/docs/src/api/params.md)
- `type`: `png` (default), `jpeg`, or `webp`. `webp` appears in the main-branch docs; check the installed Playwright version.
- `quality`: JPEG default 80. For WebP, 100 (the default) is lossless and lower values are lossy.
- `fullPage`: false by default.
- `scale`: `"css"` gives one pixel per CSS pixel and "keep[s] screenshots small". `"device"` makes high-DPI shots "twice as large or even larger". The default is `device` for `page.screenshot` and `css` for `toHaveScreenshot`.
- `animations: "disabled"`, `caret: "hide"`, `mask`, `style` / `stylePath`, `clip`.

**Model-side guidance**
- Claude recommends pre-resizing and cropping, and warns that lossy compression "can introduce artifacts that are detrimental to model performance, especially when multiple compression passes are applied." — [Claude vision docs](https://platform.claude.com/docs/en/build-with-claude/vision)
- Momentic: avoid asserting on toasts and spinners that may vanish, assert durable outcomes, and use explicit Wait steps rather than waiting inside assertions. — [Momentic docs](https://momentic.ai/docs/prompting/writing-assertions)

**Measured file sizes (own measurement, this session)**
Setup: headless Chrome on macOS, 2026-11-15, DPR 1. Pages: playwright.dev/docs/intro and en.wikipedia.org/wiki/Software_testing. JPEG via Pillow; WebP via cwebp. The 1280×4000 captures are tall-viewport shots used as a proxy for full-page capture.

| Capture | PNG | JPEG q80 | JPEG q60 | WebP q80 (lossy) | WebP lossless |
|---|---|---|---|---|---|
| playwright.dev 1280×800 | 155 KB | 107 KB | 80 KB | 60 KB | 54 KB |
| wikipedia 1280×800 | 252 KB | 156 KB | 115 KB | 94 KB | 91 KB |
| playwright.dev 1280×4000 | 688 KB | 414 KB | 314 KB | 215 KB | 352 KB |
| wikipedia 1280×4000 | 991 KB | 667 KB | 495 KB | 413 KB | 338 KB |

**Third-party size figures** (vary widely by content)
- 1440×900 screenshot: JPEG about 320 KB, PNG about 800 KB, WebP about 210 KB. — [SavePage: PNG vs JPEG for screenshots](https://savepage.pages.dev/blog/png-vs-jpeg-for-screenshots); [Screenhance: PNG vs JPEG vs WebP](https://screenhance.com/blog/png-vs-jpeg-screenshots)
- A 1869×917 PNG of 1.2 MB versus 23 KB as WebP. — [Technically We Write](https://technicallywewrite.com/2025/04/08/webp)

### Inferences
**Capture recipe per scenario**
1. Run the steps.
2. Wait for a readiness assertion tied to the expected result: the key element visible, `[aria-busy=true]` and spinners gone, fonts loaded (`document.fonts.ready`).
3. Settle with a short `toHaveScreenshot`-style stability loop, or two identical consecutive captures.
4. Capture a viewport PNG at `scale: "css"` for the judge.
5. Capture an optional element `clip` for the key region.
6. Capture an optional full-page shot for the report only.

**Viewports.** Common choices are desktop 1280×800 or 1440×900, and mobile around 390×844 with device emulation (Playwright ships device descriptors). With CSS scale, a mobile shot costs only about 434 Claude tokens. These sizes are not sourced in this research and are common conventions.

**HTML report size**
- Base64 embedding inflates bytes by about 33%. 50 viewport shots as WebP q80 at about 60-95 KB is about 4-6 MB of base64 HTML. As PNG, it is about 10-17 MB.
- Full-page shots as PNG could reach about 35-65 MB.
- Prefer separate image files next to the HTML, or lossy WebP thumbnails that open to full size.
- If the report is published as a hosted page with a size cap (for example 16 MB), embedded PNG full-page shots will not fit.

**Do not mask regions in the screenshot sent to the judge** unless they are irrelevant. Masking is for pixel-diff stability, and masking a dynamic price would hide exactly what the expected result is about.

**Below-the-fold content.** If a key point's element is outside the viewport, scroll it into view (or `clip` to it) before capture, rather than relying on a downscaled full-page image. Record in the report which capture the verdict used.

### Gaps
- Playwright-native fullPage file sizes and `type: "webp"` availability in the latest stable release were not verified. The measurements above used Chrome's `--screenshot` with tall viewports.
- No authoritative source found on recommended viewport sizes for QA in 2026, or on the share of mobile vs desktop traffic.
- Not measured: how much JPEG q60-80 or lossy WebP degrades VLM text-reading accuracy on UI screenshots. Anthropic only warns qualitatively.
