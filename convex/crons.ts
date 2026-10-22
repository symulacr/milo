import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

/**
 * Scheduled work. Nothing else in the tree drove these paths, so capture and
 * void were unreachable and a stuck settlement operation never resumed.
 *
 * - settlement sweep: resumes due pending operations and reclaims a running
 *   attempt whose lease expired. Bounded by MAX_SWEEP per run.
 * - grant sweep: drops expired unconsumed upload grants after the TTL grace.
 */
const crons = cronJobs();

crons.interval("settlement sweep", { seconds: 60 }, internal.settlement.sweep);

crons.interval(
  "chain observation",
  { seconds: 60 },
  internal.chainObserver.poll,
);

crons.interval(
  "upload grant sweep",
  { minutes: 15 },
  internal.files.sweepGrantsMutation,
);

export default crons;
