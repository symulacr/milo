import { Mail } from "lucide";
import { useState } from "react";
import { useLocation, useSearchParams } from "react-router";
import { ORDER_WINDOWS_MS } from "../../../../packages/backend/src/order-windows";
import { sendMagicLink } from "../auth-client";
import { PageTitle } from "../components/PageTitle";
import { Button } from "../components/ui/button";
import { ConnectWallet } from "../components/ui/connect";
import { Field, Input } from "../components/ui/input";
import { Mark } from "../components/ui/status";
import { CODE_TEXT, errorText, Outcome } from "../components/workspace";
import { stashInvite } from "../workspace/keys";

/** Verify reports failure as `?error=CODE`. Only INVALID_TOKEN means the link is
 * dead; every other code is a server-side failure, so it must not be blamed. */
const LINK_ERROR =
  "This sign-in link was already used, or it expired. Email scanners sometimes open links before you do, which uses them up. Request a new one below.";
const LINK_FAILED = "The sign-in link did not complete. Request a new one.";

/**
 * Said on the "check your email" line. The link is single-use, and it now lives
 * as long as the order's acceptance window (`convex/auth.ts` derives it from
 * `ORDER_WINDOWS_MS.acceptance`), so the sentence is derived from that same
 * constant — a literal here would drift the moment the window changes, which is
 * exactly how the 15-minute/1-hour mismatch happened.
 */
const LINK_WINDOW = `The link works once and expires in ${Math.round(
  ORDER_WINDOWS_MS.acceptance / 60_000,
)} minutes.`;

export function SignIn({ expired = false }: { expired?: boolean }) {
  const [params] = useSearchParams();
  const here = useLocation().pathname;
  const invite = params.get("invite");
  const invited = Boolean(invite);
  // G-17: the shell renders this form *instead of* the order route when there is
  // no session, so this is the only place that sees the token in the URL. Keep
  // it before the callback is sent, because the callback is a pathname and a
  // pathname cannot carry a query string. `useParams` is not available here (the
  // shell mounts this outside the `:quoteId` route), so the id is the path's
  // last segment.
  const quoteId = here.split("/").filter(Boolean).at(-1) ?? "";
  useState(() => {
    if (invite) stashInvite(quoteId, invite);
  });
  // A failed verify lands here with ?error=... because the token is consumed on
  // the first attempt (better-auth.com/docs/plugins/magic-link). That includes a
  // mail scanner that prefetched the link before the user clicked it, so the
  // message must not blame the user and must offer a resend. It is read once
  // into state: reading the URL every render would keep telling the user the
  // link is dead after they have already asked for a new one.
  const failed = params.get("error");
  const [linkError, setLinkError] = useState(() =>
    failed ? (failed === "INVALID_TOKEN" ? LINK_ERROR : LINK_FAILED) : "",
  );
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState("");
  const [error, setError] = useState(
    linkError || (expired ? CODE_TEXT.UNAUTHENTICATED : ""),
  );
  const [busy, setBusy] = useState(false);
  // The email format is the one failure that belongs to this field rather than
  // to the request; everything else stays in the Outcome alert below.
  const fieldError = error && /email/i.test(error) ? error : "";
  return (
    <div className="grid items-start gap-6 lg:min-h-[calc(100svh-11rem)] lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)] lg:items-stretch lg:gap-10">
      <div className="grid max-w-xl content-center gap-6">
        <PageTitle
          title={
            linkError
              ? "Request a new link"
              : invited
                ? "Open your order"
                : "Sign in to Milo"
          }
        >
          <p className="max-w-[52ch] text-muted-foreground">
            {linkError
              ? `Enter your email for a new one. ${LINK_WINDOW}`
              : invited
                ? "A studio sent you an order. Sign in to open it."
                : "Use your email or a Midnight wallet."}
          </p>
        </PageTitle>
        <form
          className="grid gap-4 rounded-lg bg-card p-5"
          onSubmit={(event) => {
            event.preventDefault();
            setBusy(true);
            setLinkError("");
            setError("");
            // D-01: never put the invite token in callbackURL. It would be
            // embedded in the emailed verify link and logged by the provider.
            //
            // G-17: the token still has to survive the hop, or the buyer can
            // never reopen the order. It is stashed for the tab and restored by
            // OrderView after the session exists, so the emailed link stays
            // token-free while the order stays reachable.
            void sendMagicLink(email, here)
              .then((result) =>
                result.sent
                  ? setSent(`${result.message} ${LINK_WINDOW}`)
                  : setError(result.message),
              )
              .catch((cause) => setError(errorText(cause)))
              .finally(() => setBusy(false));
          }}
        >
          <Field label="Email" id="signin-email" error={fieldError}>
            <Input
              id="signin-email"
              type="email"
              required
              autoComplete="email"
              enterKeyHint="send"
              inputMode="email"
              aria-invalid={fieldError ? true : undefined}
              aria-describedby={fieldError ? "signin-email-error" : undefined}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" pending={busy}>
              <Mark icon={Mail} />
              Email me a sign-in link
            </Button>
            <ConnectWallet signIn />
          </div>
          <Outcome status={sent} error={error} />
        </form>
        <p className="max-w-[52ch] text-sm text-muted-foreground">
          Midnight Preprod. Stripe test mode. Your wallet pays the fees in
          tDUST.
        </p>
      </div>
      <figure className="hidden overflow-hidden rounded-lg lg:block lg:min-h-[34rem]">
        <img
          src="/images/agree.webp"
          alt="Two people agree on a printed brief at an oak table"
          width="960"
          height="1200"
          loading="lazy"
          decoding="async"
          className="size-full object-cover"
        />
      </figure>
    </div>
  );
}
