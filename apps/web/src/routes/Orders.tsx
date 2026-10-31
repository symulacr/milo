import { useQuery_experimental as useQuery } from "convex/react";
import { Link } from "react-router";
import { api, type OrderSummary } from "../api";
import { CircleDashedIcon, PlusIcon } from "../components/icons";
import { PageTitle } from "../components/PageTitle";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Loading, Mark } from "../components/ui/status";
import { errorText } from "../components/workspace";
import { badgeTone, usd, useAgo } from "../lib/format";
import { CHUNK_LOAD } from "../shells/WorkspaceShell";
import { StaleBuild, useMe } from "../workspace/backend";
import { STAGE_LABEL, yourTurn } from "../workspace/stages";

const ROW =
  "grid grid-cols-[minmax(0,1fr)] items-center gap-x-6 gap-y-1.5 px-5 py-3.5 transition-colors hover:bg-muted/60 md:grid-cols-[minmax(0,1fr)_130px_90px_90px] md:gap-y-1";

function OrderRow({ order }: { order: OrderSummary }) {
  const ago = useAgo(order.updatedAt);
  const turn = yourTurn(order.role, order.stage);
  return (
    <Link
      to={`/orders/${order.quoteId}`}
      className={ROW}
      aria-label={turn ? `${order.title}, your turn` : order.title}
    >
      <span className="grid min-w-0">
        <span className="flex min-w-0 items-center gap-2 font-semibold">
          {turn && (
            <>
              <Mark
                icon={CircleDashedIcon}
                size={14}
                className="shrink-0 text-brand"
              />
              <span className="sr-only">Your turn. </span>
            </>
          )}
          <span className="truncate">{order.title}</span>
        </span>
      </span>
      <span className="flex items-center justify-between gap-3 md:block">
        <Badge variant={badgeTone(order.stage)}>
          {STAGE_LABEL[order.stage]}
        </Badge>
        <span className="font-semibold tabular-nums md:hidden">
          {usd(order.amountUsd)}
        </span>
      </span>
      <span className="hidden text-right font-semibold tabular-nums md:block">
        {usd(order.amountUsd)}
      </span>
      <span className="text-right text-[13px] text-muted-foreground md:block">
        {ago}
      </span>
    </Link>
  );
}

export function Orders() {
  const { me } = useMe();
  // G-12: the positional `useQuery` throws on an error result before this
  // component can branch, so the reload notice below was dead code and one
  // failed query replaced the whole workspace through `ServiceBoundary`. The
  // object form is the same hook with `throwOnError: false` by default: it
  // returns `{status:"error", error}` instead of throwing, which is what makes
  // the branch reachable. It is the installed client's own API — no new
  // dependency, no wrapper.
  const state = useQuery({ query: api.orders, args: {} });
  if (state.status === "error") {
    // R38: this used to say "Milo may have been updated" for EVERY error, so a
    // dropped connection or an expired session was reported as a stale tab and
    // the only offered remedy was a reload that could not help. The boundary
    // (`ServiceBoundary`) already separates the two cases; this is the same
    // distinction at the query level, where the error is a value not a throw.
    const message = errorText(state.error);
    if (CHUNK_LOAD.test(message))
      return (
        <StaleBuild
          title="Milo was updated"
          body="This tab is older than the current version. Reload to get it."
        />
      );
    return (
      <div className="grid gap-2 rounded-lg bg-card p-8">
        <h2 className="text-lg font-semibold">Orders did not load</h2>
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
        <Button
          variant="outline"
          className="w-fit"
          onClick={() => location.reload()}
        >
          Try again
        </Button>
      </div>
    );
  }
  const orders = state.status === "success" ? state.data : undefined;
  return (
    <>
      <PageTitle
        title="Orders"
        actions={
          <Button asChild>
            <Link to="/orders/new">
              <Mark icon={PlusIcon} />
              New quote
            </Link>
          </Button>
        }
      ></PageTitle>
      <section aria-label="Your orders" className="min-w-0">
        {orders === undefined ? (
          <Loading label="Loading orders" />
        ) : orders.length === 0 ? (
          <div className="grid gap-4 rounded-lg bg-card p-8 sm:grid-cols-[minmax(0,11rem)_1fr] sm:items-center">
            <img
              className="aspect-[4/5] w-full max-w-[11rem] object-cover"
              src="/images/studio-bench.webp"
              alt=""
              width={352}
              height={440}
              loading="lazy"
              decoding="async"
            />
            <div className="grid gap-2">
              <h2 className="text-lg font-semibold">No orders yet</h2>
              <p className="text-sm text-muted-foreground">
                {me?.studio
                  ? "Start with a quote."
                  : "Open the link a studio emailed you."}
              </p>
            </div>
          </div>
        ) : (
          <ul className="grid overflow-hidden rounded-lg bg-card">
            {orders.map((order) => (
              <li key={order.quoteId}>
                <OrderRow order={order} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
