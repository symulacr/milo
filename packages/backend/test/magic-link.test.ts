import { describe, expect, test } from "bun:test";
import {
  classifyFailure,
  EmailSendError,
  emailBody,
  emailFailureText,
  inviteFailureReason,
  mailConfig,
  mailProvider,
  sendEmail,
} from "../src/email";

const URL =
  "https://tremendous-rooster-473.convex.site/api/auth/magic-link/verify?token=abc";

describe("the one email body", () => {
  test("carries the single-use link in text and HTML", () => {
    const body = emailBody(URL);
    expect(body.text).toContain(URL);
    expect(body.html).toContain(URL);
    expect(body.text).toContain("single-use");
    expect(body.html).toContain("single-use");
  });

  test("escapes the link so an injected quote cannot break out of the anchor", () => {
    const body = emailBody('https://x/?a="><script>alert(1)</script>');
    expect(body.html).not.toContain("<script>");
    expect(body.html).toContain("&quot;");
    expect(body.html).toContain("&lt;script&gt;");
  });

  test("names the studio when the email carries an invite", () => {
    expect(emailBody(URL, "North Studio").subject).toContain("North Studio");
    expect(emailBody(URL).subject).toContain("sign-in");
  });
});

/**
 * The three providers, table-driven. Every free provider that can send without
 * an owned domain has a different envelope, so the table is the whole difference
 * between them; these rows pin the URL, the auth header and the body shape
 * against each provider's own docs (verified 2026-10-26).
 */
const PROVIDER_ROWS = [
  {
    provider: "resend",
    keyEnv: "RESEND_API_KEY",
    url: "https://api.resend.com/emails",
    authHeader: "authorization",
    authValue: "Bearer re_test_key",
    body: { from: "Milo <sign-in@milo.example>", to: ["buyer@example.com"] },
  },
  {
    provider: "agentmail",
    keyEnv: "AGENTMAIL_API_KEY",
    // The inbox id IS the sending address, and the `@` must be encoded.
    url: "https://api.agentmail.to/v0/inboxes/Milo%20%3Csign-in%40milo.example%3E/messages/send",
    authHeader: "authorization",
    authValue: "Bearer re_test_key",
    body: { to: "buyer@example.com" },
  },
  {
    provider: "brevo",
    keyEnv: "BREVO_API_KEY",
    url: "https://api.brevo.com/v3/smtp/email",
    authHeader: "api-key",
    authValue: "re_test_key",
    body: {
      sender: { email: "Milo <sign-in@milo.example>" },
      to: [{ email: "buyer@example.com" }],
    },
  },
] as const;

/**
 * Set env vars for the duration of `run`, then restore every one of them —
 * including names that were previously unset. One helper, because every suite
 * below needs exactly this and three copies of it drifted in earlier rounds.
 */
