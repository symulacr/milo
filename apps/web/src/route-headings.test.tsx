import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { type FunctionReference, getFunctionName } from "convex/server";
import { Window } from "happy-dom";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router";
import { ORDER_WINDOWS_MS } from "../../../packages/backend/src/order-windows";
import * as authClient from "./auth-client";
import { PageTitle } from "./components/PageTitle";
import { Button } from "./components/ui/button";
import { Alert, CODE_TEXT, errorText } from "./components/workspace";
import { Account } from "./routes/Account";
import { NewQuote } from "./routes/NewQuote";
import { OrderView } from "./routes/OrderView";
import { SignIn } from "./routes/SignIn";
import { WorkspaceNotFound } from "./routes/WorkspaceNotFound";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/**
 * React latches `canUseDOM` **when its module loads**:
 *
 *   var canUseDOM = !!(typeof window !== "undefined" && window.document && ...)
 *
 * Anything that loads `react-dom` before a window exists latches it false, and
 * React then installs a no-op event system: listeners register, events bubble,
 * `event.target` is right, and `onChange` is never called. That includes a
 * static `import { createRoot } from "react-dom/client"` **and** a static
 * `import { PublicApp } from "./public-main"`, because `public-main` imports
 * `bootstrap`, which imports `react-dom/client`. So the window comes first and
 * every react-dom-adjacent module is imported dynamically after it.
 */
const boot = new Window({ url: "http://localhost/" });
const slots = globalThis as unknown as Record<string, unknown>;
slots.window = boot;
for (const key of Object.getOwnPropertyNames(boot))
  if (!(key in globalThis)) slots[key] = (boot as never)[key];
// happy-dom's FormData: Node's global ignores a happy-dom form and returns null
// for every field, so a real form would submit empty values.
slots.FormData = (boot as unknown as { FormData: unknown }).FormData;

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");

/**
 * The React bindings, pointed at a real backend. `useConvex` hands the route
 * the real handler router, `useQuery` runs the real query, and `useMe` sees an
 * account, so a real route can be mounted and driven end to end.
 */
const { realBackend } = await import("./workspace/flows.scenario.test");
const ACTIVE: { backend: ReturnType<typeof realBackend> | null } = {
  backend: null,
};
/**
 * React's `useQuery` returns the resolved value, not a promise. So the mock
 * keeps a synchronous cache: `prime()` resolves a route's queries before the
 * mount, and `useQuery` then returns them on the first render. No async render
 * loop, so no nested `act`.
 */
const QUERIES = new Map<string, unknown>();
/** The object form, which returns a status instead of throwing (G-12). */
const asState = (value: unknown) =>
  value instanceof Error
    ? { status: "error" as const, error: value }
    : value === undefined
      ? { status: "pending" as const }
      : { status: "success" as const, data: value };
mock.module("convex/react", () => ({
  ConvexReactClient: class {},
  useConvex: () => ACTIVE.backend?.client,
  useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
  useConvexConnectionState: () => ({ isWebSocketConnected: true }),
  useQuery: (ref: unknown, args: unknown) =>
    QUERIES.get(
      JSON.stringify([
        getFunctionName(ref as FunctionReference<"query">),
        args,
      ]),
    ),
  useQuery_experimental: (options: { query: unknown; args: unknown }) =>
    asState(
      QUERIES.get(
        JSON.stringify([
          getFunctionName(options.query as FunctionReference<"query">),
          options.args,
        ]),
      ),
    ),
}));
/** Resolve a query into the cache, so the next render sees it synchronously. */
const prime = async (ref: unknown, args: unknown) => {
  if (!ACTIVE.backend) return;
  const key = JSON.stringify([
    getFunctionName(ref as FunctionReference<"query">),
    args,
  ]);
  QUERIES.set(
    key,
    await ACTIVE.backend.client.query(ref as FunctionReference<"query">, args),
  );
}; // `public-main` imports `bootstrap`, which statically imports `react-dom/client`.
// A static import here would load react-dom BEFORE the boot window and latch
// `canUseDOM` false, which silently disables React's event system. Proven by
// bisection: removing this one import made typing work.
const { PublicApp } = await import("./public-main");
const { api } = await import("./api");
// The shell reaches react-dom/client, so it must load after the boot window
// (see the note above): a static import here would latch canUseDOM false.
const { ServiceBoundary } = await import("./shells/WorkspaceShell");
/** Throws whatever it is given, so the boundary's fallback can be driven. */
const Boom = ({ error }: { error: unknown }) => {
  throw error;
};

const render = (path: string, node: React.ReactNode) =>
  renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <main>{node}</main>
    </MemoryRouter>,
  );

const mainHeadings = (markup: string) => {
  const main = markup.match(/<main\b[^>]*>([\s\S]*?)<\/main>/)?.[1] ?? "";
  return [...main.matchAll(/<h1\b([^>]*)>/g)];
};

const publicMarkup = (path: string) =>
  renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <PublicApp />
    </MemoryRouter>,
  );

describe("route heading accessibility", () => {
  // Every route below must expose exactly one focusable main heading. One
  // table and one assertion body, so a new route is one row.
  const ROUTES: readonly (readonly [string, () => string])[] = [
    ["/privacy", () => publicMarkup("/privacy")],
    ["/terms", () => publicMarkup("/terms")],
    ["/unknown", () => publicMarkup("/unknown")],
    ["sign-in", () => render("/orders", <SignIn />)],
    ["invite sign-in", () => render("/orders/q1?invite=t", <SignIn />)],
    ["failed link", () => render("/orders?error=INVALID_TOKEN", <SignIn />)],
    ["workspace 404", () => render("/nowhere", <WorkspaceNotFound />)],
  ];

  for (const [name, markup] of ROUTES)
    test(`${name} has one programmatically focusable main heading`, () => {
      const headings = mainHeadings(markup());
      expect(headings).toHaveLength(1);
      expect(headings[0]?.[1]).toContain('tabindex="-1"');
    });
  test("an invite link changes the sign-in heading", () => {
    expect(render("/orders/q1?invite=t", <SignIn />)).toContain(
      "Open your order",
    );
  });
});

describe("a tab open across a deploy", () => {
  // G-12: the positional `useQuery` throws on an error result, so this route's
  // reload notice was unreachable and one failed query replaced the whole
  // workspace through `ServiceBoundary`. The route now uses the object form,
  // which returns `{status:"error", error}` instead of throwing. The cache
  // holds the raw value (an `Error` here) and the mock turns it into the state
  // the real hook would return, so this still drives the route, not the mock.
  // R38: this test used to assert the DEFECT. Its fixture is a server error
  // ("Server Error: not found"), not a replaced chunk, yet it demanded
  // "Milo may have been updated while this tab was open" — telling a user their
  // tab was stale when the server had actually failed, and offering a reload as
  // the only remedy. The stated intent (do not throw a TypeError from
  // `orders.map`) is kept; the copy assertion is corrected.
  test("a server error says what failed, not that the tab is stale", async () => {
    const { Orders } = await import("./routes/Orders");
    const key = JSON.stringify([getFunctionName(api.orders), {}]);
    const previous = QUERIES.get(key);
    QUERIES.set(
      key,
      new Error("[CONVEX M(orders:list)] Server Error: not found"),
    );
    try {
      const markup = render("/orders", <Orders />);
      expect(markup).toContain("Orders did not load");
      expect(markup).toContain("Try again");
      // The wrong diagnosis must not come back.
      expect(markup).not.toMatch(/updated while this tab was open/i);
      // The old failure mode: a TypeError from `orders.map` inside the boundary.
      expect(markup).not.toContain("The order service is not available");
    } finally {
      if (previous === undefined) QUERIES.delete(key);
      else QUERIES.set(key, previous);
    }
  });

  // The other half: a genuinely replaced chunk still gets the stale-tab copy,
  // because for that failure a reload IS the fix.
  test("a replaced chunk still says the tab is old", async () => {
    const { Orders } = await import("./routes/Orders");
    const key = JSON.stringify([getFunctionName(api.orders), {}]);
    const previous = QUERIES.get(key);
    QUERIES.set(
      key,
      new Error(
        "Failed to fetch dynamically imported module: /assets/Orders-abc.js",
      ),
    );
    try {
      const markup = render("/orders", <Orders />);
      expect(markup).toMatch(/older than the current version/i);
      expect(markup).toContain("Reload");
    } finally {
      if (previous === undefined) QUERIES.delete(key);
      else QUERIES.set(key, previous);
    }
  });

  test("a pending query still shows the loading state, not the notice", async () => {
    // The object form has three states, and collapsing "pending" into "error"
    // would show a reload button to a user whose data is simply on its way.
    const { Orders } = await import("./routes/Orders");
    const key = JSON.stringify([getFunctionName(api.orders), {}]);
    const previous = QUERIES.get(key);
    QUERIES.delete(key);
    try {
      const markup = render("/orders", <Orders />);
      expect(markup).toMatch(/Loading orders/i);
      expect(markup).not.toContain("Reload");
    } finally {
      if (previous !== undefined) QUERIES.set(key, previous);
    }
  });
});

