import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { ORDER_WINDOWS_MS } from "../../../packages/backend/src/order-windows";
import * as authClient from "./auth-client";
import { Button } from "./components/ui/button";
import { Alert, CODE_TEXT, errorText } from "./components/workspace";
import { PublicApp } from "./public-main";
import { SignIn } from "./routes/SignIn";
import { WorkspaceNotFound } from "./routes/WorkspaceNotFound";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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
    "D-01 sign-in sends the path, not the token-bearing href",
    "apps/web/src/routes/SignIn.tsx",
    "location.pathname",
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
    "inFlight.current",
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

  test("D-02 the key is saved only after the server accepted it", () => {
    const source = readFileSync("apps/web/src/workspace/flows.ts", "utf8");
    expect(source.indexOf("saveKey(subject, key)")).toBeGreaterThan(
      source.indexOf("api.acceptInvite"),
    );
  });

  test("D-11 the guard is the first statement after preventDefault", () => {
    const source = readFileSync("apps/web/src/routes/NewQuote.tsx", "utf8");
    expect(source.indexOf("if (inFlight.current) return;")).toBeGreaterThan(
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
    expect(used).toContain("Link already used or expired");
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
  // is cleared. A static render cannot show that: the state never changes. This
  // mounts the real form, submits it and reads the DOM after.
  test("the heading stops saying the link is dead", async () => {
    const window = new Window({
      url: "http://localhost/orders?error=INVALID_TOKEN",
    });
    const slots = globalThis as unknown as Record<string, unknown>;
    slots.window = window;
    for (const key of Object.getOwnPropertyNames(window))
      if (!(key in globalThis)) slots[key] = (window as never)[key];
    const container = window.document.createElement("div");
    window.document.body.append(container as never);
    const root = createRoot(container as unknown as HTMLElement);
    await act(async () =>
      root.render(
        <MemoryRouter initialEntries={["/orders?error=INVALID_TOKEN"]}>
          <SignIn />
        </MemoryRouter>,
      ),
    );

    const heading = () => container.querySelector("h1")?.textContent ?? "";
    expect(heading()).toContain("Request a new link");

    const input = container.querySelector("input[type=email]");
    const form = container.querySelector("form");
    if (!input || !form) throw new Error("form not mounted");
    (input as unknown as { value: string }).value = "a@b.co";
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    await act(async () =>
      form.dispatchEvent(
        new window.Event("submit", { bubbles: true, cancelable: true }),
      ),
    );

    expect(heading()).not.toContain("Request a new link");
    await act(async () => root.unmount());
    window.close();
  });
});
