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

export const run = internalActionGeneric({
  args: {
    monitorId: v.id("paymentMonitors"),
    generation: v.number(),
    attempt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const payment = await ctx.runMutation(
      makeFunctionReference<"mutation", Fence, Payment | null>(
        "paymentMonitoring:begin",
      ),
      args,
    );
    if (!payment) return null;
    const finish = makeFunctionReference<"mutation">(
      "paymentMonitoring:finish",
    );
    try {
      const result = await observeTestPayment({ ...payment, id: payment._id });
      await ctx.runMutation(finish, {
        ...args,
        ...(result.kind === "observed"
          ? { authorization: result.authorization }
          : {}),
      });
    } catch {
      await ctx.runMutation(finish, args);
    }
    return null;
  },
});
