# e2e/rig — browser and wallet measurement rig

Local-only measurement infrastructure. Nothing here ships: the directory has no
import edge into `apps/`, `packages/`, `convex/` or `scripts/`, and the repo's
`typecheck` and `lint` globs do not include `e2e/`.

The rig answers one question mechanically: **what does it cost a person to get
done in this app, and what does the page do to them while they do it.** It
measures that the same way before and after a change, so a Wave 4 AFTER capture
is diffable against a Wave 3 BEFORE capture without anybody re-deriving the
method.

## What is measured

`instrumentation.mjs` records, per the goal's definition, into
`window.__MILO_RIG__`:

| counter | how it is observed |
| --- | --- |
| clicks / taps | trusted `click` and `pointerdown` on an interactive element |
| form fields filled | `input`/`change` on `input`, `select`, `textarea`; the field's identity and value **length** only |
| discrete non-content keypresses | `keydown` for Tab, Enter, Escape, arrows, Home, End, PageUp/Down, Backspace, Delete |
| page navigations | one record per document load |
| route changes | `pushState`, `replaceState`, `popstate`, `hashchange`, plus the initial route |
| wallet approvals | the `window.midnight` registry is trapped and each `connect()` call is recorded as request, approval, rejection or error |
| confirmation dialogs | `MutationObserver` over `[role=dialog]`, `dialog[open]`, `.dialog-content` |
| scrolls-to-find | scroll and wheel events, counted only up to the goal |
| time to goal | `markGoal()` sets a wall-clock anchor supplied by the runner, so it survives a navigation |

Alongside the counters each run writes `trace.zip`, `video.webm`, a screenshot
per step, `network.har` (request count and bytes), console errors, page errors
and axe-core violations for the route under test.

Median and p95 are computed over the runs of a flow by `click-cost.mjs`. At
least five runs are required; the runner refuses fewer.

Form values are never recorded. A field contributes its name, its type and its
current value length, so filling a form with anything sensitive still leaves no
content in an evidence file.

## Files

| File | Role |
| --- | --- |
| `env.mjs` | resolves and validates the whole environment, or fails with every missing piece and the command that fixes it |
| `instrumentation.mjs` | the browser-side init script, plus the counter and percentile functions |
| `click-cost.mjs` | folds events + HAR + axe into one comparable record, and diffs two captures |
| `flows.mjs` | the B1 flow catalog, the single source for both `b1-flows.csv` and the table below |
| `run-flow.mjs` | the CLI: `--list`, `--flow`, `--all`, `--runs`, `--serve`, `--headed`, `--xvfb`, `--extension`, `--wallet-evidence` |
| `wallet.mjs` | the three-attempt wallet ladder and the labelled mock wallet |
| `b1-flows.csv` | machine-readable B1, regenerated on every run |

## Running it

```sh
# one flow, five runs
node e2e/rig/run-flow.mjs --flow B1-F013 --runs 5

# the whole catalog, starting the dev server itself
node e2e/rig/run-flow.mjs --serve --all --runs 5 --label before

# against a dev server that is already up
bun run dev &                     # scripts/dev.ts, hardcoded port 3000
socat TCP-LISTEN:22000,fork TCP:127.0.0.1:3000 &
node e2e/rig/run-flow.mjs --flow B1-F022 --runs 5
```

Output lands in `e2e/rig/out/<label>/`, and `b1-flows.csv` is rewritten there
with the observed medians next to the declared click costs.

## Browser selection, and the `--load-extension` finding

`env.mjs` resolves the browser from `MILO_CHROME_PATH`, then from Playwright's
local Chromium under `$PLAYWRIGHT_BROWSERS_PATH`, then from `/usr/bin`. It reads
the binary's own `--version` and refuses an extension run against a build that
cannot load one.

Measured on this host, same `--disable-extensions-except` / `--load-extension`
arguments in every case:

| browser | version | brand | headed + Xvfb | headless |
| --- | --- | --- | --- | --- |
| `/usr/bin/google-chrome` | 154.0.8037.92 | Google Chrome | extension **not loaded** (`chrome://extensions` lists 0 items) | not loaded |
| Playwright `chromium-1243` | 153.0.8010.12 | Chromium | extension **loaded** | **not loaded** |

Two separate constraints, both confirmed with a positive control (a page that
registers a service worker did show up in `context.serviceWorkers()`, so the
detection works):

1. Branded Chrome has ignored `--load-extension` since Chrome 137. The
   mitigation Chromium / Chrome for Testing keeps it is to use a non-branded
   build.
2. Even a non-branded Chromium ignores it in headless mode. An extension run
   needs `headless: false` plus a real display, which is what `--xvfb` provides.

So the rig uses Playwright's Chromium headed under Xvfb whenever
`MILO_RIG_EXTENSION_DIR` is set, and refuses any other combination with a
message naming both constraints.

## Privy

`apps/web/src/qa-privy-mock.tsx` reads `globalThis.__QA_PRIVY__`, so the rig can
publish that shape from an init script for any flow with `auth:
"qa-privy-mock"`. That mock module is owned by another agent this wave and is
not edited here. Note that it is not currently wired into any build: nothing
aliases `@privy-io/react-auth` to it, and the QA bundle it exists for
(`apps/web/public/qa-build/qa-reserve-ui.js`) is not produced by any script in
the tree. Until that lands, the mock only takes effect for a harness that
imports the module directly. `wallet.mjs`'s `privyLaneStatus` records the real
lane separately, and never reads a secret value.

## Wallet

The connector truth is read from the code, not from the vendor:

- `packages/midnight-client/src/wallet.ts:57` keeps only `apiVersion` matching
  `/^4\./`
- `packages/midnight-client/src/wallet.ts:129` connects with
  `SUPPORTED_MIDNIGHT_NETWORK`
- `packages/midnight-client/src/network.ts` accepts PREPROD only

```sh
node e2e/rig/run-flow.mjs --serve --flow B1-F022 B1-F022N B1-F023 B1-F023N \
  B1-F024 B1-F024N --runs 5 --wallet-evidence --fetch-lace
```

writes `wallet-evidence.json` next to the run output. The three attempts, in the
order the goal requires, are all in `wallet.mjs`.

**Attempt 1, real Lace against PREPROD: BLOCKED_EXT, three precise steps.**
What worked, all measured: the official CRX downloads from the Chrome Web
Store's own update endpoint (Lace 2.4.2, 51711534 bytes, sha256
`447cdd271c0435d60f2656bf13019e22ec69733ca83101396e46700814d82408`), the CRX3
payload unpacks to a loadable directory, Chromium 153 headed under Xvfb loads it,
the extension injects `window.midnight` with `apiVersion "4.0.1"` and a
`connect()`, and the product discovers it — `apps/web/src/Connections.tsx`
`LaceStatus` rendered the button "Connect lace". That confirms the version match
the code demands, from the vendor's own bytes.

What did not: `connect("preprod")` never returned a status. Three blockers, each
with its own unblock:

1. **Funding.** The official preprod faucet serves 200, but its bundle calls
   `client.requestTokens(address, captchaToken)` against a Cloudflare Turnstile
   widget, so a human has to solve a captcha before any tNIGHT is issued. Unblock:
   a human opens the faucet, solves the challenge, pastes the throwaway
   *unshielded* `mn_addr_preprod1...` address, and requests 1000 tNIGHT.
2. **Onboarding.** The loaded extension holds no wallet account. Creating or
   restoring one, with its passphrase and 24-word recovery phrase, only happens
   inside the extension UI. Unblock: a human completes onboarding in the rig's
   Chromium profile and leaves the wallet unlocked on PREPROD. The rig never
   reads or logs the phrase, and no seed phrase appears in any evidence file.
