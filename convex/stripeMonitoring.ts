"use node";

import { internalActionGeneric, makeFunctionReference } from "convex/server";
import { type GenericId, v } from "convex/values";
import {
  observeTestPayment,
  type TestPaymentBinding,
} from "../packages/backend/src/stripe-observer.server";

type Fence = {
  monitorId: GenericId<"paymentMonitors">;
  generation: number;
  attempt: number;
};
type Payment = Omit<TestPaymentBinding, "id"> & {
  _id: GenericId<"paymentIntents">;
};

const beginRef = makeFunctionReference<"mutation", Fence, Payment | null>(
  "paymentMonitoring:begin",
);
const finishRef = makeFunctionReference<"mutation">("paymentMonitoring:finish");

export const run = internalActionGeneric({
  args: {
    monitorId: v.id("paymentMonitors"),
    generation: v.number(),
    attempt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const payment = await ctx.runMutation(beginRef, args);
    if (!payment) return null;
    try {
      const result = await observeTestPayment({ ...payment, id: payment._id });
      await ctx.runMutation(finishRef, {
        ...args,
        ...(result.kind === "observed"
          ? { authorization: result.authorization }
          : {}),
      });
    } catch {
      await ctx.runMutation(finishRef, args);
    }
    return null;
  },
});
