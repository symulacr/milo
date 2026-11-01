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
 * HEAD" would alarm on every deploy.
 *
 * R54 adds the two things it *can* know from the same two responses, because
 * liveness + shape alone could not see the state that actually happened: on
 * 2026-10-31 both hosts answered 200 with a valid 40-hex `commit` and production
 * sat 12 commits behind `origin/main`. Both were "healthy" by every check here.
 *
 *   - disagreement: the two hosts serve different commits. That is real drift,
 *     and it is the shape of the incident `5aa08af` records — the mirror sat
 *     three days stale behind Vercel with no red run.
 *   - staleness: a host's `builtAt` is older than `STALE_AFTER_MS`.
 *
 * Emailing is transition-only. A 5 min tick that mails on every failure is 288
 * emails a day; the operator would filter them and miss the real one. One email
 * when a fault appears, one when it clears — including a host that stays stale
 * for a week, which costs exactly one email.
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

/**
 * How old a `builtAt` may be before that host's artifact counts as stale.
 *
 * The arithmetic, from the two live artifacts measured 2026-10-31:
 *   workers  builtAt 2026-10-31T12:49:33.992Z
 *   vercel   builtAt 2026-10-31T12:49:06.695Z
 * — the same push, 27.297 s apart. A spread under an hour is one deploy, so only
 * an absolute age is worth alarming on.
 *
 * An absolute threshold is affordable *because* the email is transition-only: a
 * host that stays stale for a week costs one email, not 288 a day. On a quiet
 * repository it fires once when the artifact crosses the line and stays silent
 * until the next deploy clears it. 24 h is "a full day with no successful
 * rebuild", which on a repository that deploys on every push means either no
 * pushes or a broken pipeline — the second is the case worth waking up for.
 */
export const STALE_AFTER_MS = 24 * 60 * 60_000;

/**
 * The cross-host fault: the two mirrors serve different commits.
 *
 * Neither host is necessarily wrong — this says they disagree, which is all the
 * watchdog can know without git. It names both commits in the mail so the
 * operator can tell which one is behind.
 */
export const COMMITS_DISAGREE = "commits-disagree";

export type MirrorState = {
  name: string;
  ok: boolean;
  reason: string;
  /** The artifact's commit, when the body carried a valid one. */
  commit?: string;
  /** `builtAt` in epoch ms, when the body carried a parseable one. */
  builtAt?: number;
};

/**
 * `builtAt` is `new Date().toISOString()` (scripts/build.ts:269). An artifact
 * built before that field existed carries no stamp, and a malformed one is not
 * worth a page: both mean "staleness cannot be judged for this host", so the
 * caller skips it rather than calling the host unhealthy. Refusing a host for a
 * missing optional field would page on a non-problem.
 */
function parseBuiltAt(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

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
    const body = (await response.json()) as {
      commit?: unknown;
      builtAt?: unknown;
    };
    if (typeof body.commit !== "string" || !COMMIT.test(body.commit))
      return {
        name: target.name,
        ok: false,
        reason: "commit not a 40-hex sha",
      };
    const builtAt = parseBuiltAt(body.builtAt);
    return {
      name: target.name,
      ok: true,
      reason: "ok",
      commit: body.commit,
      ...(builtAt === undefined ? {} : { builtAt }),
    };
  } catch (error) {
    return {
      name: target.name,
      ok: false,
      reason: error instanceof Error ? error.name : "unreachable",
    };
  }
}

/**
 * Every fault this tick can see, as the same `string[]` of names `recordWatch`
 * already diffs. Reusing that set is what makes these two signals transition-only
 * for free: a host that stays stale is `stillDown`, not a new fault, so it earns
 * no second email.
 *
 * A host that failed a probe contributes only its own name — it has no commit to
 * compare, and its `builtAt` is unknown, so neither new signal can be judged for
 * it. That is why disagreement is only computed when every probe succeeded.
 */
export function faultsFor(states: MirrorState[], now: number): string[] {
  const faults = states.filter((s) => !s.ok).map((s) => s.name);
  const healthy = states.filter((s) => s.ok);
  if (healthy.length !== states.length) return faults;

  if (healthy.length > 1) {
    const commits = new Set(healthy.map((s) => s.commit));
    if (commits.size > 1) faults.push(COMMITS_DISAGREE);
  }

  for (const state of healthy)
    if (state.builtAt !== undefined && now - state.builtAt > STALE_AFTER_MS)
      faults.push(`${state.name}-stale`);

  return faults;
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
    const now = Date.now();
    const names = faultsFor(states, now);
    const change = (await ctx.runMutation(recordWatchRef, {
      down: names,
      now,
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

    // Name the commit each host serves: for a disagreement that is the whole
    // diagnosis, and for a stale host it says whether a deploy happened at all.
    const lines = states.map((s) => {
      if (!s.ok) return `${s.name}: ${s.reason}`;
      const built =
        s.builtAt === undefined
          ? "builtAt unknown"
          : `built ${new Date(s.builtAt).toISOString()}`;
      return `${s.name}: ok ${String(s.commit).slice(0, 7)} (${built})`;
    });
    if (names.includes(COMMITS_DISAGREE))
      lines.push(
        `the two hosts serve different commits: ${states
          .map((s) => `${s.name}=${String(s.commit).slice(0, 7)}`)
          .join(", ")}`,
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