3. **Browser.** Branded Chrome 154 cannot load the extension at all. Unblock:
   use the Chromium build the rig installs, headed under Xvfb.

**Attempt 2, the repo's local Midnight lane: reachable, not run this wave.**
`scripts/setup-native-services.py` extracts the pinned indexer and proof-server
executables *without a container runtime*, so Docker is not on this lane's
critical path — the Wave 1 note that it needs Docker does not hold for this
repo. What it needs is reachable from this host: the pinned Node 24.20.0 tarball
and the pinned midnight-node 1.0.0 release both answer 200, and `npm ci` inside
`packages/integration` is the only remaining dependency. It was left for a wave
that can hold the single heavy slot for as long as real proof generation takes;
the command is `bun run test:native-network`.

**Attempt 3, the mock wallet: secondary evidence, never counted as
verification.** It conforms to the same dapp-connector-api v4 surface
`discoverWallets` filters for, so it exercises the product's fail-closed PREPROD
checks with no key material at all. Its own `name` says it is not a real wallet,
the flow's `wallet_mode` column says `mock-*`, and the output file carries a
`disclaimer` that says it is not wallet verification. All six wallet flows
(B1-F022 through B1-F024N) pass 5/5 against it, covering connect, disconnect,
absent, reject, locked and wrong-network.

**Privy: BLOCKED_EXT.** `.env.local` does not exist, so `PRIVY_APP_ID` and
`PRIVY_APP_SECRET` are unset and `scripts/privy-test-login.ts` exits 1 with
`missing_config`. Unblock: the owner pastes both into `.env.local` and enables
test accounts in the Privy dashboard (User management → Authentication →
Advanced → Enable test accounts). `wallet.mjs` records the file's presence and
the script's exit code, never a value.

## B1 flow inventory

80 rows: 40 flows and 40 negative or edge twins. Regenerate with
`node -e "import('./e2e/rig/flows.mjs').then(m=>console.log(m.toCsv()))"`, or
read `b1-flows.csv`.

