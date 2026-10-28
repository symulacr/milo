/**
 * R41: the Resend-switch dry run.
 *
 * The owner's flip is: unset MAIL_PROVIDER (or set it to "resend") while
 * MAIL_FROM still names the AgentMail address. These tests run that exact
 * scenario against the real `sendEmail`, with a stubbed `fetch`, and record
 * what the deployment would do at each step.
 *
 * Nothing here touches the network or the deployment: `send` is injected.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  classifyFailure,
  emailFailureText,
  mailConfig,
  mailProvider,
  PROVIDERS,
  sendEmail,
} from "../src/email";

/** The address the deployment actually has today (domain only; never a secret). */
const AGENTMAIL_FROM = "mi.lo@agentmail.to";

const PROVIDER_KEYS = [
  "MAIL_PROVIDER",
  "MAIL_FROM",
  "RESEND_API_KEY",
  "AGENTMAIL_API_KEY",
  "BREVO_API_KEY",
  "MAIL_BASE_URL",
  "RESEND_BASE_URL",
] as const;

type Key = (typeof PROVIDER_KEYS)[number];

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of PROVIDER_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of PROVIDER_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

/** Capture the single request `sendEmail` would make. */
const capture = async (vars: Partial<Record<Key, string>>) => {
  Object.assign(process.env, vars);
  const calls: { url: string; init: RequestInit }[] = [];
  const send = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ id: "re_probe" }), { status: 200 });
  }) as unknown as typeof fetch;
  await sendEmail({ to: "buyer@example.com", url: "https://milo.app/x", send });
  return calls[0] as { url: string; init: RequestInit };
};

describe("R41 (1) provider selection when MAIL_PROVIDER is unset", () => {
  test("an unset MAIL_PROVIDER selects resend", () => {
    expect(mailProvider()).toBe("resend");
  });

  test("an empty MAIL_PROVIDER selects resend, not nothing", () => {
    // `env()` treats "" as absent; a half-done flip must not disable email.
    process.env.MAIL_PROVIDER = "";
    expect(mailProvider()).toBe("resend");
  });

  test("a whitespace-only MAIL_PROVIDER selects resend", () => {
    process.env.MAIL_PROVIDER = "   ";
    expect(mailProvider()).toBe("resend");
  });

  test("MAIL_PROVIDER is case-insensitive", () => {
    process.env.MAIL_PROVIDER = "ReSeNd";
    expect(mailProvider()).toBe("resend");
  });

  test("the unset path resolves the resend key env var, not agentmail's", () => {
    const config = mailConfig();
    expect(config.provider).toBe("resend");
    expect(config.keyEnv).toBe("RESEND_API_KEY");
  });

  test("the request goes to api.resend.com/emails with a Bearer header", async () => {
    const call = await capture({
      MAIL_FROM: "Milo <sign-in@milo.example>",
      RESEND_API_KEY: "re_probe_key",
    });
    expect(call.url).toBe("https://api.resend.com/emails");
    const headers = call.init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer re_probe_key");
    expect(headers["content-type"]).toBe("application/json");
  });

  test("the body uses resend's envelope: from string, to array", async () => {
    const call = await capture({
      MAIL_FROM: "Milo <sign-in@milo.example>",
      RESEND_API_KEY: "re_probe_key",
    });
    const body = JSON.parse(String(call.init.body)) as Record<string, unknown>;
    expect(body.from).toBe("Milo <sign-in@milo.example>");
    expect(body.to).toEqual(["buyer@example.com"]);
    expect(typeof body.subject).toBe("string");
    expect(typeof body.text).toBe("string");
    expect(typeof body.html).toBe("string");
    // Resend takes no per-message api-key field; the key is the header only.
    expect(body).not.toHaveProperty("api_key");
    expect(body).not.toHaveProperty("apiKey");
  });
});

