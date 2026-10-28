import { useConvex, useQuery } from "convex/react";
import { Check, Clock } from "lucide";
import { MorphIcon } from "morphicons/react";
import { useEffect, useRef, useState, useTransition } from "react";
import { Link, useLocation, useParams, useSearchParams } from "react-router";
import {
  ACCEPTED_IMAGE_TYPES,
  MAX_BYTES,
} from "../../../../packages/backend/src/delivery-policy";
import { DIFFERENT_ACCOUNT } from "../../../../packages/midnight-client/src";
import { api, type Me, type OrderDetail } from "../api";
import { PageTitle } from "../components/PageTitle";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardTitle, type Fact, Facts } from "../components/ui/card";
import { Textarea } from "../components/ui/input";
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
  openOrder,
  PLAN,
  type Report,
  readDisputeNote,
  reviewDelivery,
  runAction,
  warmChain,
} from "../workspace/flows";
import {
  clearInvite,
  keyFor,
  readDraft,
  stashedInvite,
  stashInvite,
  writeDraft,
} from "../workspace/keys";
import {
  actionsFor,
  deadlineOf,
  type OrderAction,
  PAYMENT_LABEL,
  STAGE_LABEL,
  TRACK,
  trackIndex,
  turnOf,
  useNow,
} from "../workspace/stages";
import {
  connectWallet,
  differentAccount,
  preferredWallet,
  useWallet,
  walletConnector,
} from "../workspace/wallet";
import { WorkspaceNotFound } from "./WorkspaceNotFound";

const MUTED = "text-sm text-muted-foreground";
const STACK = "grid gap-2";
const FIT = "w-fit";
const MONO = "font-mono text-xs break-all"; // taste-skill-ignore digests are literal hex
const ALERT = "text-sm text-destructive";
const TEST_CARD =
  "Stripe test mode: Milo uses a test card. No real money moves.";

/** Connect the remembered wallet, or the first one found. */
const connectPreferred = () => {
  const choice = preferredWallet();
  if (choice) void connectWallet(choice);
};

/** The server's own delivery rules, so a file it would reject is refused here. */
const acceptable = (file: File) =>
  ACCEPTED_IMAGE_TYPES.includes(file.type) && file.size <= MAX_BYTES;

const useConnected = () =>
  useWallet().status === "connected"
    ? walletConnector().connectedApi()
    : undefined;

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
    <Invite quoteId={quoteId} token={token} me={me} />
  ) : (
    <WorkspaceNotFound />
  );
}

function Invite(props: { quoteId: string; token: string; me: Me }) {
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
  const isConnected = Boolean(connected);
  useEffect(() => {
    if (isConnected) void warmChain();
  }, [isConnected]);
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
          {config?.paymentsMode === "test" ? ` ${TEST_CARD}` : ""}
        </Note>
        <Button
          className={FIT}
          disabled={wallet.status === "connecting"}
          pending={busy}
          onClick={() => {
            if (!connected) return connectPreferred();
            if (!claiming.start()) return;
            setError("");
            startBusy(() =>
              openOrder(
                convex,
                { connected },
                me.subject,
                quoteId,
                token,
                preview,
                () => {},
              )
                // The token is spent once the claim succeeds, so the tab stops
                // carrying a credential it can never use again.
                .then(() => clearInvite(quoteId))
                .catch((cause) => setError(errorText(cause)))
                // Released on both paths, or a failed claim locks the button.
                .finally(claiming.end),
            );
          }}
        >
          <MorphIcon icon={Check} reducedMotion="user" />
          {connected ? "Open the order" : "Connect a wallet"}
        </Button>
        {error && <Alert>{error}</Alert>}
      </Card>
    </>
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
  // A disputed order is off the happy-path track, so it claims no position.
  const at = order.stage === "DISPUTED" ? undefined : trackIndex(order.stage);
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
    if (!connected) return connectPreferred();
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
      <div
        role="progressbar"
        aria-label="Order progress"
        aria-valuemin={0}
        aria-valuemax={at === undefined ? undefined : TRACK.length - 1}
        aria-valuenow={at}
        aria-valuetext={STAGE_LABEL[order.stage]}
        className="h-1.5 overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn(
            "h-full",
            order.stage === "DISPUTED" ? "bg-pink" : "bg-brand",
          )}
          style={{
            width: `${(Math.max(at ?? 0, 0) / (TRACK.length - 1)) * 100}%`,
          }}
        />
      </div>
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
                  variant={action.weight === "primary" ? "default" : "outline"}
                  disabled={blocked(action)}
                  pending={busy}
                  onClick={() => run(action)}
                >
                  <Mark icon={action.icon} />
                  {action.label}
                </Button>
              ))}
            </div>
          )}
          <Note>
            {turn.body}
            {order.stage === "APPROVED" || order.stage === "CANCELLED"
              ? ` Payment: ${PAYMENT_LABEL[order.payment.state]}.`
              : ""}
          </Note>
          {deadline && (
            <p className={cn(MUTED, "flex items-center gap-2")}>
              <MorphIcon icon={Clock} reducedMotion="user" />
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
            </p>
          )}
          {actions.length > 0 && !ready && (
            <div className="flex flex-wrap items-center gap-3">
              {connected ? (
                <Button asChild variant="outline">
                  <Link to="/account">Restore your key backup</Link>
                </Button>
              ) : (
                <Button onClick={connectPreferred}>Connect a wallet</Button>
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
          {ready && order.inviteUrl && (
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
                  to. The digest on chain is still the client&apos;s, so decide
                  on the delivery itself.
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
            <details className="grid gap-2">
              <summary className="w-fit cursor-pointer text-sm font-semibold">
                Add a note
              </summary>
              {/* R37: the server says whether a dispute would actually be
                  resolvable. Shown BEFORE the note is written and the
                  transaction signed, because that is the only moment the user
                  can still decide not to. The action stays available — the
                  circuit is on the chain and the buyer is entitled to it. */}
              {order.disputes && (
                <p role="alert" className="mt-2 text-sm text-warning">
                  {order.disputes}
                </p>
              )}
              <Textarea
                className="mt-2"
                aria-label="Reason"
                // R38: this said "The other party reads this", which is false.
                // The note is hashed in the browser (`flows.ts` evidenceOf) and
                // only the digest is signed, so no screen can show the text —
                // not the studio's, not the operator's, not even this one after
                // the draft is cleared. The note's real job is to be the thing
                // the buyer hashed, which is what makes the digest repeatable.
                placeholder="Give at least 10 characters. Only its SHA-256 digest is recorded, so keep your own copy — no one can read the text back."
                minLength={10}
                value={note}
                onChange={(event) => {
                  setNote(event.target.value);
                  // G-09: keep it as it is typed, so an expiring session costs
                  // the user nothing.
                  writeDraft(order.quoteId, event.target.value);
                }}
              />
            </details>
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