async function withEnv<T>(
  vars: Record<string, string | undefined>,
  run: () => Promise<T>,
): Promise<T> {
  const previous = Object.fromEntries(
    Object.keys(vars).map((k) => [k, process.env[k]]),
  );
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await run();
  } finally {
    for (const [k, v] of Object.entries(previous)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/** Run `sendEmail` under one provider and capture the one request it made. */
const capture = (provider: string) =>
  withEnv({ MAIL_PROVIDER: provider }, async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const send = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;
    await sendEmail({
      to: "buyer@example.com",
      url: URL,
      apiKey: "re_test_key",
      from: "Milo <sign-in@milo.example>",
      send,
    });
    return calls[0] as { url: string; init: RequestInit };
  });

describe("email delivery", () => {
  test.each(PROVIDER_ROWS)(
    "$provider posts its own URL, auth header and body",
    async (row) => {
      const call = await capture(row.provider);
      expect(call.url).toBe(row.url);
      expect(call.init.method).toBe("POST");
      const headers = call.init.headers as Record<string, string>;
      expect(headers[row.authHeader]).toBe(row.authValue);
      expect(headers["content-type"]).toBe("application/json");
      const body = JSON.parse(String(call.init.body)) as Record<
        string,
        unknown
      >;
      // The provider-specific envelope, plus the link in both parts.
      expect(body).toMatchObject(row.body);
      expect(String(body.text ?? body.textContent)).toContain(URL);
      expect(String(body.html ?? body.htmlContent)).toContain(URL);
    },
  );

  test("an unknown MAIL_PROVIDER falls back to resend, not to nothing", async () => {
    // A typo must not silently disable email; the default is the documented one.
    expect((await capture("sendgrid")).url).toBe(
      "https://api.resend.com/emails",
    );
  });

  // The message names the *selected* provider's variable, so an operator who
  // switched to AgentMail is not told to set RESEND_API_KEY. Nothing is sent.
  test.each(PROVIDER_ROWS)(
    "a missing $keyEnv fails closed naming $keyEnv",
    async (row) => {
      let called = false;
      const send = (async () => {
        called = true;
        return new Response(null, { status: 200 });
      }) as unknown as typeof fetch;
      const previous = process.env.MAIL_PROVIDER;
      process.env.MAIL_PROVIDER = row.provider;
      try {
        await expect(
          sendEmail({ to: "a@b.c", url: URL, apiKey: "", from: "x", send }),
        ).rejects.toThrow(new RegExp(row.keyEnv));
        // A missing sender is refused for every provider too.
        await expect(
          sendEmail({ to: "a@b.c", url: URL, apiKey: "k", from: "", send }),
        ).rejects.toThrow(/MAIL_FROM/);
      } finally {
        if (previous === undefined) delete process.env.MAIL_PROVIDER;
        else process.env.MAIL_PROVIDER = previous;
      }
      expect(called).toBe(false);
    },
  );

  test("surfaces a provider refusal without leaking the key", async () => {
    const send = (async () =>
      new Response("nope", { status: 422 })) as unknown as typeof fetch;
    const failure = sendEmail({
      to: "a@b.c",
      url: URL,
      apiKey: "re_secret_value",
      from: "Milo <sign-in@milo.example>",
      send,
    });
    await expect(failure).rejects.toThrow(/422/);
    await expect(failure).rejects.not.toThrow(/re_secret_value/);
  });

  /** A sender that always refuses with a provider's own body shape. */
  const refusing = (status: number, body: unknown) =>
    (async () => Response.json(body, { status })) as unknown as typeof fetch;

  // Real bodies from each provider's error reference. The message is what
  // distinguishes the several 403 causes, so it must be read; AgentMail's
  // `code` is what separates a restricted sender from a suspension.
  const REFUSALS: readonly (readonly [string, number, unknown, RegExp])[] = [
    [
      "Resend: testing sender wrote to a third party",
      403,
      {
        name: "validation_error",
        message:
          "You can only send testing emails to your own email address (owner@studio.example). To send emails to other recipients, please verify a domain at resend.com/domains, and change the from address to an email using this domain.",
      },
      /verify a domain/i,
    ],
    [
      "Resend: from domain not verified",
      403,
      {
        name: "validation_error",
        message:
          "The milo.example domain is not verified. Please, add and verify your domain.",
      },
      /has not verified/i,
    ],
    [
      "AgentMail: org not verified",
      403,
      {
        code: "message_rejected",
        message: "Forbidden",
        fix: "Verify your organization at console.agentmail.to/claim before sending to this recipient.",
      },
      /not verified.*console\.agentmail\.to\/claim/i,
    ],
    [
      "AgentMail: account suspended",
      403,
      {
        code: "account_suspended",
        message: "Forbidden",
        suspended_reason: "message.bounced",
      },
      /refused this message/i,
    ],
    [
      "AgentMail: rate limited",
      429,
      { code: "rate_limit_exceeded", message: "Too many requests" },
      /rate limiting/i,
    ],
    [
      "Brevo: required field missing",
      400,
      { code: "missing_parameter", message: "sender is required" },
      /refused this message/i,
    ],
    [
      "any provider down",
      503,
      { message: "temporarily unavailable" },
      /unavailable/i,
    ],
  ];

  for (const [label, status, body, hint] of REFUSALS)
    test(`a ${status} refusal for ${label} is classified`, async () => {
      const failure = sendEmail({
        to: "a@b.c",
        url: URL,
        apiKey: "re_secret_value",
        from: "Milo <sign-in@milo.example>",
        send: refusing(status, body),
      });
      await expect(failure).rejects.toBeInstanceOf(EmailSendError);
      await expect(failure).rejects.toThrow(hint);
      // The API key must never reach the message the user reads.
      await expect(failure).rejects.not.toThrow(/re_secret_value/);
    });

  test("a network failure is reported as unreachable", async () => {
    const send = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    await expect(
      sendEmail({
        to: "a@b.c",
        url: URL,
        apiKey: "k",
        from: "Milo <x@y.z>",
        send,
      }),
    ).rejects.toThrow(/fetch failed/);
  });
});

describe("email failure classification", () => {
  test("each cause maps to its own actionable sentence", () => {
    const cases = [
      ["testing-sender", /verify a domain/i],
      ["sender-restricted", /console\.agentmail\.to\/claim/i],
      ["domain-unverified", /has not verified/i],
      ["key-invalid", /RESEND_API_KEY/],
      ["rate-limited", /rate limiting/i],
      ["rejected", /refused this message/i],
      ["provider-down", /unavailable/i],
      ["unreachable", /could not reach/i],
    ] as const;
    for (const [failure, hint] of cases)
      expect(emailFailureText({ failure, status: 500, detail: "" })).toMatch(
        hint,
      );
  });

  test("a failed send is a partial success, not an error", () => {
    // The quote and its invite link already exist, so the caller must get a
    // reason it can show, never a throw it would retry into a second quote.
    const reason = inviteFailureReason(
      new EmailSendError({
        failure: "testing-sender",
        status: 403,
        detail: "",
      }),
    );
    expect(reason).toMatch(/verify a domain/i);
    expect(reason).not.toMatch(/re_secret_value|Request ID/i);
    expect(inviteFailureReason(new Error("boom"))).toMatch(
      /could not send the email/i,
    );
    expect(inviteFailureReason("not an error")).toMatch(
      /could not send the email/i,
    );
  });

  test("reads the message, not only the status, to tell the 403s apart", () => {
    const testing = classifyFailure(403, {
      message: "You can only send testing emails to your own email address.",
    });
    const unverified = classifyFailure(403, {
      message: "The milo.example domain is not verified.",
    });
    expect(testing.failure).toBe("testing-sender");
    expect(unverified.failure).toBe("domain-unverified");
    expect(classifyFailure(403, { message: "something else" }).failure).toBe(
      "rejected",
    );
  });

  // AgentMail keeps the legacy message `Forbidden` on several 403s, so the code
  // is the only thing that separates them. Branching on `message` would report
  // a suspended account as a restricted sender and send the operator to the
  // wrong fix.
  test("branches on AgentMail's code, not its generic message", () => {
    const restricted = classifyFailure(403, {
      code: "message_rejected",
      message: "Forbidden",
      fix: "Verify your organization.",
    });
    const suspended = classifyFailure(403, {
      code: "account_suspended",
      message: "Forbidden",
    });
    expect(restricted.failure).toBe("sender-restricted");
    expect(suspended.failure).toBe("rejected");
    // The `fix` is more specific than the message, so it is what an operator sees.
    expect(restricted.detail).toBe("Verify your organization.");
    expect(classifyFailure(403, { code: "domain_not_verified" }).failure).toBe(
      "domain-unverified",
    );
  });
});

/**
 * The provider selection itself: which one is active, and that a diagnostics
 * read can report it by name without ever touching a value.
 */
describe("mail provider selection", () => {
  test("defaults to resend so nothing changes until MAIL_PROVIDER is set", async () => {
    await withEnv({ MAIL_PROVIDER: undefined }, async () => {
      expect(mailProvider()).toBe("resend");
    });
  });

  test.each(["resend", "agentmail", "brevo"])(
    "%s is selectable",
    async (name) => {
      await withEnv({ MAIL_PROVIDER: name }, async () => {
        expect(mailProvider()).toBe(name);
      });
    },
  );

  test("an unknown value falls back to resend", async () => {
    await withEnv({ MAIL_PROVIDER: "mailgun" }, async () => {
      expect(mailProvider()).toBe("resend");
    });
  });

  // The diagnostics contract: names and a boolean, never a value. This is what
  // makes it safe to log or show an operator.
  test("mailConfig reports names and presence, never the key", async () => {
    await withEnv(
      {
        MAIL_PROVIDER: "agentmail",
        AGENTMAIL_API_KEY: "am_us_supersecret",
        MAIL_FROM: "milo@agentmail.to",
      },
      async () => {
        const config = mailConfig();
        expect(config).toEqual({
          provider: "agentmail",
          keyEnv: "AGENTMAIL_API_KEY",
          keyPresent: true,
          from: "milo@agentmail.to",
        });
        expect(JSON.stringify(config)).not.toContain("am_us_supersecret");
      },
    );
  });

  test("a missing key for the selected provider is reported as absent", async () => {
    await withEnv(
      { MAIL_PROVIDER: "brevo", BREVO_API_KEY: undefined },
      async () => {
        expect(mailConfig()).toMatchObject({
          provider: "brevo",
          keyEnv: "BREVO_API_KEY",
          keyPresent: false,
        });
      },
    );
  });
});

/**
 * The transport seam. `RESEND_BASE_URL` still redirects a Resend send, which is
 * what W2's form-to-handler e2e captures mail through; `MAIL_BASE_URL` is the
 * provider-agnostic form. Both are kept because the first already has a
 * consumer and the second is what a non-Resend sandbox needs.
 */
describe("the transport seam", () => {
  const urlFor = async (vars: Record<string, string | undefined>) =>
    (
      await withEnv({ MAIL_PROVIDER: "resend", ...vars }, () =>
        capture("resend"),
      )
    ).url;

  test.each([
    [
      "RESEND_BASE_URL redirects a Resend send (W2's e2e seam)",
      { RESEND_BASE_URL: "http://127.0.0.1:8025/api/v1" },
      "http://127.0.0.1:8025/api/v1/emails",
    ],
    // `env()` treats "" as absent, so a half-set var cannot post to a relative URL.
    [
      "an empty RESEND_BASE_URL falls back",
      { RESEND_BASE_URL: "" },
      "https://api.resend.com/emails",
    ],
    // A `//emails` path is a 404 on most servers, and hand-typed values often
    // end in a slash.
    [
      "a trailing slash does not double up",
      { RESEND_BASE_URL: "http://mailpit:8025/api/v1/" },
      "http://mailpit:8025/api/v1/emails",
    ],
    // The generic form, so a Mailpit sandbox can capture any provider's send.
    [
      "MAIL_BASE_URL overrides the provider's host",
      { MAIL_BASE_URL: "http://mailpit:8025", RESEND_BASE_URL: undefined },
      "http://mailpit:8025/emails",
    ],
    [
      "MAIL_BASE_URL wins over RESEND_BASE_URL when both are set",
      {
        MAIL_BASE_URL: "http://generic:8025",
        RESEND_BASE_URL: "http://legacy:8025",
      },
      "http://generic:8025/emails",
    ],
  ])("%s", async (_label, vars, expected) => {
    expect(await urlFor(vars)).toBe(expected);
  });
});

/**
 * R24 G-02: a link prefetch must not consume the token, and the human's confirm
 * must. Assertions are by value on the response the browser would get.
 */
describe("R24 G-02: a link prefetch does not burn the magic link", () => {
  /** The Convex adapter binds to a Convex ctx at construction, so the shipped
   * instance cannot be driven here; the hook and the plugin are the real ones. */
  const makeAuth = async () => {
    const { betterAuth } = await import("better-auth/minimal");
    const { magicLink } = await import("better-auth/plugins");
    const { memoryAdapter } = await import("better-auth/adapters/memory");
    const { confirmMagicLink } = await import("../../../convex/auth");
    const db: Record<string, unknown[]> = {
      user: [],
      session: [],
      account: [],
      verification: [],
    };
    let sent = "";
    const auth = betterAuth({
      baseURL: "https://site.convex.site",
      secret: "t".repeat(40),
      database: memoryAdapter(db),
      hooks: { before: confirmMagicLink },
      plugins: [
        magicLink({
          sendMagicLink: async ({ url }: { url: string }) => {
            sent = url;
          },
        }),
      ],
    });
    const issue = async () => {
      await auth.handler(
        new Request("https://site.convex.site/api/auth/sign-in/magic-link", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "https://site.convex.site",
          },
          body: JSON.stringify({ email: "buyer@example.com" }),
        }),
      );
      // `URL` is this file's link fixture, so the global is named explicitly.
      return new globalThis.URL(sent).searchParams.get("token") ?? "";
    };
    const verify = (query: string, headers: Record<string, string> = {}) =>
      auth.handler(
        new Request(
          `https://site.convex.site/api/auth/magic-link/verify?${query}`,
          { method: "GET", redirect: "manual", headers },
        ),
      );
    return { issue, verify };
  };

  test("createAuth registers this exact hook before the verify endpoint runs", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(
      // `URL` is this file's link fixture, so the global is named explicitly.
      new globalThis.URL("../../../convex/auth.ts", import.meta.url),
      "utf8",
    );
    // Wiring by name: a test that built its own instance would keep passing
    // after the hook was deleted (the J-01 trap).
    expect(source).toMatch(/hooks: \{[^}]*before: confirmMagicLink[^}]*\}/);
    expect(source).toMatch(/hooks: \{[^}]*after: noReferrerOnVerify[^}]*\}/);
    // Both directions: a hook that always returned the page would deadlock
    // every sign-in, and one that never did would leave the hole open.
    expect(source).toContain('query.confirm === "1"');
  });

  test("the prefetch gets a confirm page, no cookie, and leaves the token valid", async () => {
    const { issue, verify } = await makeAuth();
    const token = await issue();
    const prefetch = await verify(`token=${token}&callbackURL=%2Forders`);
    expect(prefetch.status).toBe(200);
    expect(prefetch.headers.get("content-type")).toContain("text/html");
    // The whole point: a scanner must be handed a page, not a session.
    expect(prefetch.headers.getSetCookie()).toHaveLength(0);
    expect(prefetch.headers.get("cache-control")).toBe("no-store");
    expect(prefetch.headers.get("referrer-policy")).toBe("no-referrer");
    const page = await prefetch.text();
    expect(page).toContain('name="confirm" value="1"');
    // The token is echoed so the button reproduces the request, and escaped.
    expect(page).toContain(`name="token" value="${token}"`);
    expect(page).toContain("method=get");
  });

  test("the human's confirm consumes the token and signs in", async () => {
    const { issue, verify } = await makeAuth();
    const token = await issue();
    await verify(`token=${token}&callbackURL=%2Forders`);
    const confirmed = await verify(
      `token=${token}&callbackURL=%2Forders&confirm=1`,
    );
    expect(confirmed.status).toBe(302);
    expect(confirmed.headers.get("location")).toBe(
      "https://site.convex.site/orders",
    );
    const cookies = confirmed.headers.getSetCookie();
    expect(cookies).toHaveLength(1);
    // The session cookie is the proof of sign-in, and its attributes matter:
    // HttpOnly stops script access, Secure keeps it off plaintext, and the
    // __Secure- prefix makes the browser enforce Secure itself.
    expect(cookies[0]).toContain("__Secure-better-auth.session_token=");
    expect(cookies[0]).toContain("HttpOnly");
    expect(cookies[0]).toContain("Secure");
    expect(cookies[0]).toContain("SameSite=Lax");
  });

  test("after the human confirms, a second confirm is an invalid token", async () => {
    const { issue, verify } = await makeAuth();
    const token = await issue();
    await verify(`token=${token}&confirm=1`);
    const replay = await verify(`token=${token}&confirm=1`);
    expect(replay.status).toBe(302);
    expect(replay.headers.get("location")).toContain("error=INVALID_TOKEN");
    expect(replay.headers.getSetCookie()).toHaveLength(0);
  });

  test("the interstitial escapes a hostile callbackURL instead of echoing it", async () => {
    const { issue, verify } = await makeAuth();
    const token = await issue();
    const evil = await verify(
      `token=${token}&callbackURL=${encodeURIComponent('"><script>alert(1)</script>')}`,
    );
    const page = await evil.text();
    expect(page).not.toContain("<script>");
    expect(page).toContain("&quot;&gt;&lt;script&gt;");
  });
});

