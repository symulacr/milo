import { useConvex, useQuery } from "convex/react";
import { Check, Clock } from "lucide";
import { MorphIcon } from "morphicons/react";
import { useEffect, useRef, useState, useTransition } from "react";
import { Link, useLocation, useParams, useSearchParams } from "react-router";
import {
  ACCEPTED_IMAGE_TYPES,
  MAX_BYTES,
} from "../../../../packages/backend/src/delivery-policy";
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
import { cn } from "../lib/utils";
import { useMe, usePublicConfig } from "../workspace/backend";
import {
  type DeliveryReview,
  openOrder,
  PLAN,
  type Report,
  reviewDelivery,
  runAction,
  warmChain,
} from "../workspace/flows";
import { keyFor } from "../workspace/keys";
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
  const [token] = useState(() => params.get("invite"));
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
  const [error, setError] = useState("");
  const isConnected = Boolean(connected);
  useEffect(() => {
    if (isConnected) void warmChain();
  }, [isConnected]);
  if (preview === undefined) return <Loading label="Loading the invitation…" />;
  if (!preview || preview.claimed) {
    const [title, body] = preview
      ? [
          "Order already accepted",
          "Another account opened this order. Sign in as that account, or ask for a new link.",
        ]
      : [
          "Invitation not valid",
          "This link does not work. Ask the studio for a new one.",
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
              ).catch((cause) => setError(errorText(cause))),
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
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [picked, setPicked] = useState<File[]>([]);
  const [pending, setPending] = useState<{ from: number; at: number } | null>(
    null,
  );
  const [review, setReview] = useState<DeliveryReview>({
    files: [],
    manifest: null,
  });
  const now = useNow();
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
  const ready =
    Boolean(connected) &&
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

  const check = () => {
    setBusy(true);
    void convex
      .action(api.refreshOrder, { quoteId: order.quoteId })
      .catch((cause) => setError(errorText(cause)))
      .finally(() => setBusy(false));
  };

  const run = (action: OrderAction) => {
    if (!connected) return connectPreferred();
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
    }).then(
      () => {
        setBusy(false);
        setPending({ from, at: Date.now() });
      },
      (cause) => {
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
                {connected
                  ? "No key in this browser. Restore your backup, or the order expires."
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
          {needs("note") && (
            <details className="grid gap-2">
              <summary className="w-fit cursor-pointer text-sm font-semibold">
                Add a note
              </summary>
              <Textarea
                className="mt-2"
                aria-label="Reason"
                placeholder="Give at least 10 characters. The other party reads this."
                minLength={10}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </details>
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
        </Card>
      </div>
    </>
  );
}
