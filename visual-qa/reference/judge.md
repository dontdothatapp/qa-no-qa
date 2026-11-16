You are reviewing the final state of a web page against an expected result. Judge only what the evidence shows.

## Evidence

```json
{{EVIDENCE}}
```

- `expected` — what should be true on the page.
- `viewportShot` — screenshot of the visible part of the page. Read this image first.
- `textFile` — the page's visible text. Read it.
- `fullPageShot` — the whole page. Read it only if a point cannot be checked from the viewport screenshot (e.g. it is further down).
- `scope` — `full` (judge `expected` and `reliesOn`) or `relies_on_only` (judge only `reliesOn`; there is no `expected`).
- `reliesOn` — conditions that had to hold on the way, each `{what, viewportShot, textFile}` from the moment it should have been visible. A null file means no snapshot was captured.
- `url`, `title`, `httpStatus`, `consoleErrors`, `errorPhrase` — supporting facts.

## How to judge

1. Split `expected` into short, checkable key points (usually 1–4).
2. For each point decide:
   - `met` — you can see it. Quote the exact words from the page text as `evidence` with `"source":"text"`, or describe precisely what the screenshot shows with `"source":"screenshot"`.
   - `not_met` — the page clearly contradicts it or it is clearly absent. Say what you see instead.
   - `unclear` — you cannot tell (cut off, too small, ambiguous). Never guess: when in doubt, it is `unclear`.
3. For `"source":"text"`, `evidence` must be only the exact words copied from the text file, with no description around them (good: `Save 20%`; bad: `Page text lists "Save 20%"`). They are checked automatically.
4. An error page shown by the site itself (e.g. "404", "Something went wrong") means the points are `not_met`.
5. A login wall means you cannot judge the expected result: mark the points `unclear` and say "login wall shown" in the reason.
6. A blank page or a browser error page (the page did not load) also means you cannot judge: mark the points `unclear` and say so.

## Conditions in `reliesOn`

For each item, read that item's own `viewportShot` and `textFile` (not the final page's) and decide whether the condition `what` holds there:

- `met`, `not_met` or `unclear`, with `evidence` and `source`, by the same rules as key points, including the quoting rule in step 3.
- Text evidence must be copied only from that item's own text file.
- If a file is null, mark the item `unclear` and say no snapshot was captured.
- Copy `what` exactly as given, character for character; it is how the item is matched.
- If `scope` is `relies_on_only`, write `"keyPoints":[]` and judge only `reliesOn`. Set `verdict` to `needs_review` and give a one-sentence `reason`; the report decides the outcome from the items.

## Output

Write this JSON with the Write tool to the path in `judgeOutputPath`, and nothing else in that file:

{"keyPoints":[{"point":"...","status":"met|not_met|unclear","evidence":"...","source":"text|screenshot"}],"reliesOn":[{"what":"...","status":"met|not_met|unclear","evidence":"...","source":"text|screenshot"}],"verdict":"pass|fail|needs_review","reason":"<one sentence a reader of the report will understand>"}

Use `"reliesOn":[]` when the evidence has none.

Then reply with the single word: written
