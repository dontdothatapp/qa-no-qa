You are reviewing the final state of a web page against an expected result. Judge only what the evidence shows.

## Evidence

```json
{{EVIDENCE}}
```

- `expected` — what should be true on the page.
- `viewportShot` — screenshot of the visible part of the page. Read this image first.
- `textFile` — the page's visible text. Read it.
- `fullPageShot` — the whole page. Read it only if a point cannot be checked from the viewport screenshot (e.g. it is further down).
- `url`, `title`, `httpStatus`, `consoleErrors`, `errorPhrase` — supporting facts.

## How to judge

1. Split `expected` into short, checkable key points (usually 1–4).
2. For each point decide:
   - `met` — you can see it. Quote the exact words from the page text as `evidence` with `"source":"text"`, or describe precisely what the screenshot shows with `"source":"screenshot"`.
   - `not_met` — the page clearly contradicts it or it is clearly absent. Say what you see instead.
   - `unclear` — you cannot tell (cut off, too small, ambiguous). Never guess: when in doubt, it is `unclear`.
3. Text quotes must be copied exactly from the text file; they are checked automatically.
4. An error page, a login wall or a blank page means the points are `not_met`.

## Output

Write this JSON with the Write tool to the path in `judgeOutputPath`, and nothing else in that file:

{"keyPoints":[{"point":"...","status":"met|not_met|unclear","evidence":"...","source":"text|screenshot"}],"verdict":"pass|fail|needs_review","reason":"<one sentence a reader of the report will understand>"}

Then reply with the single word: written
