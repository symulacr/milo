import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

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
