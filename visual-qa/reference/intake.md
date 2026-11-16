# Intake: turn a pasted checklist into a scenario file

The person pastes whatever checklist they have. Turn it into `~/QA/scenarios/<topic>.yaml` (format: `reference/scenario-format.md`) and save the paste, verbatim, as `~/QA/scenarios/<topic>.checklist.txt`. Do not show either file to the person.

## 1. Read the paste

- **Background vs checks.** Facts, IDs, URLs, "I'm logged in as...", "the flag is ON" are background: put them in `notes`. Lines that say what should be true are checks.
- **Site.** Take `base_url` from the paste. If there is none, ask.
- **One check = one scenario.** A line that covers several pages ("apply / profile / talk") splits into one scenario per page. `source` is the original line, verbatim. `title` is short.
- **Untestable checks** (an email, a backend job, anything no page shows) still get a scenario, so they stay visible in the report: any one-line step, the right group, and `expected` = what was meant. List each as "won't test: ..." in your first message, and run `qa skip <id> --reason "..."` for it right after `start`.

## 2. Write each scenario

- **Steps find their own pages.** `start` is only a first page. Phrase steps as goals ("Search for listings in France and open one from a PBSA advertiser (IDs in the notes)", "Open the apply form; do not submit it"). Say "do not submit" in the step where the check must not send anything.
- **`relies_on`.** List every condition the expected result depends on that a page can show ("The listing's address is in France"), each with `after_step`, the 1-based step after which it is visible. Omit `after_step` for the final page. Keep each short and checkable from the page alone: the judge never sees `notes`, so never write "IDs in the notes" in a `what`. Any condition a step requires must be in `relies_on` or already settled by a question.
- **Conditions no page shows** (a setting in an admin tool, a record you cannot find) are not `relies_on`. They become questions (section 4), or a link from the person that settles them. When a link settles a condition, make that link the scenario's `start`, do not search for another page, and add a `relies_on` item naming something visible on that page that identifies the record (its title or ID).
- **Vague expectations** get a concrete, checkable reading, without asking. That is your call, not a question; the report shows it. The judge sees only the final page, so split two-moment checks: "can save" becomes steps that fill the form, `Click "Save"` and reload the page; `relies_on` has "A save confirmation shows" with `after_step` set to the Save step; `expected` is only what the reloaded page shows ("the saved values are still in the fields").
- **Logged-out checks** get `logged_out: true`. They need no group switch: when `groups` is defined, still give each one a `group`, the one whose other checks run nearest.
- **YAML style.** Write every list item in block style (`- what: ...` with `after_step: 1` on the next line), never `{...}`: a comma inside `{...}` silently cuts the text.

## 3. Groups

- Groups come from the setup a check needs: flag state, account role, switching roles. Skip `groups` when every check runs in the same setup.
- The first group is "as you are now", taken from what the paste says about the current state.
- Order groups for the fewest switches.
- Write `needs` as an instruction the person can follow ("Turn the feature flag ON and sign in as a landlord with a Not Paid and a Paid conversation"). It is shown at the pause before that group.

## 4. Ask, only when needed

Ask only for: a missing site URL; a data property no page shows (accept "a link to one of each"); a specific account or record the person must provide. Never ask what a page shows (for example whether a listing is in France).

Put all questions in one message, as a numbered list, each saying why you need it. If nothing is needed, send one line ("Running N checks in M groups. First group: ...") and start.

## Worked example

Paste (shortened):

> PBSA advertisers (nationality only visible on listings from these): e2f754ed-…, 3b7777a7-…
> 1. Flag OFF ☐ Apply / profile / talk — no nationality
> 2. Flag ON — Apply ☐ French listing → address + employment show
> 4. Flag ON — Landlord talk ☐ Not Paid + address filled → shows; nationality hidden
> Tests on https://stage3.env.housinganywhere.dev/, I'm logged in as a fresh user. Flag is ON.

Groups, in order: g1 flag ON, tenant as now (section 2); g2 flag ON, landlord (section 4); g3 flag OFF, landlord (talk); g4 flag OFF, tenant (apply, profile). Section 1 splits into three scenarios.

Questions (one message):

1. Which landlord account has a conversation in Not Paid and one in Paid state? Section 4 needs both and no page lists them.
2. Which PBSA listings have nationality on their unit type, and which don't? A link to one of each is enough; the unit-type setting is not visible on any page.

Scenario (the answer to question 2 gave a link to a PBSA listing in France whose unit type has nationality):

```yaml
topic: PBSA fields
base_url: https://stage3.env.housinganywhere.dev
notes: "PBSA advertiser IDs: e2f754ed-…, 3b7777a7-…"
groups:
  - id: g1
    needs: Turn the feature flag ON and sign in as the tenant you are using now
  - id: g2
    needs: Turn the feature flag ON and sign in as a landlord with a Not Paid and a Paid conversation
scenarios:
  - id: APPLY-FR
    group: g1
    title: Apply form on a French PBSA listing shows address and employment
    source: "☐ French listing → address + employment show"
    start: /room/pbsa-paris-example
    steps:
      - Check that the listing page is shown, with the listing title visible
      - Open the apply form; do not submit it
    relies_on:
      - what: The listing is titled "Studio near Sorbonne, Paris"
        after_step: 1
      - what: The listing's address is in France
        after_step: 1
    expected: The apply form shows address fields and employment fields
```

A signed-out check would add `logged_out: true` to its scenario and a `group`.

After writing the files, tell the person the counts, the first group, and any "won't test" lines.
