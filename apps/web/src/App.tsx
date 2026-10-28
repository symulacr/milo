import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useParams } from "react-router";
import { Loading } from "./components/ui/status";
import { Account } from "./routes/Account";
import { NewQuote } from "./routes/NewQuote";
import { Orders } from "./routes/Orders";
import { StageGallery } from "./routes/StageGallery";
import { WorkspaceNotFound } from "./routes/WorkspaceNotFound";
import { ServiceBoundary, WorkspaceShell } from "./shells/WorkspaceShell";
import { Backend } from "./workspace/backend";

const OrderView = lazy(() =>
  import("./routes/OrderView").then(({ OrderView }) => ({
    default: OrderView,
  })),
);

const localHost =
  typeof location !== "undefined" &&
  /^(localhost|127\.0\.0\.1)$/.test(location.hostname);

/** Preserve `:id` when rewriting legacy order URLs into `/orders/:quoteId`. */
function LegacyOrder({ from }: { from: "id" | "quoteId" }) {
  const params = useParams();
  const id = from === "id" ? params.id : params.quoteId;
  return <Navigate to={id ? `/orders/${id}` : "/orders"} replace />;
}

export function App() {
  return (
    <Backend>
      <ServiceBoundary>
        <Suspense fallback={<Loading label="Loading the order…" />}>
          <Routes>
            {localHost && (
              <Route path="/design/stages" element={<StageGallery />} />
            )}
            <Route path="/demo" element={<Navigate to="/orders" replace />} />
            <Route path="/sign-in" element={<Navigate to="/account" replace />} />
            <Route path="/signin" element={<Navigate to="/account" replace />} />
            <Route
              path="/connections"
              element={<Navigate to="/account" replace />}
            />
            <Route
              path="/merchant/orders"
              element={<Navigate to="/orders" replace />}
            />
            <Route
              path="/merchant/quotes/new"
              element={<Navigate to="/orders/new" replace />}
            />
            <Route
              path="/operator/cases"
              element={<Navigate to="/orders" replace />}
            />
            <Route
              path="/operator/cases/:id"
              element={<LegacyOrder from="id" />}
            />
            <Route path="/quotes/:id" element={<LegacyOrder from="id" />} />
            <Route
              path="/orders/:quoteId/receipt"
              element={<LegacyOrder from="quoteId" />}
            />
            <Route element={<WorkspaceShell />}>
              <Route path="/orders" element={<Orders />} />
              <Route path="/orders/new" element={<NewQuote />} />
              <Route path="/orders/:quoteId" element={<OrderView />} />
              <Route path="/account" element={<Account />} />
              <Route path="*" element={<WorkspaceNotFound />} />
            </Route>
          </Routes>
        </Suspense>
      </ServiceBoundary>
    </Backend>
  );
}
