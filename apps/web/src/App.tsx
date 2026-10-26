import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router";
import { Loading } from "./components/ui/status";
import { Account } from "./routes/Account";
import { NewQuote } from "./routes/NewQuote";
import { Orders } from "./routes/Orders";
import { WorkspaceNotFound } from "./routes/WorkspaceNotFound";
import { ServiceBoundary, WorkspaceShell } from "./shells/WorkspaceShell";
import { Backend } from "./workspace/backend";

const OrderView = lazy(() =>
  import("./routes/OrderView").then(({ OrderView }) => ({
    default: OrderView,
  })),
);

export function App() {
  return (
    <Backend>
      <ServiceBoundary>
        <Suspense fallback={<Loading label="Loading the order…" />}>
          <Routes>
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