| id | group | route | goal | negative twin | wallet | declared clicks |
| --- | --- | --- | --- | --- | --- | --- |
| B1-F001 | public-landing | `/` | Reach the guided sample from the static landing hero | B1-F001N | none | 1 |
| B1-F001N | public-landing | `/` | Header nav reaches the how-it-works page, not the demo | B1-F001 | none | 1 |
| B1-F002 | public-landing | `/` | Footer navigation reaches privacy, terms and pilot status | B1-F002N | none | 3 |
| B1-F002N | public-landing | `/` | Unknown landing subpath renders the not-found surface, not a blank page | B1-F002 | none | 0 |
| B1-F003 | public-info | `/how-it-works` | Read the process page and reach the demo from its body CTA | B1-F003N | none | 1 |
| B1-F003N | public-info | `/sign-in` | The sign-in page points at the live diagnostics instead of a dead form | B1-F003 | none | 1 |
| B1-F004 | demo | `/demo` | Walk the four sample steps to the outcome panel | B1-F004N | none | 3 |
| B1-F004N | demo | `/demo` | Replaying the sample resets every panel it advanced | B1-F004 | none | 5 |
| B1-F005 | demo | `/demo` | Switch sample context without losing the browser Back button | B1-F005N | none | 0 |
| B1-F005N | demo | `/demo` | Zooming an image is a toggle, not a navigation | B1-F005 | none | 3 |
| B1-F006 | demo | `/m/north-studio` | The studio page reaches the sample agreement | B1-F006N | none | 1 |
| B1-F006N | demo | `/privacy` | Privacy copy links onward to the sample rather than a sign-up wall | B1-F006 | none | 1 |
| B1-F007 | workspace-nav | `/orders` | Open the sample order from the orders list | B1-F007N | none | 1 |
| B1-F007N | workspace-nav | `/orders/sample-002` | An unbound order id renders not-found instead of an empty shell | B1-F007 | none | 0 |
| B1-F008 | workspace-nav | `/orders/sample-001` | Reach every workspace destination from the sidebar | B1-F008N | none | 5 |
| B1-F008N | workspace-nav | `/orders/sample-001` | The sidebar collapse toggle hides the nav text and can be reversed | B1-F008 | none | 2 |
| B1-F009 | workspace-nav | `/orders/sample-001` | The sample controls switch scenario and perspective without a page load | B1-F009N | none | 1 |
| B1-F009N | workspace-nav | `/orders/sample-001` | Resetting a scenario returns it to its declared start state | B1-F009 | none | 2 |
| B1-F010 | order-happy | `/quotes/sample-001` | Prepare the device, verify the recovery kit and authorize the hold | B1-F010N | none | 3 |
| B1-F010N | order-happy | `/quotes/sample-001` | The hold cannot be authorized before the recovery kit is verified | B1-F010 | none | 0 |
| B1-F011 | order-happy | `/quotes/sample-001` | Deploy the bootstrap and reserve the terms through the reserve dialog | B1-F011N | none | 6 |
| B1-F011N | order-happy | `/quotes/sample-001` | Backing out of the reserve dialog changes nothing | B1-F011 | none | 6 |
| B1-F012 | order-happy | `/orders/sample-001` | The merchant accepts a reserved order, then submits the delivery | B1-F012N | none | 11 |
| B1-F012N | order-happy | `/orders/sample-001` | The buyer cannot accept on the merchant's behalf | B1-F012 | none | 6 |
| B1-F013 | order-happy | `/orders/sample-001` | The buyer verifies the three files and approves the delivery | B1-F013N | none | 4 |
| B1-F013N | order-happy | `/orders/sample-001` | Approval is refused until the consent checkbox is ticked | B1-F013 | none | 2 |
| B1-F014 | order-happy | `/orders/sample-001` | The buyer inspects a delivery image in the lightbox and walks it | B1-F014N | none | 3 |
| B1-F014N | order-happy | `/orders/sample-001` | Closing the image dialog returns focus to the control that opened it | B1-F014 | none | 2 |
| B1-F015 | order-happy | `/orders/sample-001` | Read the agreed scope and the verification evidence panels | B1-F015N | none | 2 |
| B1-F015N | order-happy | `/orders/sample-001` | The exported receipt states it is not a chain or payment record | B1-F015 | none | 0 |
| B1-F016 | order-dispute | `/operator/cases` | The resolution desk opens the sample dispute case | B1-F016N | none | 1 |
| B1-F016N | order-dispute | `/operator/cases` | The buyer cannot resolve a dispute; the role gate offers the switch instead | B1-F016 | none | 0 |
| B1-F017 | order-dispute | `/operator/cases/sample-001` | The operator resolves the dispute for full approval | B1-F017N | none | 2 |
| B1-F017N | order-dispute | `/operator/cases/sample-001` | Resolving for cancellation closes the order and offers the record | B1-F017 | none | 2 |
| B1-F018 | order-dispute | `/orders/sample-001` | The buyer opens a dispute from the review action instead of approving | B1-F018N | none | 2 |
| B1-F018N | order-dispute | `/orders/sample-001` | A too-short dispute reason cannot be submitted | B1-F018 | none | 1 |
| B1-F019 | quote-new | `/merchant/quotes/new` | The merchant prepares a sample quote and reviews it | B1-F019N | none | 1 |
| B1-F019N | quote-new | `/merchant/quotes/new` | An invalid quote is rejected with the field rules, not a silent reset | B1-F019 | none | 1 |
| B1-F020 | quote-new | `/merchant/quotes/new` | A corrected quote replaces the sample and reaches the agreement | B1-F020N | none | 1 |
| B1-F020N | quote-new | `/merchant/quotes/new` | A non-merchant is gated out of the quote form | B1-F020 | none | 0 |
| B1-F021 | account | `/account` | The account page reaches diagnostics and the lost-capability deep link | B1-F021N | none | 2 |
| B1-F021N | account | `/orders/sample-001` | A lost capability can be restored locally, and doing so does not sign anything in | B1-F021 | none | 1 |
| B1-F022 | wallet | `/connections` | Connect a wallet that approves on PREPROD | B1-F022N | mock-connected | 3 |
| B1-F022N | wallet | `/connections` | A wallet that is not injected cannot be connected at all | B1-F022 | none | 2 |
| B1-F023 | wallet | `/connections` | A wallet that rejects the connection reports a rejection, not a success | B1-F023N | mock-reject | 2 |
| B1-F023N | wallet | `/connections` | A locked wallet is refused with the locked-wallet reason | B1-F023 | mock-locked | 2 |
| B1-F024 | wallet | `/connections` | A wallet on mainnet is blocked even though it answers the API | B1-F024N | mock-wrong-network | 2 |
| B1-F024N | wallet | `/connections` | Two injected wallets require an explicit choice, not a silent first pick | B1-F024 | mock-two | 0 |
| B1-F025 | diagnostics-auth | `/connections` | With no Privy app id the diagnostics say so instead of a blank panel | B1-F025N | none | 0 |
| B1-F025N | diagnostics-auth | `/connections` | A failing public-config surfaces a retry, not an infinite spinner | B1-F025 | none | 0 |
| B1-F026 | diagnostics-auth | `/connections` | Losing the network mid-page leaves an honest error rather than a blank panel | B1-F026N | none | 0 |
| B1-F026N | diagnostics-auth | `/connections` | Coming back online and retrying recovers the diagnostics page | B1-F026 | none | 1 |
| B1-F027 | diagnostics-auth | `/connections` | The diagnostics page warns against pasting key material into Milo | B1-F027N | none | 0 |
| B1-F027N | diagnostics-auth | `/orders/sample-001` | The order page states it is synthetic and asks for no wallet | B1-F027 | none | 0 |
| B1-F028 | payment | `/orders/sample-001` | An authorized hold is shown as authorized, not captured | B1-F028N | none | 0 |
| B1-F028N | payment | `/orders/sample-001` | An expired hold blocks approval but never hides the delivery | B1-F028 | none | 0 |
| B1-F029 | payment | `/orders/sample-001` | Capture is the operator's separate observation, not part of approval | B1-F029N | none | 2 |
| B1-F029N | payment | `/orders/sample-001` | The buyer has no capture control; approval never implies payment | B1-F029 | none | 0 |
| B1-F030 | payment | `/orders/sample-001` | An unknown outcome offers a recheck, not a resend | B1-F030N | none | 1 |
| B1-F030N | payment | `/orders/sample-001` | No payment attempt is stated as no attempt, not as a neutral success | B1-F030 | none | 0 |
| B1-F031 | recovery-kit | `/orders/sample-001` | The recovery-kit panel is not reachable from any shipped route | B1-F031N | none | 0 |
| B1-F031N | recovery-kit | `/qa-reserve-ui.html` | The QA harness mounts the real recovery panel once its bundle exists | B1-F031 | none | 0 |
| B1-F032 | recovery-kit | `/connections` | The reserve surface advertises exactly what is unavailable and why | B1-F032N | none | 0 |
| B1-F032N | recovery-kit | `/orders/sample-001` | The order page promises no recovery-kit benefit it cannot deliver | B1-F032 | none | 0 |
| B1-F033 | edge | `/orders/sample-001` | Reloading mid-flow restores the deep-linked state instead of losing it | B1-F033N | none | 0 |
| B1-F033N | edge | `/orders/sample-001` | Back and forward restore the route without a full reload | B1-F033 | none | 1 |
| B1-F034 | edge | `/connections` | The empty state names what to do, not just that nothing is there | B1-F034N | none | 0 |
| B1-F034N | edge | `/connections` | Page errors during a run are surfaced, not swallowed | B1-F034 | none | 0 |
| B1-F035 | edge | `/orders/sample-001` | An unknown workspace path renders the shared not-found surface | B1-F035N | none | 0 |
| B1-F035N | edge | `/api/public-config` | The public config exposes only the three allowlisted fields | B1-F035 | none | 0 |
| B1-F036 | responsive | `/orders/sample-001` | The order view is usable at 390x844 | B1-F036N | none | 0 |
| B1-F036N | responsive | `/orders/sample-001` | The workspace nav stays reachable at 390x844 through the account link | B1-F036 | none | 1 |
| B1-F037 | responsive | `/` | The landing page is usable at 390x844 | B1-F037N | none | 0 |
| B1-F037N | responsive | `/demo` | The demo walkthrough completes at 390x844 | B1-F037 | none | 3 |
| B1-F038 | accessibility | `/` | The first Tab on the landing page reaches the skip link | B1-F038N | none | 0 |
| B1-F038N | accessibility | `/orders` | The first Tab in the workspace reaches its own skip link | B1-F038 | none | 0 |
| B1-F039 | accessibility | `/merchant/quotes/new` | The whole quote form is reachable with the keyboard alone | B1-F039N | none | 0 |
| B1-F039N | accessibility | `/orders/sample-001` | Escape closes the confirmation dialog and returns focus | B1-F039 | none | 1 |
| B1-F040 | accessibility | `/orders/sample-001` | The lost-capability deep link restores its scenario on client-side navigation | B1-F040N | none | 1 |
| B1-F040N | accessibility | `/demo` | The demo moves focus deliberately on every step under reduced motion | B1-F040 | none | 1 |

