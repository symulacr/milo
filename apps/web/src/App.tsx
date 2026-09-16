import { Route, Routes } from "react-router";
import { Connections } from "./Connections";
import { BoundOrder, RoleRequired } from "./components/gates";
import { Account } from "./routes/Account";
import { NewQuote } from "./routes/NewQuote";
import { NotFound } from "./routes/NotFound";
import { OperatorCases } from "./routes/OperatorCases";
import { Orders } from "./routes/Orders";
import { OrderView } from "./routes/OrderView";
import { QuoteView } from "./routes/QuoteView";
import { Receipt } from "./routes/Receipt";
import { WorkspaceShell } from "./shells/WorkspaceShell";
import { useModel, WorkspaceContext } from "./workspace/model";

export function App() {
  const model = useModel();
  return (
    <WorkspaceContext.Provider value={model}>
      <Routes>
        <Route element={<WorkspaceShell />}>
          <Route path="/orders" element={<Orders />} />
          <Route
            path="/orders/:orderId"
            element={
              <BoundOrder>
                <OrderView />
              </BoundOrder>
            }
          />
          <Route
            path="/orders/:orderId/receipt"
            element={
              <BoundOrder>
                <Receipt />
              </BoundOrder>
            }
          />
          <Route
            path="/quotes/:quoteId"
            element={
              <BoundOrder>
                <QuoteView />
              </BoundOrder>
            }
          />
          <Route
            path="/merchant/orders"
            element={
              <RoleRequired requiredRole="merchant">
                <Orders merchant />
              </RoleRequired>
            }
          />
          <Route path="/merchant/quotes/new" element={<NewQuote />} />
          <Route path="/operator/cases" element={<OperatorCases />} />
          <Route
            path="/operator/cases/:caseId"
            element={
              <BoundOrder>
                <RoleRequired requiredRole="operator">
                  <OrderView />
                </RoleRequired>
              </BoundOrder>
            }
          />
          <Route path="/account" element={<Account />} />
          <Route
            path="/connections"
            element={<Connections headingRef={model.mainHeading} />}
          />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </WorkspaceContext.Provider>
  );
}
