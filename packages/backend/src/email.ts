/**
 * The one transactional email. A single-use link is the whole body, because
 * the invite and the sign-in are the same hop.
 */
import { env } from "./encoding";

export class EmailSendError extends Error {
  constructor(readonly info: EmailError) {
    super(emailFailureText(info));
    this.name = "EmailSendError";
  }
}

export type EmailInput = {
  to: string;
  url: string;
  studio?: string;
  /**
   * Overrides the magic-link body. The operator digest is the second message
   * this deployment sends, and it is not a link: rather than a second transport
   * it reuses this one, so there is still exactly one place that talks to the
   * provider, one failure classifier and one set of error strings.
   */
  subject?: string;
  text?: string;
  /** Overrides the selected provider's key env var (tests only). */
  apiKey?: string;
  from?: string;
  send?: typeof fetch;
};

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

export function emailBody(
  url: string,
  studio?: string,
): { subject: string; text: string; html: string } {
  const safe = escapeHtml(url);
  const from = studio
    ? `${studio} sent you an order on Milo.`
    : "Sign in to Milo.";
  const lead = "Open this single-use link to sign in and read the order:";
  const tail =
    "The link expires shortly. If you did not expect this email, ignore it.";
  return {
    subject: studio
      ? `${studio} sent you an order on Milo`
      : "Your Milo sign-in link",
    text: [from, "", lead, url, "", tail].join("\n"),
    html: [
      '<div style="font-family:system-ui,sans-serif;line-height:1.5">',
      `<p>${escapeHtml(from)}</p>`,
      `<p>${lead}</p>`,
      `<p><a href="${safe}">Open the order</a></p>`,
      `<p>${tail}</p>`,
      "</div>",
    ].join(""),
  };
}

/** The reason a send failed, in the terms the operator needs to act on. */
export type EmailFailure =
  | "testing-sender"
  | "sender-restricted"
  | "domain-unverified"
  | "rate-limited"
  | "rejected"
  | "provider-down"
  | "unreachable";

export type EmailError = {
  readonly failure: EmailFailure;
  readonly status: number;
  /** The provider's own message (or `fix`), already safe to show an operator. */
  readonly detail: string;
};

const FAILURE_TEXT: Record<EmailFailure, string> = {
  "testing-sender":
    "Resend only delivers to the account owner while MAIL_FROM uses resend.dev. Verify a domain at resend.com/domains and set MAIL_FROM to an address on it.",
  "sender-restricted":
    "AgentMail refused this message because the organization is not verified, so it may only mail its own owner. Claim it at console.agentmail.to/claim (or POST /v0/agent/verify), then send again.",
  "domain-unverified":
    "The email provider has not verified the MAIL_FROM domain. Add and verify it, then send again; DNS usually settles within 15 minutes.",
  "rate-limited":
    "The email provider is rate limiting this deployment. Wait a minute and send again.",
  rejected:
    "The email provider refused this message. Check MAIL_FROM and the recipient.",
  "provider-down": "The email provider is unavailable. Try again shortly.",
  unreachable:
    "Milo could not reach the email provider. Check the deployment's network.",
};

/**
 * AgentMail and Brevo both send a stable `code`; Resend sends only `message`.
 * Branching on the code first is what makes `message_rejected` (an unverified
 * org, a send block list, or an unfetchable attachment) distinguishable from
 * `account_suspended`, which the message alone cannot do — AgentMail keeps the
 * legacy message `Forbidden` on both.
 */
const CODE_FAILURE: Record<string, EmailFailure> = {
  message_rejected: "sender-restricted",
  account_suspended: "rejected",
  inbox_suspended: "rejected",
  pod_suspended: "rejected",
  rate_limit_exceeded: "rate-limited",
  domain_not_verified: "domain-unverified",
};

/** Map a provider's body and status onto one actionable reason. */
export function classifyFailure(
  status: number,
  body: { code?: string; name?: string; message?: string; fix?: string },
): EmailError {
  const message = body.message ?? "";
  const failure: EmailFailure =
    CODE_FAILURE[body.code ?? ""] ??
    (/only send testing emails/i.test(message)
      ? "testing-sender"
      : /domain is not verified/i.test(message)
        ? "domain-unverified"
        : status === 429
          ? "rate-limited"
          : status >= 500
            ? "provider-down"
            : "rejected");
  // AgentMail's `fix` names the concrete remedy and is more specific than its
  // `message`, which keeps a legacy generic value.
  return { failure, status, detail: body.fix ?? message };
}

/**
 * The sentence for a failure, with the provider's status in it.
 *
 * This is the *log* sentence: `EmailSendError`'s message carries it, so a
 * refusal stays diagnosable by its status. It is not what a buyer should read —
 * see `inviteFailureReason` for the buyer-facing form.
 */
export const emailFailureText = (error: EmailError): string =>
  `${FAILURE_TEXT[error.failure]} (${error.status})`;

/**
 * What to tell the caller when the primary write succeeded but the email did
 * not. The quote and its invite link are still valid, so this is a partial
 * success, never a failure: a thrown error would make the client retry and
 * create a second quote.
 *
 * G-11: this is rendered verbatim in the buyer's order page ("Not emailed. …
 * Send it to … yourself."), so it must be a sentence. `emailFailureText`
 * appends the provider's HTTP status for the log; the status is an internal
 * detail the buyer cannot act on, and it was the one fragment of that copy that
 * was not prose. The failure kind already selects a sentence naming the fix.
 */
export const inviteFailureReason = (cause: unknown): string =>
  cause instanceof EmailSendError
    ? FAILURE_TEXT[cause.info.failure]
    : "Milo could not send the email.";