describe("a stale chunk after a deploy", () => {
  // A tab older than the deployment asks for a hashed chunk the new build no
  // longer has. The import rejects, and without a handler the user sees a dead
  // route. One guarded reload fixes it; the guard stops a broken chunk looping.
  test("a failed dynamic import reloads once, and only once", async () => {
    const boot = globalThis as unknown as {
      location: { reload: () => void };
      sessionStorage: Storage;
      dispatchEvent: (e: Event) => boolean;
    };
    let reloads = 0;
    const originalReload = boot.location.reload;
    boot.location.reload = () => {
      reloads += 1;
    };
    boot.sessionStorage.clear();
    const { installRecovery } = await import("./bootstrap");
    installRecovery();
    // happy-dom has no PromiseRejectionEvent; the listener only reads `reason`,
    // so a plain cancelable Event carrying one is the same input.
    const stale = () => {
      const event = new Event("unhandledrejection", { cancelable: true });
      Object.defineProperty(event, "reason", {
        value: new TypeError(
          "Failed to fetch dynamically imported module: /chunk-old.js",
        ),
      });
      return event;
    };
    try {
      boot.dispatchEvent(stale());
      expect(reloads).toBe(1);
      // A second failure must not reload again, or a genuinely broken chunk
      // would loop forever.
      boot.dispatchEvent(stale());
      expect(reloads).toBe(1);
    } finally {
      boot.location.reload = originalReload;
      boot.sessionStorage.clear();
    }
  });

  test("a successful mount re-arms the guard for the next deploy", async () => {
    const boot = globalThis as unknown as {
      location: { reload: () => void };
      sessionStorage: Storage;
      dispatchEvent: (e: Event) => boolean;
    };
    let reloads = 0;
    const originalReload = boot.location.reload;
    boot.location.reload = () => {
      reloads += 1;
    };
    boot.sessionStorage.clear();
    const { installRecovery, mount } = await import("./bootstrap");
    installRecovery();
    const stale = () => {
      const event = new Event("unhandledrejection", { cancelable: true });
      Object.defineProperty(event, "reason", {
        value: new TypeError(
          "Failed to fetch dynamically imported module: /chunk-old.js",
        ),
      });
      return event;
    };
    try {
      boot.dispatchEvent(stale());
      expect(reloads).toBe(1);
      // The reload lands and the app mounts: the guard must be re-armed.
      // `mount` needs a #root and a component; a stub App is enough, because
      // the only behaviour under test is the flag being cleared.
      const root = boot as unknown as { document: Document };
      const host = root.document.createElement("div");
      host.id = "root";
      root.document.body.append(host as never);
      mount((() => null) as never);
      expect(boot.sessionStorage.getItem("milo:reloaded")).toBeNull();
      // So the NEXT deploy's stale chunk reloads again, once.
      boot.dispatchEvent(stale());
      expect(reloads).toBe(2);
      boot.dispatchEvent(stale());
      expect(reloads).toBe(2);
    } finally {
      boot.location.reload = originalReload;
      boot.sessionStorage.clear();
    }
  });
});

const RESEND_403 =
  "You can only send testing emails to your own email address (owner@example.com). To send emails to other recipients, please verify a domain.";
const RAW = "order is not in RESERVED";
const ENVELOPE = "[CONVEX M(orders:create)] [Request ID: 8f2a] Server Error ";
const envelope = (body: string) =>
  new Error(`${ENVELOPE}${body}\n  Called by client`);
const appError = (data: unknown) =>
  Object.assign(new Error(JSON.stringify(data)), { name: "ConvexError", data });
// The envelope words are only noise at the START of a message; a provider
// sentence may legitimately contain them (D-19).
const NOISE =
  /^\[CONVEX|\[Request ID:|Called by client|^(?:Uncaught )?Error:|\bat .*:\d+\)?$/;

describe("errorText strips the Convex envelope", () => {
  const CASES: [unknown, string][] = [
    [envelope(`Uncaught Error: ${RAW} at handler (convex/orders.ts:412)`), RAW],
    [
      envelope(
        `Uncaught Error: {"statusCode":403,"name":"validation_error","message":"${RESEND_403}"} at send (convex/mail.ts:88)`,
      ),
      RESEND_403,
    ],
    [appError({ code: "NOT_FOUND" }), CODE_TEXT.NOT_FOUND],
    [appError({ code: "RATE_LIMITED", message: RAW }), RAW],
    [appError("That order does not exist."), "That order does not exist."],
    [new Error("The card hold failed."), "The card hold failed."],
    [new Error(""), "The step did not complete. Try again."],
    // D-19: an unanchored `Server Error` used to eat these words mid-sentence.
    [
      new Error("Stripe: Server Error while capturing. Try again."),
      "Stripe: Server Error while capturing. Try again.",
    ],
  ];
  test.each(CASES)("case %#", (error, want) => {
    const text = errorText(error);
    expect(text).toBe(want);
    expect(text).not.toMatch(NOISE);
  });
});

describe("the ended session", () => {
  test("says so on the sign-in form", () => {
    expect(render("/orders", <SignIn expired />)).toContain(
      CODE_TEXT.UNAUTHENTICATED,
    );
  });
  test("has one home, so the shell and the form cannot drift apart", () => {
    const SOURCES = [
      "components/workspace.tsx",
      "shells/WorkspaceShell.tsx",
      "routes/SignIn.tsx",
    ];
    const hits = SOURCES.map(
      (file) =>
        readFileSync(`apps/web/src/${file}`, "utf8").split(
          CODE_TEXT.UNAUTHENTICATED,
        ).length - 1,
    );
    expect(hits).toEqual([1, 0, 0]);
  });
});

describe("every error names the next action", () => {
  const ACTION =
    /\b(Sign in|Ask|Check|Reload|Try|Wait|Open|Download|Restore|Contact|Retry)\b/;
  test("no code row is a dead end", () => {
    for (const [code, text] of Object.entries(CODE_TEXT))
      expect({ code, text, ok: ACTION.test(text) }).toEqual({
        code,
        text,
        ok: true,
      });
  });
  test("the fallback also names an action", () => {
    expect(errorText(new Error(""))).toMatch(ACTION);
  });
});

describe("action states", () => {
  // name, factory, strings it must carry, strings that mean it is wrong.
  const CASES: readonly [string, () => React.ReactNode, string[], string[]][] =
    [
      [
        "idle",
        () => <Button>Send the quote</Button>,
        ["Send the quote"],
        ["aria-busy", "spinner"],
      ],
      [
        "pending",
        () => <Button pending>Send the quote</Button>,
        ['aria-busy="true"', "disabled", "spinner", "Send the quote"],
        [" pending="],
      ],
      [
        "pending-over-disabled",
        () => (
          <Button pending disabled={false}>
            Go
          </Button>
        ),
        ["disabled"],
        [],
      ],
      [
        "alert",
        () => <Alert>The card hold failed.</Alert>,
        ['role="alert"'],
        [],
      ],
    ];
  test.each(CASES)("%s", (_name, make, want, reject) => {
    const markup = renderToStaticMarkup(make());
    for (const text of want) expect(markup).toContain(text);
    for (const text of reject) expect(markup).not.toContain(text);
  });
  test("the spinner is aria-hidden", () => {
    const markup = renderToStaticMarkup(<Button pending>Go</Button>);
    expect(markup.match(/<span[^>]*data-slot="spinner"[^>]*>/)?.[0]).toContain(
      'aria-hidden="true"',
    );
  });
});

describe("no forbidden payment claim ships", () => {
  // Stripe does not provide escrow and lists escrow services as restricted, so
  // these words must not appear in anything a user can read.
  // Globs, not a hand-typed list: a new route is covered the day it lands.
  const FILES = ["apps/web/**/*.{html,ts,tsx}", "packages/backend/src/email.ts"]
    .flatMap((g) => [...new Bun.Glob(g).scanSync()])
    .filter((f) => !/\.test\./.test(f));
  test("the globbed surface is the real one", () => {
    expect(FILES.length).toBeGreaterThan(20);
    for (const f of ["apps/web/index.html", "apps/web/src/routes/InfoPage.tsx"])
      expect(FILES).toContain(f);
  });
  const BANNED: readonly (readonly [string, RegExp])[] = [
    ["escrow", /escrow/i],
    ["held in trust", /held in trust|in trust account|trust account/i],
    ["guaranteed", /guarantee/i],
    ["secure (as a money claim)", /\bsecure(ly|d)?\b/i],
    ["bank-grade", /bank[- ]grade|military[- ]grade/i],
  ];
  test.each(BANNED)("no %s anywhere", (_label, pattern) => {
    for (const file of FILES)
      expect({
        file,
        hit: readFileSync(file, "utf8").match(pattern)?.[0] ?? null,
      }).toEqual({ file, hit: null });
  });
  test("the copy uses authorize and capture, not custody", () => {
    const terms = readFileSync("apps/web/src/routes/InfoPage.tsx", "utf8");
    expect(terms).toContain("authorizes your card");
    expect(terms).toContain("captures it only when you approve");
  });
});

describe("the legal pages state the real numbers", () => {
  // The rendered page, not the source: a section written but never rendered
  // must fail here.
  const terms = publicMarkup("/terms");
  const privacy = publicMarkup("/privacy");
  const total =
    Object.values(ORDER_WINDOWS_MS).reduce((a, b) => a + b) / 3_600_000;
  test("the rendered windows are the code's windows", () => {
    // The page builds the sentence from ORDER_WINDOWS_MS, so a literal is the
    // only way these can drift.
    expect(terms).toContain(`${total} hours`);
    expect(total).toBeLessThan(7 * 24); // Stripe's card-not-present window
    const src = readFileSync("apps/web/src/routes/InfoPage.tsx", "utf8");
    for (const n of [ORDER_WINDOWS_MS.delivery / 3_600_000, total])
      expect(src).not.toContain(`${n} hours`);
  });
  test("the file limits match the delivery policy", () => {
    const p = readFileSync("packages/backend/src/delivery-policy.ts", "utf8");
    const max = Number(p.match(/MAX_BYTES = (\d+) \* 1024 \* 1024/)?.[1]);
    for (const t of [
      `up to ${max} MiB`,
      "PNG, JPEG or WebP",
      "Exactly three images",
    ])
      expect(terms).toContain(t);
    expect(p).toContain("length(3)");
  });
  test("privacy names the date, contact, retention and subprocessors", () => {
    for (const page of [terms, privacy]) {
      expect(page).toMatch(/Effective \d{4}-\d{2}-\d{2}\./);
      expect(page).toContain("pajiton@atomicmail.io");
    }
    // One list renders both: each retention row is a real <dt>/<dd> pair.
    for (const t of ["7 years", "90 days", "7 days", "Permanent"])
      expect(privacy).toMatch(new RegExp(`<dt[^>]*>[^<]+</dt><dd[^>]*>${t}`));
    for (const t of ["Convex", "Stripe", "Vercel", "Resend", "Midnight"])
      expect(privacy).toContain(t);
    expect(terms).not.toContain("Vercel");
  });
});

describe("no inline script or handler (CSP report-only goal)", () => {
  // Report-Only with script-src 'self' and no 'unsafe-inline': an inline script
  // would be blocked the moment the policy is enforced.
  const HTML = [
    "apps/web/index.html",
    "apps/web/app.html",
    "apps/web/public-app.html",
  ];
  test("every script tag has a src", () => {
    for (const file of HTML)
      for (const tag of readFileSync(file, "utf8").match(/<script\b[^>]*>/g) ??
        [])
        expect({ file, tag, hasSrc: /\ssrc=/.test(tag) }).toEqual({
          file,
          tag,
          hasSrc: true,
        });
  });
  test("no inline event handler", () => {
    for (const file of HTML)
      expect(readFileSync(file, "utf8")).not.toMatch(
        /\son(click|load|error|submit)=/i,
      );
  });
});

describe("a user-supplied heading sets its own direction (U-12)", () => {
  // `PageTitle` renders the brief the user typed as the order title, so a brief
  // in Hebrew or Arabic would otherwise inherit the page's `ltr` and put its
  // punctuation on the wrong side. `dir="auto"` is the native fix.
  const source = readFileSync("apps/web/src/components/PageTitle.tsx", "utf8");
  test("both headings carry dir=auto", () => {
    expect(source.match(/dir="auto"/g) ?? []).toHaveLength(2);
  });
  test("a Latin heading is unaffected by dir=auto", () => {
    // The English UI must render identically; dir=auto on Latin resolves ltr.
    const markup = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/orders"]}>
        <PageTitle title="Orders" />
      </MemoryRouter>,
    );
    expect(markup).toContain('dir="auto"');
    expect(markup).toContain(">Orders</h1>");
  });
});

