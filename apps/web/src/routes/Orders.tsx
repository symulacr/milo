import { useQuery } from "convex/react";
import { CircleDot, Plus } from "lucide";
import { Link } from "react-router";
import { api, type OrderSummary } from "../api";
import { PageTitle } from "../components/PageTitle";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Loading, Mark } from "../components/ui/status";
import { badgeTone, usd, useAgo } from "../lib/format";
import { StaleBuild, useMe } from "../workspace/backend";
import { STAGE_LABEL, yourTurn } from "../workspace/stages";

const ROW =
  "grid grid-cols-[minmax(0,1fr)] items-center gap-x-6 gap-y-1.5 px-5 py-3.5 transition-colors hover:bg-muted/60 md:grid-cols-[minmax(0,1fr)_130px_90px_90px] md:gap-y-1";

function OrderRow({ order }: { order: OrderSummary }) {
  const ago = useAgo(order.updatedAt);
  const turn = yourTurn(order.role, order.stage);
  return (
    <Link to={`/orders/${order.quoteId}`} className={ROW}>
      <span className="grid min-w-0">
        <span className="flex min-w-0 items-center gap-2 font-semibold">
          {turn && (
            <Mark icon={CircleDot} className="size-3.5 shrink-0 text-brand" />
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
  const orders = useQuery(api.orders, {});
  // A failed query resolves to `{error, status:"error"}`, not `undefined`, so
  // the `orders === undefined` branch fell through to `orders.map` and threw.
  // A tab open across a deploy saw the generic boundary instead of being told
  // to reload.
  if (orders !== undefined && "status" in orders && orders.status === "error")
    return (
      <StaleBuild
        title="Orders did not load"
        body="Milo may have been updated while this tab was open. Reload to get the current version."
      />
    );
  return (
    <>
      <PageTitle
        title="Orders"
        actions={
          <Button asChild>
            <Link to="/orders/new">
              <Mark icon={Plus} />
              New quote
            </Link>
          </Button>
        }
      ></PageTitle>
      <section aria-label="Your orders" className="min-w-0">
        {orders === undefined ? (
          <Loading label="Loading orders" />
        ) : orders.length === 0 ? (
          <div className="grid gap-2 rounded-lg bg-card p-8">
            <h2 className="text-lg font-semibold">No orders yet</h2>
            <p className="text-sm text-muted-foreground">
              {me?.studio
                ? "Start with a quote."
                : "Open the link a studio emailed you."}
            </p>
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
