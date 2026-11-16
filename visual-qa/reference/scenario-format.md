# Scenario file format

One YAML file per test topic. The topic names the report folder: `~/QA/<YYYY-MM-DD> <topic>/`.

```yaml
topic: Checkout flow                    # required
base_url: https://staging.example.com   # required; scenario `start` paths are resolved against it
viewport: {width: 1280, height: 800}    # optional (default shown)
allow_hosts: [staging.example.com]      # optional (default: the base_url host); leaving them hands back to Claude
judge_model: sonnet                     # optional: sonnet | haiku | opus
notes: "Test IDs: 123, 456"             # optional: free text from the checklist, shown in the report
groups:                                 # optional: batches that need the same setup, run one after another
  - id: flag-on
    needs: Feature flag ON
  - id: flag-off
    needs: Feature flag OFF
scenarios:
  - id: CO-01                           # letters, digits, - and _ only; unique
    title: Guest can reach the payment step
    group: flag-on                      # required when `groups` is defined; must match a group id
    source: "☐ Guest reaches payment"   # optional: the checklist line, verbatim
    logged_out: true                    # optional (default false): run without your Chrome sign-ins
    start: /products/backpack           # path or full URL
    steps:                              # 1 step = 1 small goal; 3–5 steps per scenario is ideal
      - Click "Add to cart"
      - Open the cart and click "Checkout"
      - Fill the shipping form
      - Click "Continue"
    relies_on:                          # optional: conditions the page can show, so the report can say if one was missing
      - what: The cart holds 1 item
        after_step: 2                   # 1-based step after which it is visible
      - what: Order summary is shown    # no after_step = on the final page
    values:                             # optional: text to type, by field label
      Full name: Test User
      Postcode: "10115"
    expected: Payment form is visible with card fields; order summary shows 1 item
```

`browser:` and `session:` (file level or per scenario) are no longer supported and are rejected with a message. Tests always run in your Chrome with your sign-ins; use `logged_out: true` for signed-out tests.

## Writing good scenarios

- **One check = one scenario.** Don't bundle several checklist lines into one scenario.
- **Steps find their own pages.** `start` is only the first page; later steps navigate by clicking, not by assuming a URL.
- **Self-contained.** Steps must create whatever the expected result depends on (e.g. add the item before checking the cart). Scenarios run as tabs in your Chrome and share your sign-ins and site state, so put any reset in the steps (e.g. "Empty the cart").
- **`relies_on` lists conditions the page can show** (e.g. "The listing is in France") together with the step after which each is visible, so a failure can be traced to a missing precondition rather than a bug.
- **`source` is the checklist line, verbatim**, so the report can point back to it.
- **One goal per step**, phrased as an instruction: `Click "Checkout"`, `Search for "espresso"`, `Select "Annual" in the plan dropdown`.
- **Quote exact button or link text** with double quotes. A single quoted value in a typing step (`Search for "espresso"`) is typed as-is.
- **Say when to submit.** Forms are only submitted when a step asks for it.
- **Values** go in `values` (field label → text). Unspecified fields may be filled with obviously fake test data by Claude, and those values are listed in the report.
- **Files to upload** go in `values` too (e.g. `Attachment: files/invoice.pdf`); a relative path is relative to the scenario file.
- **Expected results must be observable** on the final page: visible text, elements, layout. Split several checks with `;`.
- **Quote text that contains `: `** (colon + space), e.g. `expected: 'Cart shows "Cart: 1"'`, or YAML will reject the file.
- **No passwords.** Passwords are not supported: keys like `Password`, `PIN` or `Passcode` in `values` are rejected, and password fields are never filled. Scenarios behind a login use your own signed-in Chrome.
