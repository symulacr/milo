import { useConvex, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams, useSearchParams } from "react-router";
import {
  ACCEPTED_IMAGE_TYPES,
  MAX_BYTES,
} from "../../../../packages/backend/src/delivery-policy";
import { DIFFERENT_ACCOUNT } from "../../../../packages/midnight-client/src";
import { api, type Me, type OrderDetail } from "../api";
import { ClockIcon } from "../components/icons";
import { PageTitle } from "../components/PageTitle";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardTitle, type Fact, Facts } from "../components/ui/card";
import { Textarea } from "../components/ui/input";
import { OrderProgress } from "../components/ui/order-progress";
import { SealSheet } from "../components/ui/seal-sheet";
import { Loading, Mark } from "../components/ui/status";
import {
  Alert,
  CopyButton,
  errorText,
  Note,
  StepList,
  type Steps,
  Verdict,
} from "../components/workspace";
import { badgeTone, relativeTo, shortDate, usd } from "../lib/format";
import { cn, useGuard } from "../lib/utils";
import { useMe, usePublicConfig } from "../workspace/backend";
import {
  type DeliveryReview,
  PLAN,
  type Report,
  readDisputeNote,
  reviewDelivery,
  runAction,
  warmChain,
} from "../workspace/flows";
import {
  keyFor,
  readDraft,
  stashedInvite,
  stashInvite,
  writeDraft,
} from "../workspace/keys";
import {
  connectPreferred,
  TEST_CARD,
  useConnected,
  WALLET_MISSING,
} from "../workspace/order-wallet";
import {
  actionsFor,
  deadlineOf,
  type OrderAction,
  PAYMENT_LABEL,
  STAGE_LABEL,
  turnOf,
  useNow,
} from "../workspace/stages";
import { differentAccount, useWallet } from "../workspace/wallet";
import { OrderInvite } from "./OrderInvite";
import { WorkspaceNotFound } from "./WorkspaceNotFound";

const MUTED = "text-sm text-muted-foreground";
const STACK = "grid gap-2";
const FIT = "w-fit";
const MONO = "font-mono text-xs break-all"; // taste-skill-ignore digests are literal hex
const ALERT = "text-sm text-destructive";

/** The server's own delivery rules, so a file it would reject is refused here. */
const acceptable = (file: File) =>
  ACCEPTED_IMAGE_TYPES.includes(file.type) && file.size <= MAX_BYTES;