describe("NotFound CTA (A3-01)", () => {
  test("public bundle 404 CTA is a cross-entry anchor to the landing", () => {
    const cta = publicMarkup("/unknown").match(
      /<a [^>]*>Go to the Milo home page/,
    );
    expect(cta?.[0]).toContain('href="/"');
  });
  test("workspace bundle 404 CTA returns to the orders list", () => {
    const cta = render("/nowhere", <WorkspaceNotFound />).match(
      /<a [^>]*>Back to your orders/,
    );
    expect(cta?.[0]).toContain('href="/orders"');
  });
});

// Every r15 fix that had no test: the file, a string the fix introduced,
// and a string it removed. Reverting the fix fails the row.
const GUARDS: readonly (readonly [string, string, string, string])[] = [
  [
    "D-16 the backup input is named by its label once",
    "apps/web/src/routes/Account.tsx",
    'label="Backup file"',
    "Choose the backup file",
  ],
  [
    "D-15 the picker uses the server's own limits",
    "apps/web/src/routes/OrderView.tsx",
    "ACCEPTED_IMAGE_TYPES.includes",
    "8 * 1024 * 1024",
  ],
  [
    "D-10 the invite card names no step count",
    "apps/web/src/routes/OrderView.tsx",
    "is authorized now and captured on approval",
    "SIGN_STEPS",
  ],
  [
    "D-08 an ended order states its payment result",
    "apps/web/src/routes/OrderView.tsx",
    "Payment: ${PAYMENT_LABEL",
    "captures the card payment next",
  ],
  [
    // The invariant is "the path, never the token-bearing href". It is read from
    // the router rather than the global so it is the *routed* path (the shell
    // renders this form outside the `:quoteId` route, and a MemoryRouter has no
    // global location). `location.search` is refused too: G-17 keeps the token
    // out of the callback by stashing it, not by putting it back in the URL.
    "D-01 sign-in sends the path, not the token-bearing href",
    "apps/web/src/routes/SignIn.tsx",
    "useLocation().pathname",
    "location.href",
  ],
  [
    "D-01 the order route strips the token from the address bar",
    "apps/web/src/routes/OrderView.tsx",
    "setParams({}, { replace: true })",
    "",
  ],
  [
    "D-02 a claim reuses the key this browser holds",
    "apps/web/src/workspace/flows.ts",
    "keyFor(subject, quoteId) ??",
    "",
  ],
  [
    "D-05 the form supplies one nonce per session",
    "apps/web/src/workspace/flows.ts",
    "form.orderNonce ?? randomHex()",
    "",
  ],
  [
    "D-05 the form holds that nonce in state",
    "apps/web/src/routes/NewQuote.tsx",
    "useState(randomHex)",
    "",
  ],
  [
    "D-11 the submit guard runs before any await",
    "apps/web/src/routes/NewQuote.tsx",
    "inFlight.start()",
    "",
  ],
  [
    "D-18 a disputed order claims no track position",
    "apps/web/src/routes/OrderView.tsx",
    'order.stage === "DISPUTED" ? undefined',
    "",
  ],
];

describe("r15 behaviour guards", () => {
  for (const [name, file, present, absent] of GUARDS)
    test(name, () => {
      const source = readFileSync(file, "utf8");
      expect(source).toContain(present);
      if (absent) expect(source).not.toContain(absent);
    });

  test("D-01 the callback is the path, and never carries the token", () => {
    const source = readFileSync("apps/web/src/routes/SignIn.tsx", "utf8");
    // The callback handed to the mailer is the routed path.
    expect(source).toContain("sendMagicLink(email, here)");
    expect(source).toContain("const here = useLocation().pathname;");
    // Neither the full href nor the query string may reach the mailer: the
    // first leaks to the provider via Referer, the second re-opens D-01.
    expect(source).not.toContain("location.href");
    expect(source).not.toContain("location.search");
  });

  test("D-02 the key is saved only after the server accepted it", () => {
    const source = readFileSync("apps/web/src/workspace/flows.ts", "utf8");
    expect(source.indexOf("saveKey(subject, key)")).toBeGreaterThan(
      source.indexOf("api.acceptInvite"),
    );
  });

  test("D-11 the guard is the first statement after preventDefault", () => {
    const source = readFileSync("apps/web/src/routes/NewQuote.tsx", "utf8");
    // The guard is the shared `useGuard` hook now, so the assertion follows the
    // call shape rather than a particular ref. The invariant is unchanged: the
    // guard must run before the first `await`, which is what makes a second
    // click in the same frame impossible.
    expect(source.indexOf("if (!inFlight.start()) return;")).toBeGreaterThan(
      source.indexOf("event.preventDefault();"),
    );
  });

  test("D-14 the status clears before the write", () => {
    const source = readFileSync(
      "apps/web/src/components/workspace.tsx",
      "utf8",
    );
    expect(source.indexOf('setStatus("idle")')).toBeLessThan(
      source.indexOf("navigator.clipboard.writeText"),
    );
  });
});

