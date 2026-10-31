import { useConvex, useQuery } from "convex/react";
import { useEffect, useState, useTransition } from "react";
import type { Me } from "../api";
import { api } from "../api";
import { CheckIcon } from "../components/icons";
import { PageTitle } from "../components/PageTitle";
import { Button } from "../components/ui/button";
import { Card, CardTitle } from "../components/ui/card";
import { SealSheet } from "../components/ui/seal-sheet";
import { Loading, Mark } from "../components/ui/status";
import { Alert, errorText, Note } from "../components/workspace";
import { usd } from "../lib/format";
import { useGuard } from "../lib/utils";
import { usePublicConfig } from "../workspace/backend";
import { openOrder, warmChain } from "../workspace/flows";
import { clearInvite } from "../workspace/keys";
import {
  connectPreferred,
  TEST_CARD,
  useConnected,
  WALLET_MISSING,
} from "../workspace/order-wallet";
import { useWallet } from "../workspace/wallet";

const FIT = "w-fit";

export function OrderInvite(props: { quoteId: string; token: string; me: Me }) {
  const { quoteId, token, me } = props;
  const convex = useConvex();
  const wallet = useWallet();
  const connected = useConnected();
  const config = usePublicConfig();
  const preview = useQuery(api.invite, { quoteId, token });
  const [busy, startBusy] = useTransition();
  // M-01: `startTransition` runs the callback synchronously and marks the update
  // non-urgent, so `busy` is not set before a second click in the same frame.
  // Both clicks then reach `openOrder` → `acceptInvite`, and the FIRST claim
  // rotates the invite token, so the second is refused with "This order link
  // does not work." — an error shown for an order that was just claimed
  // successfully. `useGuard` is the shared synchronous ref (lib/utils).
  const claiming = useGuard();
  const [error, setError] = useState("");
  const [seal, setSeal] = useState(false);
  const isConnected = Boolean(connected);
  useEffect(() => {
    if (isConnected) void warmChain();
  }, [isConnected]);
  const authorize = () => {
    if (!connected) {
      if (!connectPreferred()) setError(WALLET_MISSING);
      return;
    }
    if (!claiming.start()) return;
    setSeal(false);
    setError("");
    startBusy(() =>
      openOrder(
        convex,
        { connected },
        me.subject,
        quoteId,
        token,
        preview!,
        () => {},
      )
        .then(() => clearInvite(quoteId))
        .catch((cause) => setError(errorText(cause)))
        .finally(claiming.end),
    );
  };
  if (preview === undefined) return <Loading label="Loading the invitation…" />;
  if (!preview || preview.claimed) {
    // G-07: a null preview has two very different causes, and the old copy named
    // only one of them. The token was accepted (we got this far), so the refusal
    // is either "another account already claimed it" or "you are signed in as
    // someone else". `me.email` is already here — the shell only renders this
    // page for a signed-in user — so naming the account costs no request and no
    // new state. Saying "this link does not work" sent the buyer to the studio
    // for a new link that would have failed the same way.
    const [title, body] = preview
      ? [
          "Order already accepted",
          "Another account opened this order. Sign in as that account, or ask for a new link.",
        ]
      : [
          "Sign in as the invited account",
          `This link is for another address. You are signed in as ${me.email ?? "a different account"}. Sign out and open the link again with the address the studio emailed.`,
        ];
    return (
      <PageTitle title={title}>
        <p className="max-w-[52ch] text-muted-foreground">{body}</p>
      </PageTitle>
    );
  }
  return (
    <>
      <PageTitle title={preview.title}>
        <p className="text-muted-foreground">
          {preview.studioName} · {usd(preview.amountUsd)}, fixed
        </p>
      </PageTitle>
      <Card>
        <CardTitle>The brief</CardTitle>
        <p className="text-sm leading-relaxed whitespace-pre-line">
          {preview.brief}
        </p>
        <Note>
          {usd(preview.amountUsd)} is authorized now and captured on approval.
          Opening publishes the contract and reserves the terms. Lace must sign.
          {config?.paymentsMode === "test" ? ` ${TEST_CARD}` : ""}
        </Note>
        <Button
          className={FIT}
          disabled={wallet.status === "connecting"}
          pending={busy}
          onClick={() => {
            if (!connected) {
              if (!connectPreferred()) setError(WALLET_MISSING);
              return;
            }
            setSeal(true);
          }}
        >
          <Mark icon={CheckIcon} />
          Authorize and reserve
        </Button>
        {error && <Alert>{error}</Alert>}
      </Card>
      <SealSheet
        open={seal}
        title="Authorize and reserve"
        body={
          <>
            <p>
              {usd(preview.amountUsd)} is authorized now and captured on
              approval. Opening publishes the contract and reserves the terms on
              Midnight Preprod.
            </p>
            <p>Lace must sign. This step cannot be undone.</p>
          </>
        }
        confirmLabel="Authorize and reserve"
        pending={busy}
        onCancel={() => setSeal(false)}
        onConfirm={authorize}
      />
    </>
  );
}