export function OrderView() {
  const { quoteId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  // D-01: the invite token is a bearer credential. Capture it once, then drop it
  // from the address bar so it stays out of history, copied links and Referer.
  //
  // G-17: the token is also stashed for the tab, because the shell replaces this
  // route with the sign-in form when there is no session — and the form's
  // callback is a pathname, which cannot carry a query string. Without the stash
  // a buyer whose sign-in link was burned or expired could never reopen the
  // order: the new link would land on `/orders/<id>` with no token.
  const [token] = useState(() => {
    const fromUrl = params.get("invite");
    if (fromUrl) stashInvite(quoteId, fromUrl);
    return fromUrl ?? stashedInvite(quoteId);
  });
  useEffect(() => {
    if (params.has("invite")) setParams({}, { replace: true });
  }, [params, setParams]);
  const order = useQuery(api.order, { quoteId });
  const { me } = useMe();
  if (order === undefined || !me) return <Loading label="Loading the order…" />;
  if (order) return <Order order={order} me={me} />;
  return token ? (
    <OrderInvite quoteId={quoteId} token={token} me={me} />
  ) : (
    <WorkspaceNotFound />
  );
}

function Order({ order, me }: { order: OrderDetail; me: Me }) {
  const { state } = useLocation();
  const emailFailed =
    typeof state === "object" && state && "emailFailed" in state
      ? String(state.emailFailed)
      : "";
  const convex = useConvex();
  const connected = useConnected();
  const config = usePublicConfig();
  const [key] = useState(() => keyFor(me.subject, order.quoteId));
  const [steps, setSteps] = useState<Steps>({});
  const [plan, setPlan] = useState<readonly (readonly [string, string])[]>([]);
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState("");
  // R40: the operator's copy of the dispute reason. Loaded only for an operator
  // on a disputed order, so a buyer never triggers the read.
  const [disputeNote, setDisputeNote] =
    useState<Awaited<ReturnType<typeof readDisputeNote>>>(null);
  /** Synchronous double-click guard: `busy` is a render behind (lib/utils). */
  const inFlight = useGuard();
  const [error, setError] = useState("");
  const [seal, setSeal] = useState<OrderAction | null>(null);
  // G-09: a session that expires mid-flow re-renders this page signed out and
  // then back in, which threw away the note the user had typed. The note is a
  // string, so keeping it costs one storage entry and no new machinery. The
  // picked files are `File` objects — not serializable — so they are NOT
  // persisted; the page says so instead, because silently losing three chosen
  // images is worse than being told before you pick them.
  const [note, setNote] = useState(() => readDraft(order.quoteId));
  const [picked, setPicked] = useState<File[]>([]);
  const [pending, setPending] = useState<{ from: number; at: number } | null>(
    null,
  );
  const [review, setReview] = useState<DeliveryReview>({
    files: [],
    manifest: null,
  });
  // G-04: the deadline decisions use the server's clock, so a skewed device is
  // offered the action the server would accept. `orders.order` now carries
  // `serverNow`, so this is a real field rather than the cast the client half
  // used while the schema change was pending.
  const now = useNow(30_000, order.serverNow);
  const latest = useRef(order);
  latest.current = order;
  const report: Report = (id, state, detail) =>
    setSteps((current) => ({ ...current, [id]: { state, detail } }));
  const manifest = order.delivery.manifest;
  const deadline = deadlineOf(order.stage, order.deadlines);
  const actions = actionsFor(order.stage, order.role, order.deadlines, now);
  const turn = turnOf(
    order.stage,
    order.role,
    order.inviteClaimed,
    actions.some((action) => action.expiry),
  );
  const revision = order.contract?.revision ?? -1;
  const waiting = pending !== null && revision <= pending.from;
  const timedOut = waiting && now - (pending?.at ?? now) > 90_000;
  const matches = review.manifest !== null && review.manifest === manifest;
  // A different account than the one this session signed in with must not act:
  // the order key it would sign with belongs to the original account, so the
  // server would record a signature that account never made. `ready` is the one
  // gate the whole page uses, so this blocks every action at once — no action
  // runs, no key is saved, no server call is made.
  const wallet = useWallet();
  const wrongAccount =
    wallet.status === "connected" &&
    differentAccount(wallet.account.unshieldedAddress, me.walletAddress);
  const ready =
    Boolean(connected) &&
    !wrongAccount &&
    (actions.every((action) => action.circuit === "resolve") || Boolean(key));

  const warm = Boolean(connected) && actions.length > 0;
  useEffect(() => {
    if (warm) void warmChain();
  }, [warm]);

  useEffect(() => {
    if (!manifest) return;
    let live = true;
    let urls: string[] = [];
    reviewDelivery(convex, latest.current).then(
      (result) => {
        urls = result.files.map((file) => file.url);
        if (live) setReview(result);
        else for (const url of urls) URL.revokeObjectURL(url);
      },
      () => {},
    );
    return () => {
      live = false;
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [convex, manifest]);

  // R-14 v1: the action answers `{refreshed, since}` itself, so this no longer
  // infers "was I throttled?" from a null revision and then reads
  // `order.contract.observedAt` — a value only as fresh as the last query
  // subscription, and possibly older than the cooldown it describes.
  // R40: fetch and verify the sealed reason once, when an operator opens a
  // disputed order. `review.files` is not a dependency: the note does not change.
  useEffect(() => {
    if (order.stage !== "DISPUTED" || order.role !== "operator") return;
    let live = true;
    readDisputeNote(convex, order).then(
      (result) => {
        if (live) setDisputeNote(result);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [convex, order]);

  const check = () => {
    setBusy(true);
    void convex
      .action(api.refreshOrder, { quoteId: order.quoteId })
      .then((result) => {
        if (result.refreshed) return setChecked("Checked just now.");
        setChecked(
          result.since
            ? `The network was read ${relativeTo(result.since, now)}. Try again in a moment.`
            : "The network has not been read yet. Try again in a moment.",
        );
      })
      .catch((cause) => setError(errorText(cause)))
      .finally(() => setBusy(false));
  };

  const run = (action: OrderAction) => {
    if (!connected) {
      if (!connectPreferred()) setError(WALLET_MISSING);
      return;
    }
    // `busy` only disables the button after a re-render, so two clicks in the
    // same frame both reach here and start two chain actions at one revision.
    // `useGuard` is synchronous, so the second click is refused.
    if (!inFlight.start()) return;
    const from = order.contract?.revision ?? 0;
    // `busy` is set synchronously here, so the button paints its pending state
    // in the same frame as the click instead of one render later.
    setBusy(true);
    setError("");
    setSteps({});
    setPlan(PLAN[action.circuit] ?? []);
    void runAction({
      convex,
      wallet: { connected },
      subject: me.subject,
      detail: order,
      key,
      action,
      note,
      files: picked,
      report,
      expectedAddress: me.walletAddress ?? undefined,
    }).then(
      () => {
        inFlight.end();
        setBusy(false);
        setChecked("");
        setPending({ from, at: Date.now() });
        // The note is spent once the action that used it succeeded, so the draft
        // does not outlive the reason it was written for.
        setNote("");
        writeDraft(order.quoteId, "");
      },
      (cause) => {
        inFlight.end();
        setBusy(false);
        setError(errorText(cause));
      },
    );
  };

  const needs = (kind: OrderAction["needs"]) =>
    actions.some((a) => a.needs === kind);
  const blocked = (action: OrderAction) =>
    (action.needs === "note" && note.trim().length < 10) ||
    (action.needs === "files" && picked.length !== 3) ||
    (action.needs === "delivery" && !matches);
  const shown: readonly {
    index: number;
    sha256: string;
    url?: string;
    match?: boolean;
  }[] = review.files.length ? review.files : order.delivery.files;
  const contract = order.contract;
  const facts = (
    [
      ["Client", order.clientEmail],
      ["Payment", PAYMENT_LABEL[order.payment.state]],
      ["Revision", contract && String(contract.revision)],
      ["Checked", contract && shortDate(contract.observedAt)],
    ] as Fact[]
  ).filter(([, value]) => value != null && value !== "");
  return (
    <>
      <PageTitle
        title={order.title}
        actions={
          <p className="text-2xl font-extrabold tracking-tight tabular-nums sm:text-[32px]">
            {usd(order.amountUsd)}
          </p>
        }
      >
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
          <span>{order.studioName}</span>
          <Badge variant={badgeTone(order.stage)}>
            {STAGE_LABEL[order.stage]}
          </Badge>
        </p>
      </PageTitle>
      <OrderProgress stage={order.stage} payment={order.payment.state} />
      <div className="grid min-w-0 gap-6">
        <Card>
          <CardTitle className={cn(turn.mine && "text-brand")}>
            {turn.title}
          </CardTitle>
          {ready && actions.length > 0 && (
            <div
              className={cn(
                STACK,
                "sticky bottom-0 z-20 -mx-5 bg-muted px-5 py-3 sm:static sm:mx-0 sm:bg-transparent sm:p-0",
              )}
            >
              {actions.map((action) => (
                <Button
                  key={action.label}
                  className={FIT}
                  variant={
                    action.weight === "primary"
                      ? "default"
                      : action.weight === "danger"
                        ? "danger"
                        : "outline"
                  }
                  disabled={blocked(action)}
                  pending={busy}
                  onClick={() => setSeal(action)}
                >
                  <Mark icon={action.icon} />
                  {action.label}
                </Button>
              ))}
            </div>
          )}
          <SealSheet
            open={seal !== null}
            title={seal?.label ?? ""}
            body={
              <>
                <p>{turn.body}</p>
                <p>
                  Signs with Lace on Midnight Preprod. This step cannot be
                  undone.
                </p>
              </>
            }
            confirmLabel={seal?.label ?? "Confirm"}
            danger={seal?.weight === "danger"}
            pending={busy}
            onCancel={() => setSeal(null)}
            onConfirm={() => {
              if (!seal) return;
              const next = seal;
              setSeal(null);
              run(next);
            }}
          />
          <Note>{turn.body}</Note>
          {deadline && (
            <div className={cn(MUTED, "flex items-center gap-2")}>
              <Mark icon={ClockIcon} size={14} className="shrink-0" />
              {deadline.label} {shortDate(deadline.at)} ·{" "}
              <span
                // Z-05: the countdown changes every 30 s, and a screen reader
                // user was told the deadline once and then nothing. `aria-live`
                // announces the change; `polite` because it is not urgent and
                // must not interrupt the action buttons. The absolute time is
                // already in the sentence, so the live region only needs the
                // relative part — that is what actually changes.
                aria-live="polite"
                aria-atomic="true"
                className={cn(
                  "tabular-nums",
                  deadline.at <= now && "font-semibold text-destructive",
                )}
              >
                {relativeTo(deadline.at, now)}
              </span>
            </div>
          )}
          {actions.length > 0 && !ready && (
            <div className="flex flex-wrap items-center gap-3">
              {connected ? (
                <Button asChild variant="outline">
                  <Link to="/account">Restore your key backup</Link>
                </Button>
              ) : (
                <Button
                  onClick={() => {
                    if (!connectPreferred()) setError(WALLET_MISSING);
                  }}
                >
                  Connect a wallet
                </Button>
              )}
              <Note>
                {wrongAccount
                  ? DIFFERENT_ACCOUNT
                  : connected
                    ? // U-02: the key lives in one browser's storage, so this is
                      // what a buyer sees when they open the mail link in their
                      // mail app's webview instead of the browser they claimed
                      // in. "Restore your backup" was the only advice, and a
                      // buyer who never made one had nowhere to go. Name the
                      // cause and the two ways out.
                      "This browser does not hold the key for this order. If you opened the email link in a mail app, open it in the browser you started the order in. Otherwise restore your backup, or the order expires."
                    : "Preprod only. The wallet pays the fees."}
              </Note>
            </div>
          )}
          {/* Invite is share-only: do not gate on Lace `ready` or the merchant
              cannot copy the link while waiting for the client. */}
          {order.inviteUrl && (
            <div className={STACK}>
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-3 py-2 font-mono text-xs">
                  {order.inviteUrl}
                </code>
                <CopyButton value={order.inviteUrl} label="Copy the link" />
              </div>
              {order.clientEmail && (
                <Note>
                  {emailFailed
                    ? `Not emailed. ${emailFailed} Send it to ${order.clientEmail} yourself.`
                    : `Emailed to ${order.clientEmail}.`}
                </Note>
              )}
            </div>
          )}
          {ready && needs("files") && (
            <div className={STACK}>
              <label className="inline-flex h-9 w-fit cursor-pointer items-center rounded-md border border-input bg-card px-4 text-sm font-semibold hover:bg-muted focus-within:ring-[3px] focus-within:ring-ring/40">
                Choose three images
                <input
                  type="file"
                  multiple
                  accept="image/*"
                  className="sr-only"
                  onChange={(event) =>
                    setPicked(
                      [...(event.target.files ?? [])].filter(acceptable),
                    )
                  }
                />
              </label>
              <Note>
                {picked.length === 3
                  ? picked.map((file) => file.name).join(" · ")
                  : `Pick three files. ${picked.length} selected.`}
              </Note>
            </div>
          )}
          {disputeNote && (
            <div className="grid gap-2 rounded-md bg-muted p-3">
              <CardTitle className="text-sm">
                The client&apos;s reason
              </CardTitle>
              {disputeNote.unreadable ? (
                // R41: the row exists but this key cannot open it. Rendering an
                // empty reason would read as "the client said nothing", which is
                // a different and misleading fact.
                <Note>
                  The client did give a reason, but this browser cannot open it:
                  the key for this order no longer matches the one it was sealed
                  to, and it cannot be recovered. The digest on chain is still
                  the client&apos;s, so decide on the delivery itself.
                </Note>
              ) : (
                <>
                  <p className="text-sm leading-relaxed whitespace-pre-line">
                    {disputeNote.note}
                  </p>
                  <Note>
                    {disputeNote.digestMatches && disputeNote.chainMatches
                      ? "This text hashes to the digest the chain holds, so it is the reason that was signed."
                      : "This text does not match the digest on chain. Do not decide on it; ask the client to re-file."}
                  </Note>
                </>
              )}
            </div>
          )}
          {needs("note") && (
            <div className="grid gap-2">
              <label
                htmlFor={`dispute-note-${order.quoteId}`}
                className="text-sm font-semibold"
              >
                Reason for the dispute
              </label>
              {/* R37: the server says whether a dispute would actually be
                  resolvable. Shown BEFORE the note is written and the
                  transaction signed, because that is the only moment the user
                  can still decide not to. The action stays available — the
                  circuit is on the chain and the buyer is entitled to it. */}
              {order.disputes && (
                <p role="alert" className="text-sm text-warning">
                  {order.disputes}
                </p>
              )}
              <Textarea
                id={`dispute-note-${order.quoteId}`}
                aria-label="Reason"
                // R38: sealed to the operator in the browser; InfoPage and the
                // operator card both say the operator can read it. The digest
                // still lands on chain so the sealed text can be checked.
                placeholder="Give at least 10 characters. The operator can read this reason; the studio and Milo's servers cannot."
                minLength={10}
                value={note}
                onChange={(event) => {
                  setNote(event.target.value);
                  // G-09: keep it as it is typed, so an expiring session costs
                  // the user nothing.
                  writeDraft(order.quoteId, event.target.value);
                }}
              />
            </div>
          )}
          {needs("files") && picked.length < 3 && (
            <Note>
              Your chosen images are not kept if you sign in again. Pick them
              just before you send.
            </Note>
          )}
          {order.stage === "QUOTE" && config?.paymentsMode === "test" && (
            <Note>{TEST_CARD}</Note>
          )}
          {plan.length > 0 && <StepList plan={plan} steps={steps} />}
          {pending && (
            <p
              role="status"
              className={cn(
                "flex items-center gap-2",
                timedOut ? ALERT : MUTED,
              )}
            >
              <Mark
                status={waiting ? (timedOut ? "failed" : "working") : "done"}
              />
              {waiting
                ? timedOut
                  ? "Not on the network yet. Check again in a minute."
                  : "Waiting for the network…"
                : "The network shows it."}
              {!waiting && order.stage === "APPROVED" && (
                <span
                  aria-hidden="true"
                  className="size-1.5 shrink-0 rounded-full bg-positive"
                  title="Approved"
                />
              )}
            </p>
          )}
          {!pending && order.stage === "APPROVED" && (
            <p className={cn(MUTED, "flex items-center gap-2")}>
              <span
                aria-hidden="true"
                className="size-1.5 shrink-0 rounded-full bg-positive"
              />
              Approved
            </p>
          )}
          {error && <Alert>{error}</Alert>}
        </Card>
        {manifest && (
          <Card>
            <CardTitle>Delivery</CardTitle>
            <Verdict
              state={review.manifest === null ? 0 : matches ? 1 : 2}
              text={[
                "Checking the files",
                "Matches the contract",
                "Does not match the contract",
              ]}
            />
            <ul
              aria-label="Delivered files"
              className="grid gap-4 sm:grid-cols-3"
            >
              {shown.map((file) => (
                <li key={file.index} className="grid content-start gap-2">
                  {file.url ? (
                    <img
                      src={file.url}
                      alt={`Delivered file ${file.index + 1}`}
                      className="aspect-[4/5] w-full rounded-md bg-muted object-cover"
                    />
                  ) : (
                    <Note>Not fetched yet</Note>
                  )}
                  <span className="text-sm font-semibold">
                    File {file.index + 1}
                  </span>
                  <code className={cn(MONO, "text-muted-foreground")}>
                    {file.sha256.slice(0, 16)}…
                  </code>
                  <Verdict
                    state={file.match === undefined ? 0 : file.match ? 1 : 2}
                    text={["Checking", "Matches its digest", "Does not match"]}
                  />
                </li>
              ))}
            </ul>
          </Card>
        )}
        <Card>
          <CardTitle>The agreement</CardTitle>
          <p className="max-w-[68ch] text-sm leading-relaxed whitespace-pre-line">
            {order.brief}
          </p>
          <Facts rows={facts} />
          {contract && (
            <div className={STACK}>
              <code className={MONO}>{contract.address}</code>
              <div className="flex flex-wrap items-center gap-2">
                <CopyButton value={contract.address} label="Copy the address" />
                <Button
                  variant="ghost"
                  size="sm"
                  className={FIT}
                  disabled={busy}
                  onClick={check}
                >
                  {busy ? "Checking the network…" : "Check the network"}
                </Button>
              </div>
              {checked && <Note>{checked}</Note>}
            </div>
          )}
          {order.role !== "operator" && (
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={key ? "positive" : "warning"}>
                {key ? "Order key in this browser" : "No order key here"}
              </Badge>
              <Button asChild variant="outline" size="sm" className={FIT}>
                <Link to="/account">
                  {key ? "Download a backup" : "Restore a backup"}
                </Link>
              </Button>
            </div>
          )}
          {key && order.role !== "operator" && (
            // U-13: the key lives in ONE browser's storage, and the backup is
            // already the honest cross-device carrier — PBKDF2 + AES-GCM, made
            // on the device and never sent to the server. The gap was that
            // nothing told a buyer to make one at the moment they got a key, so
            // the first time they learned it mattered was when the mail app
            // opened the order in a webview that had none (U-02). One sentence,
            // next to the badge, at the only moment it is cheap to act on.
            <Note>
              This key lives only in this browser. Download a backup if you
              might open the order on another device.
            </Note>
          )}
        </Card>
      </div>
    </>
  );
}