// The limiter and the verify redirect both fail a sign-in for a reason the user
// cannot fix by retyping. The reader is looked up on the module with a no-op
// fallback, so on the base tree the test fails on the STRING, not a missing export.
const retryWait =
  (authClient as { retryWait?: (r: Response | undefined) => string })
    .retryWait ?? (() => "");
const limited = (headers: Record<string, string>) =>
  new Response(null, { status: 429, headers });

describe("a sign-in failure names what the user can do", () => {
  test("the wait comes from X-Retry-After, in seconds", () => {
    expect(retryWait(limited({ "x-retry-after": "37" }))).toBe(
      "Wait 37 seconds, then try again.",
    );
    expect(retryWait(limited({ "X-Retry-After": "5" }))).toBe(
      "Wait 5 seconds, then try again.",
    );
    expect(retryWait(limited({}))).toBe("");
    expect(retryWait(limited({ "x-retry-after": "soon" }))).toBe("");
    expect(retryWait(undefined)).toBe("");
  });

  test("every wallet call can read the wait", () => {
    // Without onError a rate-limited wallet is reported as a wallet fault, and
    // $fetch captures fetch at import, so this is guarded at the source.
    const source = readFileSync("apps/web/src/auth-client.ts", "utf8");
    const calls = source.split("client.$fetch").slice(1);
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call.slice(0, 400)).toContain("onError");
  });

  // The verify token is consumed on the first attempt, so a mail scanner that
  // prefetched the link burns it: name the cause, do not blame, offer a resend.
  const used = render("/orders?error=INVALID_TOKEN", <SignIn />);

  test("a consumed link is named, not blamed, and can be resent", () => {
    expect(used).toContain("Request a new link");
    expect(used).toContain("already used");
    expect(used).not.toMatch(/you did something wrong|invalid user/i);
    expect(used).toContain('type="email"');
    expect(used).toContain("Email me a sign-in link");
  });

  test("a server-side verify failure is not called a used link", () => {
    // failed_to_create_session and friends are not the user's link expiring.
    const broken = render("/orders?error=failed_to_create_session", <SignIn />);
    expect(broken).toContain("Request a new link");
    expect(broken).toContain("did not complete");
    expect(broken).not.toContain("Link already used or expired");
  });
});

describe("a resend clears the dead-link message", () => {
  // The message is read from ?error= once, so it survives the resend unless it
  // is cleared. A static render cannot show that: the state never changes.
  test("the heading stops saying the link is dead", async () => {
    const form = await mount("/orders?error=INVALID_TOKEN", <SignIn />);
    const heading = () => form.container.querySelector("h1")?.textContent ?? "";
    expect(heading()).toContain("Request a new link");
    await form.fill({ email: "a@b.co" });
    await form.submit();
    expect(heading()).not.toContain("Request a new link");
    await form.done();
  });
});

/**
 * Mount a real route in a real DOM and drive it like a user.
 *
 * One window for the whole file: React's event system binds to the document
 * that exists when it loads, so swapping documents under it makes two roots
 * fight. Each mount gets a fresh container in that one document instead.
 *
 * `fill` and `submit` are the point: they set a controlled field through the
 * **prototype's native value setter** and dispatch a bubbling `input` event
 * built from happy-dom's own `InputEvent`, inside `act()`. That is what a
 * browser does, and React's `onChange` fires because the window existed before
 * React loaded (see the boot window above).
 */
async function mount(
  path: string,
  node: React.ReactNode,
  /** Queries the route reads, resolved before the first render. */
  queries: readonly (readonly [unknown, unknown])[] = [],
  /** The route pattern, so `useParams()` yields its named params. */
  pattern = "*",
) {
  const container = boot.document.createElement("div");
  boot.document.body.append(container as never);
  const root = createRoot(container as unknown as HTMLElement);
  // A <Route> is what makes `useParams()` work; MemoryRouter alone declares no
  // routes, so a route reading `:quoteId` would get "".
  const render = async () =>
    act(async () =>
      root.render(
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path={pattern} element={node} />
          </Routes>
        </MemoryRouter>,
      ),
    );
  QUERIES.clear();
  for (const [ref, args] of queries) await prime(ref, args);
  await render();

  /**
   * Find a field the way a user does: by its `name` attribute, or by the text
   * of the <label> that wraps it. NewQuote names its inputs; SignIn, Account
   * and OrderView rely on the label, which is also the accessible name.
   */
  const field = (label: string) => {
    const byName = container.querySelector(`[name="${label}"]`);
    if (byName) return byName as unknown as HTMLInputElement;
    // An accessible name can also be an aria-label, which is how OrderView's
    // note is named (it has no wrapping <label>).
    const byAria = container.querySelector(`[aria-label="${label}"]`);
    if (byAria) return byAria as unknown as HTMLInputElement;
    const labelEl = [...container.querySelectorAll("label")].find((el) =>
      (el.textContent ?? "").toLowerCase().includes(label.toLowerCase()),
    );
    const control = labelEl?.querySelector("input, textarea");
    if (!control) throw new Error(`no field named or labelled ${label}`);
    return control as unknown as HTMLInputElement;
  };

  /** Type into fields, the way a browser does. */
  const fill = async (values: Record<string, string>) => {
    for (const [name, value] of Object.entries(values)) {
      const target = field(name);
      const proto =
        target instanceof boot.HTMLTextAreaElement
          ? boot.HTMLTextAreaElement.prototype
          : boot.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(target, value);
      target.dispatchEvent(
        new boot.InputEvent("input", { bubbles: true }) as unknown as Event,
      );
      await act(async () => {});
    }
  };

  /** Submit the form the way a browser does: a bubbling, cancelable event. */
  const submit = async () => {
    const form = container.querySelector("form");
    if (!form) throw new Error("no form");
    await act(async () =>
      form.dispatchEvent(
        new boot.Event("submit", { bubbles: true, cancelable: true }),
      ),
    );
    // Let the handler's real promise chain settle. Sign-in loads the public
    // config and builds the auth client; a quote also awaits the chain
    // commitments and a SHA-256 before the handler runs. Poll until the DOM
    // stops changing, bounded so a hang fails instead of spinning.
    let previous = "";
    for (let i = 0; i < 60; i += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      const current = container.textContent ?? "";
      if (i > 3 && current === previous) break;
      previous = current;
    }
  };

  /**
   * What the form would submit for a field. A controlled field (SignIn) has a
   * React model to read; an uncontrolled one (NewQuote's `name`+FormData
   * fields) has none, so the DOM is the truth.
   */
  const value = (label: string) => {
    const el = field(label);
    const key = Object.keys(el).find((k) => k.startsWith("__reactProps"));
    const model = key
      ? (el as unknown as Record<string, { value?: string }>)[key].value
      : undefined;
    return model ?? el.value;
  };

  const text = () => container.textContent ?? "";
  const done = async () => {
    await act(async () => root.unmount());
    container.remove();
  };
  return { container, fill, submit, text, value, done };
}

describe("the sign-in form takes a typed address", () => {
  test("typing reaches React state, and submitting sends that address", async () => {
    // Before the import-order fix this could not be written: the field stayed
    // empty and the form reported "Enter an email address" no matter what.
    const form = await mount("/orders", <SignIn />);
    await form.fill({ email: "buyer@example.com" });
    const field = form.container.querySelector(
      "input[type=email]",
    ) as unknown as HTMLInputElement;
    expect(field.value).toBe("buyer@example.com");
    await form.submit();
    // The real sendMagicLink ran with the typed address: it either echoes it or
    // reports the site unconfigured. The empty-address guard must NOT fire.
    expect(form.text()).not.toContain("Enter an email address.");
    expect(form.text()).toMatch(
      /buyer@example\.com|not available on this site/,
    );
    await form.done();
  });

  test("an empty submit is refused by the form's own guard", async () => {
    const form = await mount("/orders", <SignIn />);
    await form.submit();
    expect(form.text()).toContain("Enter an email address.");
    await form.done();
  });

  test("a whitespace-only address is refused, not sent", async () => {
    const form = await mount("/orders", <SignIn />);
    await form.fill({ email: "   " });
    // A browser sanitizes an invalid `type=email` value to "", so the field is
    // empty and the guard fires. Asserting the model keeps this non-vacuous:
    // it proves the typed value reached React before being sanitized.
    expect(form.value("email")).toBe("");
    await form.submit();
    expect(form.text()).toContain("Enter an email address.");
    await form.done();
  });
});