describe("R41 (3) a missing RESEND_API_KEY fails closed, loudly", () => {
  test("no key means no request is made at all", async () => {
    process.env.MAIL_FROM = AGENTMAIL_FROM;
    let called = false;
    const send = (async () => {
      called = true;
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;
    await expect(
      sendEmail({ to: "buyer@example.com", url: "https://milo.app/x", send }),
    ).rejects.toThrow(/RESEND_API_KEY/);
    expect(called).toBe(false);
  });

  test("the message names RESEND_API_KEY and MAIL_FROM, and the provider", async () => {
    // The operator must be told which variable to set. Naming AgentMail's key
    // here would send them to the wrong dashboard.
    await expect(
      sendEmail({
        to: "buyer@example.com",
        url: "https://milo.app/x",
        send: (async () => new Response(null, { status: 200 })) as never,
      }),
    ).rejects.toThrow(
      /Email is not configured for resend\. Set RESEND_API_KEY and MAIL_FROM/,
    );
  });

  test("a missing MAIL_FROM also fails closed, before any request", async () => {
    process.env.RESEND_API_KEY = "re_probe_key";
    let called = false;
    const send = (async () => {
      called = true;
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;
    await expect(
      sendEmail({ to: "buyer@example.com", url: "https://milo.app/x", send }),
    ).rejects.toThrow(/MAIL_FROM/);
    expect(called).toBe(false);
  });

  test("an empty RESEND_API_KEY is treated as absent, not as a key", async () => {
    process.env.MAIL_FROM = AGENTMAIL_FROM;
    process.env.RESEND_API_KEY = "";
    let called = false;
    const send = (async () => {
      called = true;
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;
    await expect(
      sendEmail({ to: "buyer@example.com", url: "https://milo.app/x", send }),
    ).rejects.toThrow(/RESEND_API_KEY/);
    expect(called).toBe(false);
  });
});

describe("R41 (1) the current MAIL_FROM under resend", () => {
  /**
   * The deployment has MAIL_FROM=mi.lo@agentmail.to. Resend has no such
   * verified domain, so the send is refused. These are Resend's own documented
   * bodies (resend.com/docs/api-reference/errors, 2026-10-15): both are
   * `validation_error` with status 403, and only the MESSAGE distinguishes them.
   */
  const RESEND_REFUSALS = [
    {
      label: "the from domain is not verified",
      status: 403,
      body: {
        statusCode: 403,
        name: "validation_error",
        message:
          "The agentmail.to domain is not verified. Please, add and verify your domain.",
      },
      expectFailure: "domain-unverified",
      expectText: /has not verified/i,
    },
    {
      label: "a resend.dev sender writes to a third party",
      status: 403,
      body: {
        statusCode: 403,
        name: "validation_error",
        message:
          "You can only send testing emails to your own email address (owner@studio.example). To send emails to other recipients, please verify a domain at resend.com/domains, and change the from address to an email using this domain.",
      },
      expectFailure: "testing-sender",
      expectText: /verify a domain/i,
    },
  ] as const;

  for (const row of RESEND_REFUSALS) {
    test(`resend refuses ${row.label} with a classified, actionable error`, async () => {
      process.env.MAIL_FROM = AGENTMAIL_FROM;
      process.env.RESEND_API_KEY = "re_probe_key";
      const send = (async () =>
        Response.json(row.body, {
          status: row.status,
        })) as unknown as typeof fetch;
      const attempt = sendEmail({
        to: "buyer@example.com",
        url: "https://milo.app/x",
        send,
      });
      await expect(attempt).rejects.toThrow(row.expectText);
      // The status is in the log sentence, so a refusal stays diagnosable.
      await expect(attempt).rejects.toThrow(/403/);
      // And never the key.
      await expect(attempt).rejects.not.toThrow(/re_probe_key/);
    });

    test(`classifyFailure maps ${row.label} to ${row.expectFailure}`, () => {
      expect(classifyFailure(row.status, row.body).failure).toBe(
        row.expectFailure,
      );
    });
  }

  test("the buyer-facing sentence names the fix, not the provider status", () => {
    // The order page renders this verbatim, so it must be prose.
    const text = emailFailureText({
      failure: "domain-unverified",
      status: 403,
      detail: "",
    });
    expect(text).toMatch(/has not verified the MAIL_FROM domain/i);
    expect(text).toMatch(/within 15 minutes/i);
  });
});

describe("R41 (2) the resend.dev interim sender", () => {
  test("onboarding@resend.dev is accepted by the code but only reaches the owner", async () => {
    // Nothing in Milo rejects resend.dev; the restriction is Resend's, and it
    // arrives as a 403 at send time. That is why it cannot be an interim for
    // real buyers: the first invite to anyone else fails.
    const call = await capture({
      MAIL_FROM: "onboarding@resend.dev",
      RESEND_API_KEY: "re_probe_key",
    });
    const body = JSON.parse(String(call.init.body)) as Record<string, unknown>;
    expect(body.from).toBe("onboarding@resend.dev");

    const send = (async () =>
      Response.json(
        {
          statusCode: 403,
          name: "validation_error",
          message:
            "You can only send testing emails to your own email address (owner@studio.example). To send emails to other recipients, please verify a domain at resend.com/domains, and change the from address to an email using this domain.",
        },
        { status: 403 },
      )) as unknown as typeof fetch;
    await expect(
      sendEmail({
        to: "buyer@example.com",
        url: "https://milo.app/x",
        send,
      }),
    ).rejects.toThrow(/verify a domain/i);
  });
});

describe("R41 (1) a bad API key must not be blamed on MAIL_FROM", () => {
  /**
   * The flip's most likely mistake is a wrong, revoked or not-yet-created key.
   * Resend answers 401 for all of those (resend.com/docs/api-reference/errors,
   * 2026-10-15): `validation_error` "API key is invalid", `missing_api_key`
   * "Missing API Key", `restricted_api_key`. Before this fix the classifier fell
   * through to `rejected`, whose sentence is "Check MAIL_FROM and the
   * recipient" — the wrong remedy, and the one thing that is already correct.
   */
  const KEY_REFUSALS = [
    {
      label: "a revoked or wrong key",
      status: 401,
      body: { name: "validation_error", message: "API key is invalid" },
    },
    {
      label: "no key on the wire",
      status: 401,
      body: { name: "missing_api_key", message: "Missing API Key" },
    },
    {
      label: "a restricted key",
      status: 401,
      body: {
        name: "restricted_api_key",
        message: "This API key is restricted to only send emails.",
      },
    },
  ] as const;

  for (const row of KEY_REFUSALS) {
    test(`${row.label} is classified as a key problem, not a sender problem`, () => {
      expect(classifyFailure(row.status, row.body).failure).toBe("key-invalid");
    });
  }

  test("the sentence names the key variables, not MAIL_FROM", () => {
    const text = emailFailureText({
      failure: "key-invalid",
      status: 401,
      detail: "",
    });
    expect(text).toMatch(/RESEND_API_KEY/);
    // MAIL_FROM is the thing that is already right; blaming it misdirects.
    expect(text).not.toMatch(/Check MAIL_FROM/);
  });

  test("a 401 through sendEmail is a key error and never leaks the key", async () => {
    process.env.MAIL_FROM = AGENTMAIL_FROM;
    process.env.RESEND_API_KEY = "re_wrong_key_value";
    const send = (async () =>
      Response.json(
        { name: "validation_error", message: "API key is invalid" },
        { status: 401 },
      )) as unknown as typeof fetch;
    const attempt = sendEmail({
      to: "buyer@example.com",
      url: "https://milo.app/x",
      send,
    });
    await expect(attempt).rejects.toThrow(/RESEND_API_KEY/);
    await expect(attempt).rejects.not.toThrow(/re_wrong_key_value/);
  });
});

describe("R41 the provider table is still the single source", () => {
  test("every provider names its own key env var", () => {
    expect(PROVIDERS.resend.keyEnv).toBe("RESEND_API_KEY");
    expect(PROVIDERS.agentmail.keyEnv).toBe("AGENTMAIL_API_KEY");
    expect(PROVIDERS.brevo.keyEnv).toBe("BREVO_API_KEY");
  });

  test("only resend uses a Bearer header; brevo uses api-key", () => {
    const resend = PROVIDERS.resend.headers("k");
    const brevo = PROVIDERS.brevo.headers("k");
    expect(resend.authorization).toBe("Bearer k");
    expect(brevo["api-key"]).toBe("k");
    expect(brevo.authorization).toBeUndefined();
  });
});