/**
 * R28 G-02r: the confirm step stops a gateway that only *fetches* the link. One
 * that follows the form and re-submits it would still burn the token, so a
 * confirmed request must also look like a document navigation.
 *
 * The rule is **inverted on purpose**. `Sec-Fetch-User` is unsupported on Safari
 * and every iOS browser (MDN, 2026-09-28), so requiring it would break sign-in
 * for every iPhone. Instead a request is refused only when it *declares* it is
 * not a navigation — absent headers are allowed. The tests below pin both
 * directions: the scripted shapes are refused, and every real-browser shape
 * (including the header-less Safari case) still signs in.
 */
describe("R28 G-02r: a scripted form submit does not burn the link either", () => {
  const makeAuth = async () => {
    const { betterAuth } = await import("better-auth/minimal");
    const { magicLink } = await import("better-auth/plugins");
    const { memoryAdapter } = await import("better-auth/adapters/memory");
    const { confirmMagicLink } = await import("../../../convex/auth");
    const db: Record<string, unknown[]> = {
      user: [],
      session: [],
      account: [],
      verification: [],
    };
    let sent = "";
    const auth = betterAuth({
      baseURL: "https://site.convex.site",
      secret: "t".repeat(40),
      database: memoryAdapter(db),
      hooks: { before: confirmMagicLink },
      plugins: [
        magicLink({
          sendMagicLink: async ({ url }: { url: string }) => {
            sent = url;
          },
        }),
      ],
    });
    const issue = async () => {
      await auth.handler(
        new Request("https://site.convex.site/api/auth/sign-in/magic-link", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "https://site.convex.site",
          },
          body: JSON.stringify({ email: "buyer@example.com" }),
        }),
      );
      return new globalThis.URL(sent).searchParams.get("token") ?? "";
    };
    const confirm = (token: string, headers: Record<string, string> = {}) =>
      auth.handler(
        new Request(
          // `callbackURL` is what makes a successful verify a 302. Without it
          // the endpoint returns the session as JSON with status 200, which is
          // still a sign-in — so the assertions below check the cookie, not the
          // status, wherever a redirect is not the thing under test.
          `https://site.convex.site/api/auth/magic-link/verify?token=${token}&confirm=1&callbackURL=%2Forders`,
          { method: "GET", redirect: "manual", headers },
        ),
      );
    return { issue, confirm };
  };

  /** The rule itself, by value, with no endpoint involved. */
  test("only a declared non-navigation is refused", async () => {
    const { isNotUserNavigation } = await import("../../../convex/auth");
    const h = (headers: Record<string, string>) => new Headers(headers);
    // Declared scripted: refused.
    expect(isNotUserNavigation(h({ "sec-fetch-mode": "cors" }))).toBe(true);
    expect(isNotUserNavigation(h({ "sec-fetch-mode": "no-cors" }))).toBe(true);
    expect(isNotUserNavigation(h({ "sec-fetch-mode": "same-origin" }))).toBe(
      true,
    );
    expect(isNotUserNavigation(h({ "sec-fetch-dest": "empty" }))).toBe(true);
    expect(isNotUserNavigation(h({ "sec-fetch-dest": "image" }))).toBe(true);
    // Declared navigation: allowed.
    expect(isNotUserNavigation(h({ "sec-fetch-mode": "navigate" }))).toBe(
      false,
    );
    expect(
      isNotUserNavigation(
        h({ "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" }),
      ),
    ).toBe(false);
    // Nothing declared: allowed. This is the Safari / iOS / in-app case, and it
    // is why the rule is inverted rather than requiring `Sec-Fetch-User`.
    expect(isNotUserNavigation(h({}))).toBe(false);
    expect(isNotUserNavigation(h({ "user-agent": "Safari" }))).toBe(false);
  });

  test("a cors submit gets the interstitial and leaves the token usable", async () => {
    const { issue, confirm } = await makeAuth();
    const token = await issue();
    const scripted = await confirm(token, { "sec-fetch-mode": "cors" });
    expect(scripted.status).toBe(200);
    expect(scripted.headers.get("content-type")).toContain("text/html");
    // The whole point: no session, and the token was not consumed.
    expect(scripted.headers.getSetCookie()).toHaveLength(0);
    const page = await scripted.text();
    expect(page).toContain('name="confirm" value="1"');
    // A real navigation still works afterwards — the link is not burned.
    const human = await confirm(token, {
      "sec-fetch-mode": "navigate",
      "sec-fetch-dest": "document",
    });
    expect(human.status).toBe(302);
    expect(human.headers.getSetCookie()).toHaveLength(1);
  });

  test("a fetch-dest submit is refused the same way", async () => {
    const { issue, confirm } = await makeAuth();
    const token = await issue();
    const scripted = await confirm(token, { "sec-fetch-dest": "empty" });
    expect(scripted.status).toBe(200);
    expect(scripted.headers.getSetCookie()).toHaveLength(0);
  });

  test("a request with no fetch metadata still signs in (Safari, iOS, webviews)", async () => {
    const { issue, confirm } = await makeAuth();
    const token = await issue();
    // Safari and every iOS browser send neither header. This must not regress.
    const safari = await confirm(token, {});
    expect(safari.status).toBe(302);
    expect(safari.headers.getSetCookie()).toHaveLength(1);
  });

  test("the interstitial is still the first hop for a bare prefetch", async () => {
    const { betterAuth } = await import("better-auth/minimal");
    const { magicLink } = await import("better-auth/plugins");
    const { memoryAdapter } = await import("better-auth/adapters/memory");
    const { confirmMagicLink } = await import("../../../convex/auth");
    const auth = betterAuth({
      baseURL: "https://site.convex.site",
      secret: "t".repeat(40),
      database: memoryAdapter({
        user: [],
        session: [],
        account: [],
        verification: [],
      }),
      hooks: { before: confirmMagicLink },
      plugins: [magicLink({ sendMagicLink: async () => {} })],
    });
    // No `confirm` at all: the R24 behaviour, unchanged by this rule. The page
    // is served before the token is read, so even a bogus token is harmless.
    const prefetch = await auth.handler(
      new Request(
        "https://site.convex.site/api/auth/magic-link/verify?token=bogus",
        { method: "GET", redirect: "manual" },
      ),
    );
    expect(prefetch.status).toBe(200);
    expect(prefetch.headers.get("content-type")).toContain("text/html");
    expect(prefetch.headers.getSetCookie()).toHaveLength(0);
  });
});