/**
 * Where the provider's send endpoint lives. `MAIL_BASE_URL` is the
 * provider-agnostic override; `RESEND_BASE_URL` is the Resend-only original,
 * kept because W2's form-to-handler e2e captures mail through it. The generic
 * name wins when both are set. `env()` trims and treats `""` as absent.
 */
const mailBaseUrl = (provider: string, fallback: string): string =>
  (
    env("MAIL_BASE_URL") ??
    (provider === "resend" ? env("RESEND_BASE_URL") : undefined) ??
    fallback
  ).replace(/\/+$/, "");

type Message = { subject: string; text: string; html: string };

/**
 * One HTTP shape per provider, each with the env var holding its key. Every
 * free provider that can send without an owned domain has a different envelope,
 * so this table is the whole difference between them; `sendEmail` is shared.
 *
 * Verified against the providers' own docs on 2026-10-26:
 * - Resend: `POST /emails`, `Authorization: Bearer`, `{from, to: [..], subject, text, html}`.
 * - AgentMail: `POST /v0/inboxes/{inbox_id}/messages/send`, `Bearer`,
 *   `{to, subject, text, html}`. The inbox id **is** the sending address ("The
 *   inbox ID is the address itself"), and the path segment must be encoded.
 * - Brevo: `POST /v3/smtp/email`, `api-key: <key>` (not Bearer),
 *   `{sender: {email}, to: [{email}], subject, textContent, htmlContent}`.
 */
type Provider = {
  /** The env var holding this provider's key. A name, never a value. */
  keyEnv: string;
  url: (from: string) => string;
  headers: (key: string) => Record<string, string>;
  body: (from: string, to: string, message: Message) => unknown;
};

const JSON_HEADERS = { "content-type": "application/json" };
const bearer = (key: string) => ({
  authorization: `Bearer ${key}`,
  ...JSON_HEADERS,
});

export const PROVIDERS: Record<string, Provider> = {
  resend: {
    keyEnv: "RESEND_API_KEY",
    url: () => `${mailBaseUrl("resend", "https://api.resend.com")}/emails`,
    headers: bearer,
    body: (from, to, m) => ({ from, to: [to], ...m }),
  },
  agentmail: {
    keyEnv: "AGENTMAIL_API_KEY",
    // The inbox id is the sending address, and the `@` must be encoded.
    url: (from) =>
      `${mailBaseUrl("agentmail", "https://api.agentmail.to")}/v0/inboxes/${encodeURIComponent(from)}/messages/send`,
    headers: bearer,
    body: (_from, to, m) => ({ to, ...m }),
  },
  brevo: {
    keyEnv: "BREVO_API_KEY",
    url: () => `${mailBaseUrl("brevo", "https://api.brevo.com")}/v3/smtp/email`,
    headers: (key) => ({ "api-key": key, ...JSON_HEADERS }),
    body: (from, to, m) => ({
      sender: { email: from },
      to: [{ email: to }],
      subject: m.subject,
      textContent: m.text,
      htmlContent: m.html,
    }),
  },
};

/**
 * The selected provider. Defaults to `resend`, so a deployment that never sets
 * `MAIL_PROVIDER` behaves exactly as it did before this table existed.
 */
export const mailProvider = (): string => {
  const configured = env("MAIL_PROVIDER")?.toLowerCase();
  return configured && configured in PROVIDERS ? configured : "resend";
};

/**
 * Which provider this deployment would use and whether its key is present, for
 * a diagnostics read: names and a boolean, never a value.
 */
export const mailConfig = (): {
  provider: string;
  keyEnv: string;
  keyPresent: boolean;
  from: string | null;
} => {
  const provider = mailProvider();
  const keyEnv = PROVIDERS[provider].keyEnv;
  return {
    provider,
    keyEnv,
    keyPresent: Boolean(env(keyEnv)),
    from: env("MAIL_FROM") ?? null,
  };
};

export async function sendEmail(input: EmailInput): Promise<void> {
  const providerName = mailProvider();
  const provider = PROVIDERS[providerName];
  const apiKey = input.apiKey ?? env(provider.keyEnv);
  const from = input.from ?? env("MAIL_FROM");
  // Fail closed naming the variable the *selected* provider needs, so an
  // operator who switched to AgentMail is not told to set RESEND_API_KEY.
  if (!apiKey || !from)
    throw new Error(
      `Email is not configured for ${providerName}. Set ${provider.keyEnv} and MAIL_FROM on the Convex deployment.`,
    );
  const body = emailBody(input.url, input.studio);
  const text = input.text ?? body.text;
  const message = {
    subject: input.subject ?? body.subject,
    text,
    // A plain-text override still needs an html part: some clients show only
    // html, and an empty one would render as a blank email.
    html: input.text ? `<pre>${escapeHtml(text)}</pre>` : body.html,
  };
  const response = await (input.send ?? fetch)(provider.url(from), {
    method: "POST",
    headers: provider.headers(apiKey),
    body: JSON.stringify(provider.body(from, input.to, message)),
  });
  if (!response.ok) {
    // Every provider returns a JSON error body; the message (and AgentMail's
    // `fix`) says which cause applies, so read it instead of discarding it.
    let failure: {
      code?: string;
      name?: string;
      message?: string;
      fix?: string;
    } = {};
    try {
      failure = (await response.json()) as typeof failure;
    } catch {
      // A non-JSON body still carries the status, which is enough to classify.
    }
    throw new EmailSendError(classifyFailure(response.status, failure));
  }
}