## The BEFORE baseline, and what it found

Produced on this branch with
`node e2e/rig/run-flow.mjs --all --runs 5 --out e2e/rig/out/before --label before`:
80 flows, 5 runs each, 400 runs. 79 flows green on every run. Median clicks
across the whole catalog: 113. Median time-to-goal spans 88 ms to 7.5 s. axe-core
found zero violations on every route, on wcag2a/aa and wcag21a/aa.

`b1-flows.csv` in this directory carries those observed medians next to the
declared click costs, so the AFTER capture only has to fill in its own columns
for a diff.

One row is red by design, and two findings are recorded without being papered
over. `known_failure` in the CSV marks all three.

**B1-F038N is red: the workspace skip link is not the first focusable.**
`apps/web/src/workspace/model.tsx:232` calls `mainHeading.current?.focus()` on
every `location.pathname` change, so the browser continues its tab sequence from
the `h1` in main content. Measured: on `/orders` the first Tab lands on
`a.order-list-card`; on `/orders/sample-001` it lands on the first action button.
The skip link is third. The landing page (B1-F038) passes, because
`apps/web/src/index.html` has no such focus call. This is the same defect commit
`9c367cf` recorded for `fl-keyboard`; the rig now measures it per route, so it
cannot be lost again.

**B1-F021: a deep link does not restore its scenario on client-side navigation.**
`apps/web/src/workspace/model.tsx:112` parses `?scenario=` once in a
`useState` initializer. A direct load of
`/orders/sample-001?scenario=lost-capability&role=buyer` renders "Capability
unavailable"; clicking that same link from `/account` renders "Review the
delivery" until a reload. The URL says one thing and the screen says another,
which is worse than either being wrong on its own.

**B1-F019N: the quote form's own error copy is unreachable through the UI.**
`apps/web/src/routes/NewQuote.tsx:22` renders a `role="alert"` naming the
5-80 / 20-500 / $1-$5,000 rules, but the same rules are already native
constraints on the inputs, so the browser blocks submit before
`quoteSchema.safeParse` ever runs. Measured: after a 3-character title,
`:invalid` lists `input[name=name]` and the `.form-error` count is 0. The flow
asserts what actually happens, so it stays green and the finding stays visible.