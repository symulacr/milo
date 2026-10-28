/**
 * R42: the deploy watchdog.
 *
 * GitHub's `schedule` trigger is unreliable (community threads report dropped and
 * hours-late runs since 2026-08-26), so the Actions uptime probe cannot be the
 * only thing watching the mirrors. Convex crons demonstrably run here — two 60 s
 * intervals already tick — so the check lives there.
 *
 * What it can and cannot know: Convex has no git access, so it cannot compare a
 * mirror's `commit` to HEAD. A mirror is one deploy behind on any given day
 * (measured: both served `918049b` while HEAD was `23821c7`), so "commit matches
 * HEAD" would alarm on every deploy. The check is therefore liveness + shape:
 * HTTP 200, JSON, and a `commit` that is a full 40-hex sha.
 *
 * Emailing is transition-only. A 60 s tick that mails on every failure is 1,440
 * emails a day; the operator would filter them and miss the real one. One email
 * when a mirror goes down, one when it comes back.
 */
import {
  internalActionGeneric,
  internalMutationGeneric,
  makeFunctionReference,
} from "convex/server";
import { v } from "convex/values";
import { sendEmail } from "../packages/backend/src/email";
import {
  operatorConfig,
  operatorEmails,
  warnIfNoOperator,
} from "../packages/backend/src/session-identity";

/** The mirrors, while both exist. */
export const WATCHDOG_TARGETS = [
  { name: "workers", url: "https://milo.k2jodz91zi.workers.dev/deploy.json" },
  { name: "vercel", url: "https://milo-nine-delta.vercel.app/deploy.json" },
] as const;

type Change = {
  becameDown: string[];
  becameHealthy: string[];
  stillDown: string[];
};

const recordWatchRef = makeFunctionReference<
  "mutation",
  { down: string[]; now: number },
  Change
>("deployWatch:recordWatch");

/** A full git sha. Short shas and `null` are both failures of shape. */
const COMMIT = /^[a-f0-9]{40}$/;

/** One request must not hold the tick open. */
export const WATCHDOG_TIMEOUT_MS = 10_000;

export type MirrorState = { name: string; ok: boolean; reason: string };

/**
 * Fetch one mirror and decide whether it is healthy. Never throws: a watchdog
 * that dies on a network error is not a watchdog.
 */
export async function probeMirror(
  target: { name: string; url: string },
  fetchImpl: typeof fetch = fetch,
): Promise<MirrorState> {
  try {
    const response = await fetchImpl(target.url, {
      signal: AbortSignal.timeout(WATCHDOG_TIMEOUT_MS),
    });
    if (!response.ok)
      return {
        name: target.name,
        ok: false,
        reason: `HTTP ${response.status}`,
      };
    const body = (await response.json()) as { commit?: unknown };
    if (typeof body.commit !== "string" || !COMMIT.test(body.commit))
      return {
        name: target.name,
        ok: false,
        reason: "commit not a 40-hex sha",
      };
    return { name: target.name, ok: true, reason: "ok" };
  } catch (error) {
    return {
      name: target.name,
      ok: false,
      reason: error instanceof Error ? error.name : "unreachable",
    };
  }
}

/** The one row. A singleton keeps "is it down?" a single read. */
const STATE_KEY = "mirrors";

/**
 * Record the current failure set and report whether this tick is a transition.
 * A transition is what earns an email; a steady state does not.
 */
export const recordWatch = internalMutationGeneric({
  args: { down: v.array(v.string()), now: v.number() },
  returns: v.object({
    becameDown: v.array(v.string()),
    becameHealthy: v.array(v.string()),
    stillDown: v.array(v.string()),
  }),
  handler: async (ctx, { down, now }) => {
    const row = await ctx.db
      .query("deployWatch")
      .withIndex("by_key", (q) => q.eq("key", STATE_KEY))
      .unique();
    // `down` is `string[]` from the validator; `row.down` is inferred from the
    // schema, so annotate rather than let `previous` widen to `any[]`.
    const previous: string[] = row?.down ?? [];
    const becameDown = down.filter((n) => !previous.includes(n));
    const becameHealthy = previous.filter((n) => !down.includes(n));
    const stillDown = down.filter((n) => previous.includes(n));
    if (!row) {
      await ctx.db.insert("deployWatch", {
        key: STATE_KEY,
        down,
        since: down.length > 0 ? now : 0,
        checkedAt: now,
      });
    } else {
      await ctx.db.patch(row._id, {
        down,
        // The episode start is the FIRST failure and survives a second mirror
        // joining: the deployment has been unhealthy since then, and the
        // recovery mail should say so rather than restarting the clock.
        since: down.length === 0 ? 0 : row.since || now,
        checkedAt: now,
      });
    }
    return { becameDown, becameHealthy, stillDown };
  },
});

/** One line per tick, and only when something is wrong. */
export const checkDeploy = internalActionGeneric({
  args: {},
  returns: v.object({
    down: v.array(v.string()),
    emailed: v.number(),
    transition: v.boolean(),
  }),
  handler: async (ctx) => {
    const states = await Promise.all(
      WATCHDOG_TARGETS.map((target) => probeMirror(target)),
    );
    const down = states.filter((s) => !s.ok);
    const names = down.map((d) => d.name);
    const change = (await ctx.runMutation(recordWatchRef, {
      down: names,
      now: Date.now(),
    })) as Change;

    const transition =
      change.becameDown.length > 0 || change.becameHealthy.length > 0;
    if (!transition) {
      // Steady state. Log only when down, so a healthy deployment is silent and
      // a broken one leaves a heartbeat without flooding the 256-line buffer.
      if (names.length > 0)
        console.warn("deploy-watch", JSON.stringify({ down: names }));
      return { down: names, emailed: 0, transition: false };
    }

    if (!operatorConfig().configured) {
      warnIfNoOperator();
      return { down: names, emailed: 0, transition: true };
    }

    const lines = states.map((s) =>
      s.ok ? `${s.name}: ok` : `${s.name}: ${s.reason}`,
    );
    const subject =
      change.becameDown.length > 0
        ? `Milo deploy watchdog: ${change.becameDown.join(", ")} DOWN`
        : `Milo deploy watchdog: ${change.becameHealthy.join(", ")} recovered`;
    const text = [
      ...lines,
      "",
      change.becameDown.length > 0
        ? `Newly down: ${change.becameDown.join(", ")}`
        : "Recovered.",
      change.stillDown.length > 0
        ? `Still down: ${change.stillDown.join(", ")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    let emailed = 0;
    for (const to of operatorEmails()) {
      try {
        await sendEmail({
          to,
          url: WATCHDOG_TARGETS[0].url,
          subject,
          text,
        });
        emailed += 1;
      } catch {
        // One bad recipient must not stop the rest; the next transition retries.
      }
    }
    console.warn(
      "deploy-watch",
      JSON.stringify({ transition: true, down: names, emailed }),
    );
    return { down: names, emailed, transition: true };
  },
});
