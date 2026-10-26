import { describe, expect, test } from "bun:test";
import {
  classifyFailure,
  EmailSendError,
  emailBody,
  emailFailureText,
  inviteFailureReason,
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

describe("email delivery", () => {
  test("posts to Resend with the configured sender and the link", async () => {
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
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.resend.com/emails");
    expect(calls[0]?.init.method).toBe("POST");
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer re_test_key");
    expect(headers["content-type"]).toBe("application/json");
    const body = JSON.parse(String(calls[0]?.init.body)) as Record<
      string,
      unknown
    >;
    expect(body.from).toBe("Milo <sign-in@milo.example>");
    expect(body.to).toEqual(["buyer@example.com"]);
    expect(String(body.text)).toContain(URL);
    expect(String(body.html)).toContain(URL);
  });

  test("refuses to send when the API key or sender is missing", async () => {
    let called = false;
    const send = (async () => {
      called = true;
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;
    await expect(
      sendEmail({ to: "a@b.c", url: URL, apiKey: "", from: "x", send }),
    ).rejects.toThrow(/RESEND_API_KEY/);
    await expect(
      sendEmail({ to: "a@b.c", url: URL, apiKey: "k", from: "", send }),
    ).rejects.toThrow(/MAIL_FROM/);
    expect(called).toBe(false);
  });

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

  /** A sender that always refuses with Resend's own body shape. */
  const refusing = (status: number, message: string) =>
    (async () =>
      Response.json(
        { name: "validation_error", message, statusCode: status },
        { status },
      )) as unknown as typeof fetch;

  // Resend's real bodies, from resend.com/docs/api-reference/errors. The
  // message is what distinguishes the several 403 causes, so it must be read.
  const REFUSALS: readonly (readonly [string, number, string, RegExp])[] = [
    [
      "testing sender wrote to a third party",
      403,
      "You can only send testing emails to your own email address (owner@studio.example). To send emails to other recipients, please verify a domain at resend.com/domains, and change the from address to an email using this domain.",
      /verify a domain/i,
    ],
    [
      "from domain not verified",
      403,
      "The milo.example domain is not verified. Please, add and verify your domain.",
      /has not verified/i,
    ],
    [
      "required field missing",
      422,
      "The request body is missing one or more required fields.",
      /refused this message/i,
    ],
    [
      "rate limit hit",
      429,
      "Too many requests. Please limit the number of requests per second.",
      /rate limiting/i,
    ],
    ["Resend down", 503, "API is temporarily unavailable", /unavailable/i],
  ];

  for (const [label, status, message, hint] of REFUSALS)
    test(`a ${status} refusal for ${label} is classified`, async () => {
      const failure = sendEmail({
        to: "a@b.c",
        url: URL,
        apiKey: "re_secret_value",
        from: "Milo <sign-in@milo.example>",
        send: refusing(status, message),
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
      ["domain-unverified", /has not verified/i],
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
});

/**
 * ROUND 18 item 5 — the transport seam.
 *
 * `sendEmail` already accepted an injected `send`, but the URL was hardcoded, so
 * nothing could redirect a real send. `RESEND_BASE_URL` is the whole seam: point
 * it at a Mailpit-style `/api/v1/send` and the magic link becomes readable in a
 * test without a Resend account, a verified domain, or a real send.
 */
describe("ROUND18 item 5: RESEND_BASE_URL redirects the send", () => {
  const withBase = async (
    value: string | undefined,
    run: () => Promise<void>,
  ) => {
    const previous = process.env.RESEND_BASE_URL;
    if (value === undefined) delete process.env.RESEND_BASE_URL;
    else process.env.RESEND_BASE_URL = value;
    try {
      await run();
    } finally {
      if (previous === undefined) delete process.env.RESEND_BASE_URL;
      else process.env.RESEND_BASE_URL = previous;
    }
  };

  const capture = async () => {
    const urls: string[] = [];
    const send = (async (url: string) => {
      urls.push(url);
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;
    await sendEmail({
      to: "buyer@example.com",
      url: URL,
      apiKey: "re_test_key",
      from: "Milo <sign-in@milo.example>",
      send,
    });
    return urls[0];
  };

  test("defaults to the real Resend API", async () => {
    await withBase(undefined, async () => {
      expect(await capture()).toBe("https://api.resend.com/emails");
    });
  });

  test("an empty value falls back rather than posting to /emails", async () => {
    // `env()` treats "" as absent, so a half-set var cannot produce a relative
    // URL that fails at runtime with a confusing error.
    await withBase("", async () => {
      expect(await capture()).toBe("https://api.resend.com/emails");
    });
  });

  test("a local capture server receives the send", async () => {
    await withBase("http://127.0.0.1:8025/api/v1", async () => {
      expect(await capture()).toBe("http://127.0.0.1:8025/api/v1/emails");
    });
  });

  test("a trailing slash does not double up", async () => {
    await withBase("http://mailpit:8025/api/v1/", async () => {
      // A `//emails` path is a 404 on most servers, and a hand-typed env value
      // very often ends in a slash, so the seam trims it.
      expect(await capture()).toBe("http://mailpit:8025/api/v1/emails");
    });
  });
});
