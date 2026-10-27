import {
  cronJobs,
  type FunctionReference,
  makeFunctionReference,
} from "convex/server";

const crons = cronJobs();

const internalRef = <T extends "mutation" | "action">(name: string) =>
  makeFunctionReference<T, Record<string, never>, unknown>(
    name,
  ) as unknown as FunctionReference<T, "internal", Record<string, never>>;

crons.interval(
  "settlement sweep",
  { seconds: 60 },
  internalRef<"mutation">("settlement:sweep"),
);

crons.interval(
  "chain observation",
  { seconds: 60 },
  internalRef<"action">("chainObserver:poll"),
);

crons.interval(
  "upload grant sweep",
  { minutes: 15 },
  internalRef<"mutation">("files:sweepGrantsMutation"),
);

// The dead-letter digest. `minuteUTC` is omitted on purpose: Convex spreads the
// run across the hour, and the docs warn off the busy top-of-hour. It emails
// only when there is something wrong, and no-ops when no operator is configured.
crons.daily(
  "operator digest",
  { hourUTC: 7 },
  internalRef<"action">("diagnostics:digest"),
);

// R22 I-04: the retention the privacy page promises, actually enforced. Daily,
// off the top of the hour, bounded per run.
crons.daily(
  "prune expired order content",
  { hourUTC: 3 },
  internalRef<"mutation">("diagnostics:pruneExpiredContent"),
);

// R23 I-10: the reaping half of the dead-letter queue. The digest reports
// unprocessed inbox rows; this removes the ones that are provably stale.
crons.daily(
  "reap unprocessed payment inbox",
  { hourUTC: 4 },
  internalRef<"mutation">("diagnostics:reapPaymentInbox"),
);

export default crons;