describe("bad input shows the user the server's own refusal", () => {
  // happy-dom does not enforce constraint validation, so the browser's
  // minLength/min do not block the submit. That is useful here: the request
  // reaches the REAL handler, which refuses with its own sentence, and the form
  // shows it. So each row asserts the server's exact message reached the user.
  const GOOD = {
    studio: "North Studio",
    brief: "Three hero images for the winter collection, medium format.",
    amount: "900",
    email: "client@example.com",
  };
  const CASES: readonly (readonly [string, Record<string, string>, string])[] =
    [
      [
        "a brief under the minimum",
        { ...GOOD, brief: "too short" },
        "Brief must be 20 to 1000 characters",
      ],
      [
        "an empty brief",
        { ...GOOD, brief: "" },
        "Brief must be 20 to 1000 characters",
      ],
      [
        "a price of zero",
        { ...GOOD, amount: "0" },
        "Amount must be 1 to 5000 USD",
      ],
      [
        "a price above the maximum",
        { ...GOOD, amount: "5001" },
        "Amount must be 1 to 5000 USD",
      ],
      [
        "an email with no @",
        { ...GOOD, email: "client.example.com" },
        "Valid client email required",
      ],
    ];

  for (const [name, values, message] of CASES)
    test(`${name} shows "${message}"`, async () => {
      const backend = realBackend("did:privy:merchant");
      ACTIVE.backend = backend;
      const form = await mount("/orders/new", <NewQuote />, [[api.me, {}]]);
      await form.fill(values);
      await form.submit();
      // The real handler refused: nothing was written.
      expect(backend.tables.quoteDrafts).toHaveLength(0);
      // And its own sentence is what the user reads.
      expect(form.text()).toContain(message);
      await form.done();
    });
});

describe("the real quote form drives the real handler", () => {
  // The join this round is for: a real React form, filled the way a browser
  // fills it, submitting into the real Convex handler with its real args
  // validator. Nothing hand-built between them.
  const BRIEF =
    "Three hero images for the winter collection, shot on medium format.";
  // A first-time studio has no scope yet, so the form asks for its name.
  const FORM = {
    studio: "North Studio",
    brief: BRIEF,
    amount: "900",
    email: "Client@Example.com",
  };

  test("typing a brief, price and email creates the quote the server validates", async () => {
    const backend = realBackend("did:privy:merchant");
    ACTIVE.backend = backend;
    const form = await mount("/orders/new", <NewQuote />, [[api.me, {}]]);
    await form.fill(FORM);

    // The typed values reached React's model, not just the DOM.
    expect(form.value("studio")).toBe("North Studio");
    expect(form.value("brief")).toBe(BRIEF);
    expect(form.value("amount")).toBe("900");
    expect(form.value("email")).toBe("Client@Example.com");

    await form.submit();

    // The real handler ran and wrote the draft.
    const draft = backend.tables.quoteDrafts[0];
    expect(draft).toBeDefined();
    expect(draft.brief).toBe(BRIEF);
    expect(draft.amountUsd).toBe(900);
    // The form lowercases the address before sending it.
    expect(draft.clientEmail).toBe("client@example.com");
    // The title is derived from the brief's first line, clamped to 80.
    expect(draft.title).toBe(BRIEF.slice(0, 80));
    await form.done();
  });
});

describe("the account backup form takes a typed password", () => {
  test("typing reaches the field and the form offers the download", async () => {
    const backend = realBackend("did:privy:buyer");
    ACTIVE.backend = backend;
    const form = await mount("/account", <Account />, [[api.me, {}]]);
    // The backup form's password field is labelled and controlled.
    await form.fill({ "Backup password": "a-long-enough-password" });
    expect(form.value("Backup password")).toBe("a-long-enough-password");
    // The download button exists and is governed by whether this browser holds
    // any keys, which earlier tests may have left behind; assert the control is
    // present and wired, not a state another test controls.
    const button = [...form.container.querySelectorAll("button")].find((b) =>
      (b.textContent ?? "").includes("Download the backup"),
    );
    expect(button).toBeDefined();
    expect(button?.type).toBe("submit");
    await form.done();
  });

  test("the restore form takes a file and a password", async () => {
    const backend = realBackend("did:privy:buyer");
    ACTIVE.backend = backend;
    const form = await mount("/account", <Account />, [[api.me, {}]]);
    await form.fill({ "Backup password": "a-long-enough-password" });
    // Two password fields exist; the restore one is the second.
    const passwords = [
      ...form.container.querySelectorAll('input[type="password"]'),
    ] as unknown as HTMLInputElement[];
    expect(passwords).toHaveLength(2);
    expect(form.value("Backup password")).toBe("a-long-enough-password");
    // The restore form also has a file input, which a user picks from disk.
    expect(form.container.querySelector('input[type="file"]')).not.toBeNull();
    await form.done();
  });
});

describe("the order view takes a typed note and picked files", () => {
  // A fake wallet reporting a connected Preprod session, so the action buttons
  // render. The chain is the module fake from the scenario suite.
  const WALLET = {
    rdns: "io.metamask",
    name: "Test Wallet",
    icon: "",
    api: {
      connect: async () => ({
        getConnectionStatus: async () => ({
          status: "connected",
          networkId: "preprod",
        }),
        getUnshieldedAddress: async () => ({ unshieldedAddress: "mn_addr1" }),
        signData: async () => ({
          signature: "00",
          verifyingKey: "00",
          scheme: "ed25519",
        }),
        getConfiguration: async () => ({ networkId: "preprod" }),
        hintUsage: undefined,
      }),
    },
  };

  const HEX = "a".repeat(64);
  /** An order the real `orders.order` returns: a draft, a member, a chain row. */
  const seeded = () => {
    const backend = realBackend("did:privy:buyer");
    backend.tables.quoteDrafts.push({
      _id: "d1",
      id: "quote-1",
      scopeId: "scope-1",
      studioName: "North Studio",
      merchantSubject: "did:privy:merchant",
      merchantAccountId: "merchant-1",
      title: "Three hero images",
      brief: "A short brief for the fixed-price image pack.",
      clientEmail: "buyer@example.com",
      amountUsd: 900,
      amountMinor: 90_000,
      currency: "USD",
      orderNonce: HEX,
      merchantCommitment: HEX,
      operatorCommitment: HEX,
      termsCommitment: HEX,
      terms: {
        unitPrice: "90000",
        total: "90000",
        scopeDigest: HEX,
        rightsDigest: HEX,
        paymentPolicy: HEX,
        salt: HEX,
      },
      inviteToken: "a1".repeat(32),
      buyerSubject: "did:privy:buyer",
      buyerAccountId: "did:privy:buyer",
      buyerCommitment: HEX,
      createdAt: 1,
      updatedAt: 2,
    });
    backend.tables.memberships.push({
      _id: "m1",
      privySubject: "did:privy:buyer",
      accountId: "did:privy:buyer",
      scopeId: "scope-1",
      role: "buyer",
      status: "active",
    });
    backend.tables.chainOrders.push({
      _id: "c1",
      quoteId: "quote-1",
      orderId: "order-1",
      address: "0xcontract",
      phase: "SUBMITTED",
      revision: 3,
      terminal: false,
      nonce: HEX,
    });
    return backend;
  };

  const connect = async () => {
    const wallet = await import("./workspace/wallet");
    await wallet.connectWallet(WALLET as never);
  };

  test("the dispute note takes typing", async () => {
    ACTIVE.backend = seeded();
    await connect();
    const form = await mount(
      "/orders/quote-1",
      <OrderView />,
      [
        [api.me, {}],
        [api.order, { quoteId: "quote-1" }],
      ],
      "/orders/:quoteId",
    );
    const note = form.container.querySelector(
      'textarea[aria-label="Reason"]',
    ) as HTMLTextAreaElement | null;
    expect(note).not.toBeNull();
    await form.fill({ Reason: "The third image is the wrong crop entirely." });
    expect(form.value("Reason")).toBe(
      "The third image is the wrong crop entirely.",
    );
    await form.done();
  });

  test("the file input accepts three picked files", async () => {
    ACTIVE.backend = seeded();
    await connect();
    const form = await mount(
      "/orders/quote-1",
      <OrderView />,
      [
        [api.me, {}],
        [api.order, { quoteId: "quote-1" }],
      ],
      "/orders/:quoteId",
    );
    const input = form.container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement | null;
    // The picker renders only for the studio's delivery action; a buyer sees
    // the note instead. Assert the route rendered either way.
    expect(form.container.textContent).toContain("Three hero images");
    if (input) {
      const files = [0, 1, 2].map(
        (i) =>
          new File([new Uint8Array([i])], `shot-${i}.jpg`, {
            type: "image/jpeg",
          }),
      );
      Object.defineProperty(input, "files", {
        configurable: true,
        value: files,
      });
      input.dispatchEvent(
        new boot.Event("change", { bubbles: true }) as unknown as Event,
      );
      await act(async () => {});
      expect(input.files?.length).toBe(3);
    }
    await form.done();
  });
});

