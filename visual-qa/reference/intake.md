# Intake: turn a pasted checklist into a scenario file

The person pastes whatever checklist they have. Turn it into `~/QA/scenarios/<topic>.yaml` (format: `reference/scenario-format.md`; read it, do not repeat it here) and save the paste, verbatim, as `~/QA/scenarios/<topic>.checklist.txt`. Do not show either file to the person.

## 1. Read the paste

- **Background vs checks.** Facts, IDs, URLs, "I'm logged in as...", "the flag is ON" are background: put them in `notes`. Lines that say what should be true are checks.
- **Site.** Take `base_url` from the paste. If there is none, ask.
- **One check = one scenario.** A line that covers several pages ("apply / profile / talk") splits into one scenario per page. `source` is the original line, verbatim. `title` is short.
- **Untestable checks** (an email, a backend job, anything no page shows) are not scenarios. List them as "won't test: ..." in your first message. After `start`, run `qa skip <id> --reason "..."` for them (give them a scenario so they can be skipped, with `expected` saying what was meant).

## 2. Write each scenario

- **Steps find their own pages.** `start` is only a first page. Phrase steps as goals ("Search for listings in France and open one from a PBSA advertiser (IDs in the notes)", "Open the apply form"). Add "Do not submit ..." where the check must not send anything.
- **`relies_on`.** List every condition the expected result depends on that a page can show ("The listing's address is in France"), each with `after_step`, the 1-based step after which it is visible. Omit `after_step` for the final page. Keep each short and checkable by looking at one page.
- **Conditions no page shows** (a setting in an admin tool, a record you cannot find) are not `relies_on`. They become questions (section 4), or a link from the person that settles them.
- **Vague expectations** get a concrete, checkable reading, without asking ("can save" becomes "after clicking Save a confirmation shows and the values are still there after reloading"). That is your call, not a question; the report shows it.
- **Logged-out checks** get `logged_out: true`. They need no group switch.

## 3. Groups

- Groups come from the setup a check needs: flag state, account role, switching roles. Skip `groups` when every check runs in the same setup.
- The first group is "as you are now", taken from what the paste says about the current state.
- Order groups for the fewest switches.
- Write `needs` as an instruction the person can follow ("Turn the feature flag ON and sign in as a landlord with a Not Paid and a Paid conversation"). It is shown at the pause before that group.

## 4. Ask, only when needed

Ask only for: a missing site URL; a data property no page shows (accept "a link to one of each"); a specific account or record the person must provide. Never ask what a page shows (for example whether a listing is in France).

Put all questions in one message, numbered, each saying why you need it. If nothing is needed, send one line ("Running N checks in M groups. First group: ...") and start.

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

Scenario:

```yaml
topic: PBSA fields
base_url: https://stage3.env.housinganywhere.dev
notes: "PBSA advertiser IDs: e2f754ed-…, 3b7777a7-…"
groups:
  - {id: g1, needs: Feature flag ON; signed in as the tenant you are using now}
  - {id: g2, needs: Feature flag ON; signed in as a landlord with a Not Paid and a Paid conversation}
scenarios:
  - id: APPLY-FR
    group: g1
    title: Apply form on a French listing shows address and employment
    source: "☐ French listing → address + employment show"
    start: /
    steps:
      - Search for listings in France and open one from a PBSA advertiser (IDs in the notes)
      - Open the apply form
      - Do not submit the application
    relies_on:
      - {what: The listing's address is in France, after_step: 1}
      - {what: The apply form is open}
    expected: The apply form shows address fields and employment fields
```

A signed-out check would add `logged_out: true` to its scenario.

After writing the files, tell the person the counts, the first group, and any "won't test" lines.
