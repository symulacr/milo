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
   * it reuses this one, so there is still exactly one place that talks to
   * Resend, one failure classifier and one set of error strings.
   */
  subject?: string;
  text?: string;
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
  | "domain-unverified"
  | "rate-limited"
  | "rejected"
  | "provider-down"
  | "unreachable";

export type EmailError = {
  readonly failure: EmailFailure;
  readonly status: number;
  /** Resend's own message, already safe to show an operator. */
  readonly detail: string;
};

const FAILURE_TEXT: Record<EmailFailure, string> = {
  "testing-sender":
    "Resend only delivers to the account owner while MAIL_FROM uses resend.dev. Verify a domain at resend.com/domains and set MAIL_FROM to an address on it.",
  "domain-unverified":
    "Resend has not verified the MAIL_FROM domain. Add and verify it at resend.com/domains; DNS usually settles within 15 minutes.",
  "rate-limited":
    "Resend is rate limiting this deployment. Wait a minute and send again.",
  rejected: "Resend refused this message. Check MAIL_FROM and the recipient.",
  "provider-down": "Resend is unavailable. Try again shortly.",
  unreachable: "Milo could not reach Resend. Check the deployment's network.",
};

/** Map Resend's body and status onto one actionable reason. */
export function classifyFailure(
  status: number,
  body: { name?: string; message?: string },
): EmailError {
  const message = body.message ?? "";
  const failure: EmailFailure = /only send testing emails/i.test(message)
    ? "testing-sender"
    : /domain is not verified/i.test(message)
      ? "domain-unverified"
      : status === 429
        ? "rate-limited"
        : status >= 500
          ? "provider-down"
          : "rejected";
  return { failure, status, detail: message };
}

/** The sentence an operator or client should see for a failure. */
export const emailFailureText = (error: EmailError): string =>
  `${FAILURE_TEXT[error.failure]} (${error.status})`;

/**
 * What to tell the caller when the primary write succeeded but the email did
 * not. The quote and its invite link are still valid, so this is a partial
 * success, never a failure: a thrown error would make the client retry and
 * create a second quote.
 */
export const inviteFailureReason = (cause: unknown): string =>
  cause instanceof EmailSendError
    ? emailFailureText(cause.info)
    : "Milo could not send the email.";

/**
 * Where Resend's send endpoint lives. Overridable so a local capture server can
 * receive the magic link: point `RESEND_BASE_URL` at a Mailpit-style
 * `/api/v1/send` and the whole sign-in flow becomes readable in a test without
 * a Resend account, a verified domain, or a real send. `env()` already trims
 * and treats `""` as absent, so an empty value falls back to the real API.
 */
export const resendBaseUrl = (): string =>
  (env("RESEND_BASE_URL") ?? "https://api.resend.com").replace(/\/+$/, "");

export async function sendEmail(input: EmailInput): Promise<void> {
  const apiKey = input.apiKey ?? process.env.RESEND_API_KEY;
  const from = input.from ?? process.env.MAIL_FROM;
  if (!apiKey || !from) {
    throw new Error(
      "Email is not configured. Set RESEND_API_KEY and MAIL_FROM on the Convex deployment.",
    );
  }
  const body = emailBody(input.url, input.studio);
  const subject = input.subject ?? body.subject;
  const text = input.text ?? body.text;
  const response = await (input.send ?? fetch)(`${resendBaseUrl()}/emails`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [input.to],
      subject,
      text,
      // A plain-text override still needs an html part: some clients show only
      // html, and an empty one would render as a blank email.
      html: input.text ? `<pre>${escapeHtml(text)}</pre>` : body.html,
    }),
  });
  if (!response.ok) {
    // Resend sends {name, message, statusCode}; the message says which of the
    // several 403 causes applies, so read it instead of discarding it.
    let body: { name?: string; message?: string } = {};
    try {
      body = (await response.json()) as typeof body;
    } catch {
      // A non-JSON body still carries the status, which is enough to classify.
    }
    const error = classifyFailure(response.status, body);
    throw new EmailSendError(error);
  }
}