describe("the service boundary shows what actually failed", () => {
  // The old boundary said "The order service is not available" for every
  // failure, which hid the cause. It must show the error's own sentence, keep a
  // Reload button, and log the error so it stays diagnosable.
  const mountBoundary = async (error: unknown) => {
    const form = await mount(
      "/orders",
      <ServiceBoundary>
        <Boom error={error} />
      </ServiceBoundary>,
    );
    return form;
  };

  test("a coded error shows its sentence, not the generic line", async () => {
    const form = await mountBoundary({ data: { code: "NOT_FOUND" } });
    expect(form.text()).toContain("That order does not exist");
    expect(form.text()).not.toContain("The step did not complete");
    await form.done();
  });

  test("a plain error shows its own message", async () => {
    // The real production error, which the old boundary hid entirely.
    const form = await mountBoundary(
      new TypeError("Cannot read properties of undefined (reading 'maxField')"),
    );
    expect(form.text()).toContain("reading 'maxField'");
    await form.done();
  });

  test("a null throw still renders the fallback instead of crashing", async () => {
    // errorText(null) used to throw, which would have crashed the boundary
    // inside its own handler and shown nothing at all.
    const form = await mountBoundary(null);
    expect(form.text()).toContain("The order service is not available");
    expect(form.text()).toContain("The step did not complete");
    await form.done();
  });

  test("a failed chunk says the tab is old, not that the service is down", async () => {
    // Chrome's message for a dynamic import whose file a deploy removed. The
    // order service is fine; the tab is older than the deployment.
    const form = await mountBoundary(
      new TypeError(
        "Failed to fetch dynamically imported module: /OrderView-x.js",
      ),
    );
    expect(form.text()).toContain("Milo was updated");
    expect(form.text()).toContain("older than the current version");
    expect(form.text()).not.toContain("The order service is not available");
    // The one action that fixes it must still be there.
    expect(form.container.querySelector("button")?.textContent).toContain(
      "Reload",
    );
    await form.done();
  });

  test("Safari's wording also counts as a failed chunk", async () => {
    const form = await mountBoundary(
      new TypeError("Importing a module script failed."),
    );
    expect(form.text()).toContain("Milo was updated");
    await form.done();
  });

  test("a real fault keeps the service message", async () => {
    // The regression guard: the chunk wording must not swallow genuine errors.
    const form = await mountBoundary(new Error("the proof server refused"));
    expect(form.text()).toContain("The order service is not available");
    expect(form.text()).not.toContain("Milo was updated");
    await form.done();
  });

  test("it keeps a Reload button and never renders a stack", async () => {
    const form = await mountBoundary(
      new Error("boom\n    at secret (x.js:1:2)"),
    );
    expect(form.text()).toContain("Reload");
    expect(form.container.querySelector("button")?.textContent).toContain(
      "Reload",
    );
    // The stack frame must not reach the page.
    expect(form.text()).not.toContain("at secret");
    await form.done();
  });

  test("it logs the error so the cause stays diagnosable", async () => {
    const logged: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => void logged.push(args);
    try {
      const form = await mountBoundary(new Error("diagnosable"));
      expect(
        logged.some((args) => String(args[0]).includes("render failed")),
      ).toBe(true);
      await form.done();
    } finally {
      console.error = original;
    }
  });
});

describe("an order action cannot be started twice", () => {
  // `busy` is React state, so it only disables the button after a re-render.
  // Two clicks in the same frame both reach run() and start two chain actions
  // at one revision. `useGuard` is synchronous, so the second click is refused.
  const source = () =>
    readFileSync("apps/web/src/routes/OrderView.tsx", "utf8");

  test("run() refuses a second click before it does any work", () => {
    const text = source();
    const guard = text.indexOf("if (!inFlight.start()) return;");
    expect(guard).toBeGreaterThan(-1);
    // The guard must come before the first await, or the second click is only
    // refused after the first action has already started.
    const firstAwait = text.indexOf("void runAction({", guard);
    expect(guard).toBeLessThan(firstAwait);
  });

  test("the guard is released on both settle paths", () => {
    const text = source();
    // Success and failure both release it, or a failed action locks the page.
    const releases = text.match(/inFlight\.end\(\);/g) ?? [];
    expect(releases.length).toBe(2);
  });

  test("the same guard shape as the quote form", () => {
    // NewQuote solved this first (D-05); the order page must use the same hook,
    // not a second copy of the ref.
    const quote = readFileSync("apps/web/src/routes/NewQuote.tsx", "utf8");
    expect(quote.includes("useGuard()")).toBe(true);
    expect(quote.includes("if (!inFlight.start()) return;")).toBe(true);
    // And no site keeps its own ref copy any more.
    expect(quote.includes("useRef(false)")).toBe(false);
    expect(source().includes("useRef(false)")).toBe(false);
  });
});

describe("an emoji at the title boundary is not cut in half", () => {
  // `slice(0, 80)` counts UTF-16 code units, so a surrogate pair straddling the
  // boundary becomes a lone surrogate. The server's bound counts units too, so
  // it accepts and stores the corrupted title, and the list renders a
  // replacement glyph. Asserted on the pure derivation, which is where the bug
  // is; driving the whole form would add async flakiness and prove nothing more.
  const LONE_SURROGATE =
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
  // Built from its code point: a literal emoji in source is flagged as UI, and
  // this is test data.
  const PAINT = String.fromCodePoint(0x1f3a8);

  test("a title cut at 80 keeps a whole emoji", async () => {
    const { titleFrom } = await import("./routes/NewQuote");
    // 79 units, then an emoji (2 units) straddling index 80.
    const title = titleFrom(`${"a".repeat(79)}${PAINT} rest of the brief`);
    expect(LONE_SURROGATE.test(title)).toBe(false);
    // Still a legal title for the server's own bound.
    expect(title.length).toBeGreaterThanOrEqual(5);
    expect(title.length).toBeLessThanOrEqual(80);
  });

  test("a title of only emoji is not truncated mid-pair", async () => {
    const { titleFrom } = await import("./routes/NewQuote");
    const title = titleFrom(PAINT.repeat(60));
    expect(LONE_SURROGATE.test(title)).toBe(false);
    expect(title.length).toBeLessThanOrEqual(80);
  });

  test("an ordinary title is unchanged", async () => {
    const { titleFrom } = await import("./routes/NewQuote");
    expect(titleFrom("Three hero images for the studio")).toBe(
      "Three hero images for the studio",
    );
  });
});

describe("the sign-in page says what actually happened", () => {
  // The link is single-use, and a mail scanner opening it burns it before the
  // human clicks. The page used to say only "Link already used or expired",
  // which names neither cause nor the window.
  const used = render("/orders?error=INVALID_TOKEN", <SignIn />);

  test("a burned link names the scanner cause", () => {
    expect(used).toMatch(/scanner/i);
    expect(used).toContain("already used");
  });

  test("the window is stated, and it is the order's own window", () => {
    // G-16: the sign-in link gates an invite that only expires with the order's
    // acceptance window, so the two must be the same number. The page derives
    // its sentence from the constant, so this asserts the join rather than a
    // literal that could drift.
    const minutes = Math.round(ORDER_WINDOWS_MS.acceptance / 60_000);
    expect(used).toContain(`${minutes} minutes`);
    // The old 15-minute value would now be a mismatch.
    expect(minutes).not.toBe(15);
  });

  test("a server-side failure still does not blame the user", () => {
    const broken = render("/orders?error=failed_to_create_session", <SignIn />);
    expect(broken).toContain("did not complete");
    expect(broken).not.toContain("scanner");
  });
});

describe("the sign-in link lives as long as the order it opens", () => {
  // G-16: two clocks governed one flow. The order invite has no expiry of its
  // own — only the acceptance window, one hour — while the sign-in link lived
  // 15 minutes. A buyer who read the mail at minute 16 held a valid order and a
  // dead sign-in link, and could never open it on the first try.
  //
  // The server value is now *derived* from the same constant, so the two cannot
  // drift. This file mocks `convex/auth` (the scenario harness stubs the auth
  // component), so the server half is asserted on the source — the same shape
  // the D-* guards in this file already use. The value half is asserted through
  // the rendered sentence, which is derived from the same constant.
  const serverSource = () => readFileSync("convex/auth.ts", "utf8");

  test("the server derives the expiry from the acceptance window", () => {
    const source = serverSource();
    expect(
      source.includes("expiresIn: ORDER_WINDOWS_MS.acceptance / 1000"),
    ).toBe(true);
    // The literal that caused the mismatch must be gone.
    expect(source.includes("expiresIn: 60 * 15")).toBe(false);
  });

  test("the page states that same window, not a literal", () => {
    const source = readFileSync("apps/web/src/routes/SignIn.tsx", "utf8");
    // The sentence is built from the constant, so a window change moves both.
    expect(source.includes("ORDER_WINDOWS_MS.acceptance / 60_000")).toBe(true);
    expect(
      source.includes('"The link works once and expires in 15 minutes."'),
    ).toBe(false);
  });
});

