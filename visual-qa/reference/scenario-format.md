# Scenario file format

One YAML file per test topic. The topic names the report folder: `~/QA/<YYYY-MM-DD> <topic>/`.

```yaml
topic: Checkout flow                    # required
base_url: https://staging.example.com   # required; scenario `start` paths are resolved against it
browser: chrome                         # optional: chrome (default) = tabs in your running Chrome, with your sign-ins
                                        #           isolated = a separate invisible browser (use `session` for logins)
viewport: {width: 1280, height: 800}    # optional (default shown)
session: staging-user                   # optional, isolated mode only: saved login (`qa login <name> <url>`)
allow_hosts: [staging.example.com]      # optional (default: the base_url host); leaving them hands back to Claude
judge_model: sonnet                     # optional: sonnet | haiku | opus
scenarios:
  - id: CO-01                           # letters, digits, - and _ only; unique
    title: Guest can reach the payment step
    # session: none                     # isolated mode only: per-scenario override; none = logged out
    start: /products/backpack           # path or full URL
    steps:                              # 1 step = 1 small goal; 3–5 steps per scenario is ideal
      - Click "Add to cart"
      - Open the cart and click "Checkout"
      - Fill the shipping form
      - Click "Continue"
    values:                             # optional: text to type, by field label
      Full name: Test User
      Postcode: "10115"
    expected: Payment form is visible with card fields; order summary shows 1 item
```

## Writing good scenarios

- **Self-contained.** Steps must create whatever the expected result depends on (e.g. add the item before checking the cart).
  - In `browser: chrome` (default) scenarios run as tabs in your Chrome and **share your sign-ins and site state** — a cart filled by one scenario is still full in the next. Put any reset in the steps (e.g. "Empty the cart"), or use `browser: isolated` when a clean state matters more than your sign-ins.
  - In `browser: isolated` every scenario starts in a fresh browser; only a saved `session` carries over.
- **One goal per step**, phrased as an instruction: `Click "Checkout"`, `Search for "espresso"`, `Select "Annual" in the plan dropdown`.
- **Quote exact button or link text** with double quotes. A single quoted value in a typing step (`Search for "espresso"`) is typed as-is.
- **Say when to submit.** Forms are only submitted when a step asks for it.
- **Values** go in `values` (field label → text). Unspecified fields may be filled with obviously fake test data by Claude, and those values are listed in the report.
- **Expected results must be observable** on the final page: visible text, elements, layout. Split several checks with `;`.
- **Quote text that contains `: `** (colon + space), e.g. `expected: 'Cart shows "Cart: 1"'`, or YAML will reject the file.
- **No passwords.** Passwords are not supported: keys like `Password`, `PIN` or `Passcode` in `values` are rejected, and password fields are never filled. Scenarios behind a login use a signed-in session instead.
