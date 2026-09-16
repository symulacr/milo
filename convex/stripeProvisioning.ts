"use node";

import { internalActionGeneric, makeFunctionReference } from "convex/server";
import { type GenericId, v } from "convex/values";
import type { FrozenQuote } from "../packages/backend/src/admission-policy";
import {
  observeTestPayment,
  type TestPaymentBinding,
} from "../packages/backend/src/stripe-observer.server";
import { provisionTestIntent } from "../packages/backend/src/stripe-provisioning.server";

type JobInput = { jobId: GenericId<"paymentJobs">; generation: number };
type Snapshot = {
  job: {
    stripeAccountId: string;
    stripeCustomerId: string;
    firstAttemptAt: number;
    mode?: "create" | "observe";
  };
  quote: FrozenQuote;
  payment:
    | (Omit<TestPaymentBinding, "id"> & { _id: GenericId<"paymentIntents"> })
    | null;
} | null;

export const run = internalActionGeneric({
  args: { jobId: v.id("paymentJobs"), generation: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const snapshot = await ctx.runMutation(
      makeFunctionReference<"mutation", JobInput, Snapshot>(
        "provisioning:begin",
      ),
      args,
    );
    if (!snapshot) return null;
    const finish = makeFunctionReference<"mutation">("provisioning:finish");
    try {
      if (!snapshot.payment) {
        if (snapshot.job.mode === "observe") {
          await ctx.runMutation(finish, args);
          return null;
        }
        const stripePaymentIntentId = await provisionTestIntent({
          jobId: args.jobId,
          quote: snapshot.quote,
          firstAttemptAt: snapshot.job.firstAttemptAt,
          stripeAccountId: snapshot.job.stripeAccountId,
          stripeCustomerId: snapshot.job.stripeCustomerId,
        });
        await ctx.runMutation(finish, { ...args, stripePaymentIntentId });
      } else {
        const observation = await observeTestPayment({
          ...snapshot.payment,
          id: snapshot.payment._id,
        });
        await ctx.runMutation(finish, {
          ...args,
          ...(observation.kind === "observed"
            ? { authorization: observation.authorization }
            : {}),
        });
      }
    } catch {
      // Redact provider payloads; durable job and fixed idempotency key support safe retry.
      await ctx.runMutation(finish, args);
    }
    return null;
  },
});