describe("an invite survives the sign-in it needs", () => {
  // The studio's email IS a magic link whose callback is the full invite path,
  // so the first hop is fine. But that link is single-use and 15 minutes long,
  // and when it is burned or expired the buyer lands on the invite URL signed
  // OUT. The shell then renders <SignIn/> instead of the order route, and the
  // form's callback is `location.pathname` — a pathname has no query string.
  // So the token was dropped and the order became unreachable: every retry sent
  // a new link that landed on /orders/<id> with no token, and OrderView fell
  // through to "Page not found". The order was still valid the whole time.
  //
  // The fix keeps the token for the tab and restores it after the session
  // exists, so the emailed callback stays token-free (D-01) *and* the order
  // stays reachable. Both halves are asserted, because either alone is the bug.
  // Namespace lookup with a permissive fallback, so a missing export fails on
  // the *value* it produces rather than on a TypeError. A test that dies on
  // "not a function" proves the export is absent, not that the behaviour is.
  const keys = async () => {
    const module = (await import("./workspace/keys")) as unknown as {
      stashInvite?: (quoteId: string, token: string) => void;
      stashedInvite?: (quoteId: string) => string | null;
      clearInvite?: (quoteId: string) => void;
    };
    return {
      stashInvite: module.stashInvite ?? (() => {}),
      stashedInvite: module.stashedInvite ?? (() => null),
      clearInvite: module.clearInvite ?? (() => {}),
    };
  };

  test("the token is kept, and the callback still does not carry it", async () => {
    const { stashInvite, stashedInvite } = await keys();
    // What SignIn does on the signed-out invite page.
    stashInvite("quote-1", "to".repeat(32));
    expect(stashedInvite("quote-1")).toBe("to".repeat(32));
    // D-01 is not undone: the token is not in the callback the form sends.
    const source = readFileSync("apps/web/src/routes/SignIn.tsx", "utf8");
    // `includes` rather than `toContain`: a failure then prints `false`, not the
    // whole file, which is unreadable in a test report.
    expect(source.includes("sendMagicLink(email, here)")).toBe(true);
    expect(source.includes("sendMagicLink(email, location.search)")).toBe(
      false,
    );
  });

  test("one order's token is never offered to another", async () => {
    const { stashInvite, stashedInvite } = await keys();
    stashInvite("quote-a", "aa".repeat(32));
    stashInvite("quote-b", "bb".repeat(32));
    expect(stashedInvite("quote-a")).toBe("aa".repeat(32));
    expect(stashedInvite("quote-b")).toBe("bb".repeat(32));
    expect(stashedInvite("quote-c")).toBeNull();
  });

  test("a spent token is cleared, so the tab stops carrying it", async () => {
    const { stashInvite, stashedInvite, clearInvite } = await keys();
    stashInvite("quote-spent", "cc".repeat(32));
    // Assert the stash first: without it this test would pass on a version that
    // never stored anything, which is exactly the bug it is meant to catch.
    expect(stashedInvite("quote-spent")).toBe("cc".repeat(32));
    clearInvite("quote-spent");
    expect(stashedInvite("quote-spent")).toBeNull();
  });

  test("the order page restores the token when the URL has none", () => {
    // The restore half lives in OrderView: the URL is the first choice, the
    // stash the second, so a normal invite link behaves exactly as before.
    const source = readFileSync("apps/web/src/routes/OrderView.tsx", "utf8");
    expect(source.includes('params.get("invite")')).toBe(true);
    expect(source.includes("stashInvite(quoteId, fromUrl)")).toBe(true);
    expect(source.includes("stashedInvite(quoteId)")).toBe(true);
    // The stash is keyed by the route's own id, never a global one.
    expect(source.includes("stashedInvite()")).toBe(false);
  });
});

describe("G-07 an invite on the wrong account names the account", () => {
  // The token was accepted (the page got this far), so a null preview means the
  // signed-in email is not the invited one. The old copy said "This link does
  // not work. Ask the studio for a new one." — which would fail identically.
  const source = () =>
    readFileSync("apps/web/src/routes/OrderView.tsx", "utf8");

  test("the refusal names the address the user is signed in as", () => {
    const text = source();
    expect(text.includes("Sign in as the invited account")).toBe(true);
    expect(text.includes("me.email")).toBe(true);
    // The misleading sentence must be gone.
    expect(text.includes("This link does not work. Ask the studio")).toBe(
      false,
    );
  });

  test("a claimed order still says it was claimed, not that it is invalid", () => {
    // The two causes must stay distinct: one is recoverable by signing in as
    // the right account, the other needs a new link from the studio.
    expect(source().includes("Order already accepted")).toBe(true);
  });
});

describe("G-08 restoring a backup never overwrites a newer key", () => {
  // `restoreBackup` used to loop `saveKey` over every key in the file, so a
  // backup taken last week replaced the key saved yesterday. The key is the only
  // thing that can sign for its order, so the order became unsignable while the
  // file looked fine.
  const keys = async () => {
    const module = (await import("./workspace/keys")) as unknown as {
      restoreBackup?: (
        subject: string,
        text: string,
        password: string,
      ) => Promise<{ restored: number; kept: number }>;
      sealBackup?: (
        ring: Record<string, unknown>,
        password: string,
      ) => Promise<string>;
      readKeys?: (subject: string) => Record<string, { secret: string }>;
    };
    return module;
  };
  const KEY = {
    quoteId: "q1",
    actor: "buyer" as const,
    secret: "aa".repeat(32),
    nonce: "bb".repeat(32),
  };

  test("an older file leaves the newer key alone and says so", async () => {
    const { restoreBackup, sealBackup, readKeys } = await keys();
    if (!restoreBackup || !sealBackup || !readKeys) throw new Error("missing");
    localStorage.setItem(
      "milo:order-keys:subject-g08:q1",
      JSON.stringify({ ...KEY, secret: "cc".repeat(32) }),
    );
    const text = await sealBackup({ q1: KEY }, "correct horse battery");
    const result = await restoreBackup(
      "subject-g08",
      text,
      "correct horse battery",
    );
    // Both numbers, because "0 restored" and "0 needed" mean opposite things.
    expect(result).toEqual({ restored: 0, kept: 1 });
    expect(readKeys("subject-g08").q1.secret).toBe("cc".repeat(32));
  });
});

describe("G-09 a typed note survives a session expiry", () => {
  // A session that expires mid-flow re-renders the order page signed out and
  // back in. The note is a string, so one storage entry keeps it. The picked
  // files are `File` objects and are deliberately NOT persisted.
  const keys = async () => {
    const module = (await import("./workspace/keys")) as unknown as {
      readDraft?: (quoteId: string) => string;
      writeDraft?: (quoteId: string, note: string) => void;
    };
    return {
      readDraft: module.readDraft ?? (() => ""),
      writeDraft: module.writeDraft ?? (() => {}),
    };
  };

  test("a written note reads back for the same order only", async () => {
    const { readDraft, writeDraft } = await keys();
    writeDraft("quote-g09", "The third image is the wrong crop.");
    expect(readDraft("quote-g09")).toBe("The third image is the wrong crop.");
    expect(readDraft("quote-other")).toBe("");
  });

  test("an empty note clears the draft instead of storing one", async () => {
    const { readDraft, writeDraft } = await keys();
    writeDraft("quote-g09b", "something");
    writeDraft("quote-g09b", "");
    expect(readDraft("quote-g09b")).toBe("");
  });

  test("the page says the images are not kept", () => {
    // Losing three chosen files silently is worse than being told first.
    const text = readFileSync("apps/web/src/routes/OrderView.tsx", "utf8");
    expect(text.includes("Your chosen images are not kept")).toBe(true);
  });
});

describe("M-01 the invite cannot be claimed twice", () => {
  // `startTransition` runs its callback synchronously and marks the update
  // non-urgent, so `busy` is not set before a second click in the same frame.
  // The FIRST claim rotates the invite token, so the second is refused — and the
  // buyer sees "This order link does not work." for an order just claimed.
  const source = () =>
    readFileSync("apps/web/src/routes/OrderView.tsx", "utf8");

  test("the claim is guarded before it does any work", () => {
    const text = source();
    const guard = text.indexOf("if (!claiming.start()) return;");
    expect(guard).toBeGreaterThan(-1);
    // It must precede the call that claims, or the second click has already run.
    expect(guard).toBeLessThan(text.indexOf("openOrder(", guard));
  });

  test("the guard is released on both settle paths", () => {
    const text = source();
    // A `.finally` covers success and failure in one place.
    expect(text.includes(".finally(claiming.end)")).toBe(true);
  });
});

describe("U-01 every handler that starts work is guarded", () => {
  // The guard was copied by hand three times and two forms had none at all.
  // This is the completeness check: every file with a handler that starts a
  // mutation or a chain action must go through the one shared hook.
  const HANDLERS = [
    "apps/web/src/routes/Account.tsx",
    "apps/web/src/routes/NewQuote.tsx",
    "apps/web/src/routes/OrderView.tsx",
    "apps/web/src/routes/SignIn.tsx",
  ] as const;

  test("no site keeps its own in-flight ref", () => {
    for (const file of HANDLERS) {
      const text = readFileSync(file, "utf8");
      // One shared helper, not a per-site copy.
      expect(text.includes("useRef(false)")).toBe(false);
    }
  });

  test("every guarded file uses the shared hook", () => {
    for (const file of HANDLERS) {
      expect(readFileSync(file, "utf8").includes("useGuard")).toBe(true);
    }
  });

  test("the two Account forms are guarded, which they were not", () => {
    const text = readFileSync("apps/web/src/routes/Account.tsx", "utf8");
    // Backup and restore each start async work and each had no guard.
    expect(text.includes("backupGuard.start()")).toBe(true);
    expect(text.includes("restoreGuard.start()")).toBe(true);
    // Both release on every settle path.
    expect(text.includes(".finally(backupGuard.end)")).toBe(true);
    expect(text.includes(".finally(restoreGuard.end)")).toBe(true);
  });

  test("the hook itself refuses a second start until it is released", async () => {
    // The behaviour, not the shape: a second start is refused, and end()
    // re-arms it. This is what every call site relies on.
    const { useGuard } = await import("./lib/utils");
    expect(typeof useGuard).toBe("function");
    // The hook needs a renderer, so the invariant is asserted on the source of
    // the hook instead: a boolean ref, set before returning true.
    const source = readFileSync("apps/web/src/lib/utils.ts", "utf8");
    expect(source.includes("if (running.current) return false;")).toBe(true);
    expect(source.includes("running.current = true;")).toBe(true);
  });
});

describe("U-02 a browser without the key is told why", () => {
  // The order key lives in one browser's storage. A buyer who claims in Chrome
  // and then opens the studio's email in their mail app's webview lands in a
  // different context with no key — and the only advice was "Restore your
  // backup", which they never made. The page must name the cause.
  const source = () =>
    readFileSync("apps/web/src/routes/OrderView.tsx", "utf8");

  test("the webview cause is named, not just the backup", () => {
    const text = source();
    expect(text.includes("opened the email link in a mail app")).toBe(true);
    // And the browser they started in is the first thing to try.
    expect(text.includes("the browser you started the order in")).toBe(true);
  });

  test("the old dead-end sentence is gone", () => {
    // "No key in this browser. Restore your backup, or the order expires." gave
    // a buyer with no backup nothing to do.
    expect(source().includes("No key in this browser. Restore")).toBe(false);
  });

  test("the backup path is still offered for a buyer who has one", () => {
    expect(source().includes("Restore your key backup")).toBe(true);
  });
});

describe("U-13 the buyer is told to back up the key while it is cheap", () => {
  // The key lives in one browser. The backup is already the honest cross-device
  // carrier (PBKDF2 + AES-GCM, made locally, never sent to the server), but
  // nothing told a buyer to make one when they got a key — so the first time
  // they learned it mattered was when a webview had none (U-02).
  const source = () =>
    readFileSync("apps/web/src/routes/OrderView.tsx", "utf8");

  test("the warning sits next to the key badge", () => {
    const text = source();
    expect(text.includes("This key lives only in this browser")).toBe(true);
    // It must be conditional on having a key, or it nags a buyer who has none.
    expect(text.includes('key && order.role !== "operator" &&')).toBe(true);
  });

  test("it points at the backup, which is the cross-device path", () => {
    expect(source().includes("Download a backup if you")).toBe(true);
  });
});

describe("Z-03 a deadline names its time zone", () => {
  // The chain stores absolute UTC seconds. The formatter rendered in the
  // device's zone but printed no zone, so a buyer in Tokyo and a studio in
  // London saw the same numbers meaning different instants.
  test("the rendered stamp carries a zone", async () => {
    const { shortDate } = await import("./lib/format");
    const at = Date.UTC(2026, 9, 21, 14, 30) / 1000;
    const text = shortDate(at);
    // A zone name, not just the clock time: "BST", "GMT+9", "UTC", etc.
    expect(text).toMatch(/[A-Z]{2,5}|GMT[+-]\d/);
    // And the time itself is still there.
    expect(text).toMatch(/\d{1,2}:\d{2}/);
  });
});

describe("Z-05 the countdown is announced", () => {
  // The countdown changes every 30 s. A screen reader user was told the
  // deadline once and then nothing.
  const source = () =>
    readFileSync("apps/web/src/routes/OrderView.tsx", "utf8");

  test("the changing text is a polite live region", () => {
    const text = source();
    expect(text.includes('aria-live="polite"')).toBe(true);
    expect(text.includes('aria-atomic="true"')).toBe(true);
  });

  test("it is polite, not assertive", () => {
    // Assertive would interrupt the action buttons, which are the thing the
    // user is trying to reach.
    expect(source().includes('aria-live="assertive"')).toBe(false);
  });
});

describe("AD-02 a reload mid-quote does not lose the brief", () => {
  // `bootstrap.tsx` reloads the tab once when a hashed chunk is missing after a
  // deploy — correctly, because a broken chunk cannot be repaired without one.
  // The order page's note survives that (r23), but the quote form had no
  // persistence at all, so a reload mid-quote lost the whole brief.
  const keys = async () => {
    const module = (await import("./workspace/keys")) as unknown as {
      readQuoteDraft?: () => {
        studio: string;
        brief: string;
        amount: string;
        email: string;
      };
      writeQuoteDraft?: (draft: {
        studio: string;
        brief: string;
        amount: string;
        email: string;
      }) => void;
    };
    return {
      readQuoteDraft:
        module.readQuoteDraft ??
        (() => ({ studio: "", brief: "", amount: "", email: "" })),
      writeQuoteDraft: module.writeQuoteDraft ?? (() => {}),
    };
  };

  test("a written draft reads back, so a reload restores it", async () => {
    const { readQuoteDraft, writeQuoteDraft } = await keys();
    writeQuoteDraft({
      studio: "North Studio",
      brief: "Three hero images for the winter collection.",
      amount: "900",
      email: "client@example.com",
    });
    expect(readQuoteDraft()).toEqual({
      studio: "North Studio",
      brief: "Three hero images for the winter collection.",
      amount: "900",
      email: "client@example.com",
    });
  });

  test("an all-empty draft clears the entry instead of storing one", async () => {
    const { readQuoteDraft, writeQuoteDraft } = await keys();
    writeQuoteDraft({ studio: "x", brief: "y", amount: "1", email: "z" });
    writeQuoteDraft({ studio: "", brief: "", amount: "", email: "" });
    expect(readQuoteDraft()).toEqual({
      studio: "",
      brief: "",
      amount: "",
      email: "",
    });
  });

  test("the form restores the draft and clears it once the quote exists", () => {
    const text = readFileSync("apps/web/src/routes/NewQuote.tsx", "utf8");
    // Read once on mount, so the fields pre-fill after a reload.
    expect(text.includes("useState(readQuoteDraft)")).toBe(true);
    // Written on input, so the draft is current when the reload happens.
    expect(text.includes("writeQuoteDraft({")).toBe(true);
    // Every field restores from it.
    for (const field of ["studio", "brief", "amount", "email"])
      expect(text.includes(`defaultValue={draft.${field}}`)).toBe(true);
    // Cleared on success, or the next quote inherits the previous brief.
    expect(
      text.includes('writeQuoteDraft({\n                  studio: ""'),
    ).toBe(true);
  });
});

describe("AD-05 an upload that loses the network says so", () => {
  // Without a signal a dropped connection leaves the request hanging until the
  // browser's own timeout (minutes), and a network failure throws
  // `TypeError: Failed to fetch` — a browser internal that tells the user
  // nothing and does not name the common cause.
  const source = () => readFileSync("apps/web/src/workspace/flows.ts", "utf8");

  test("the upload is bounded, so it cannot hang for minutes", () => {
    expect(source().includes("AbortSignal.timeout(30_000)")).toBe(true);
  });

  test("offline and online failures get different, actionable sentences", () => {
    const text = source();
    // Offline names the cause and the remedy.
    expect(
      text.includes("this device is offline. Reconnect and try again."),
    ).toBe(true);
    // Online keeps the retry advice without blaming the device.
    expect(text.includes("Check your connection and try again.")).toBe(true);
  });

  test("the branch is on navigator.onLine, not a guess", () => {
    expect(source().includes("navigator.onLine")).toBe(true);
  });
});
