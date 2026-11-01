/**
 * R42: the deploy watchdog.
 *
 * The two things worth pinning are the ones that would silently rot:
 *   1. the cron is registered (a watchdog nobody schedules watches nothing), and
 *   2. mail is transition-only (a per-tick mailer is 1,440 emails a day, which
 *      an operator filters — turning the alarm into noise).
 *
 * `probeMirror` takes an injected `fetch`, so every HTTP case is exercised
 * without the network.
 */
import { describe, expect, test } from "bun:test";
import {
  COMMITS_DISAGREE,
  checkDeploy,
  faultsFor,
  type MirrorState,
  probeMirror,
  recordWatch,
  STALE_AFTER_MS,
  WATCHDOG_TARGETS,
  WATCHDOG_TIMEOUT_MS,
} from "./deployWatch";
import type { Row } from "./orderProjection.double";
import { databaseDouble } from "./orderProjection.double";

const SHA = "918049b8f6ab8ec4b973270a484558608eded650";
const target = { name: "workers", url: "https://example.test/deploy.json" };

/** A fetch that returns one canned response, or throws. */
const respond = (body: unknown, status = 200) =>
  (async () =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
    })) as unknown as typeof fetch;

const boom = (async () => {
  throw new TypeError("fetch failed");
}) as unknown as typeof fetch;

describe("R42: probeMirror decides liveness and shape", () => {
  test("a healthy mirror is ok, and carries the commit it serves", async () => {
    const state = await probeMirror(target, respond({ commit: SHA }));
    // R54: `commit` is now carried so the two hosts can be compared.
    expect(state).toEqual({
      name: "workers",
      ok: true,
      reason: "ok",
      commit: SHA,
    });
  });

  test("the request carries a timeout signal", async () => {
    let seen: RequestInit | undefined;
    const spy = (async (_url: string, init: RequestInit) => {
      seen = init;
      return new Response(JSON.stringify({ commit: SHA }), { status: 200 });
    }) as unknown as typeof fetch;
    await probeMirror(target, spy);
    expect(seen?.signal).toBeInstanceOf(AbortSignal);
    expect(WATCHDOG_TIMEOUT_MS).toBe(10_000);
  });

  for (const status of [500, 503, 404, 403, 429]) {
    test(`HTTP ${status} is down, and the reason names the status`, async () => {
      const state = await probeMirror(target, respond({ commit: SHA }, status));
      expect(state.ok).toBe(false);
      expect(state.reason).toBe(`HTTP ${status}`);
    });
  }

  test("a 200 with unparseable JSON is down, not a crash", async () => {
    const state = await probeMirror(target, respond("<html>not json</html>"));
    expect(state.ok).toBe(false);
    // The parse throws inside the try, so the reason is the error name.
    expect(state.reason.length).toBeGreaterThan(0);
  });

  test("a 200 with no commit field is down", async () => {
    const state = await probeMirror(target, respond({ branch: "main" }));
    expect(state.ok).toBe(false);
    expect(state.reason).toBe("commit not a 40-hex sha");
  });

  test("a null commit is down (the Vercel mirror really reports null branch)", async () => {
    const state = await probeMirror(target, respond({ commit: null }));
    expect(state.ok).toBe(false);
    expect(state.reason).toBe("commit not a 40-hex sha");
  });

  test("a short sha is down: a truncated build stamp is not a commit", async () => {
    const state = await probeMirror(target, respond({ commit: "918049b" }));
    expect(state.ok).toBe(false);
  });

  test("a non-hex commit is down", async () => {
    const state = await probeMirror(
      target,
      respond({ commit: "z".repeat(40) }),
    );
    expect(state.ok).toBe(false);
  });

  test("an uppercase sha is down: git prints lowercase", async () => {
    const state = await probeMirror(
      target,
      respond({ commit: SHA.toUpperCase() }),
    );
    expect(state.ok).toBe(false);
  });

  test("a network error is down with the error name, never a throw", async () => {
    const state = await probeMirror(target, boom);
    expect(state).toEqual({ name: "workers", ok: false, reason: "TypeError" });
  });

  test("both mirrors are watched while both exist", () => {
    expect(WATCHDOG_TARGETS.map((t) => t.name)).toEqual(["workers", "vercel"]);
    expect(WATCHDOG_TARGETS[0].url).toContain("workers.dev/deploy.json");
    expect(WATCHDOG_TARGETS[1].url).toContain("vercel.app/deploy.json");
  });
});

describe("R42: recordWatch reports transitions, not states", () => {
  const ctxFor = (tables: Record<string, Row[]>) =>
    databaseDouble(tables).ctx as never;

  const record = async (
    tables: Record<string, Row[]>,
    down: string[],
    now: number,
  ) =>
    (
      recordWatch as unknown as {
        _handler: (
          c: never,
          a: { down: string[]; now: number },
        ) => Promise<{
          becameDown: string[];
          becameHealthy: string[];
          stillDown: string[];
        }>;
      }
    )._handler(ctxFor(tables), { down, now });

  test("the first observation of a healthy deployment is not an alarm", async () => {
    const tables = { deployWatch: [] as Row[] };
    const out = await record(tables, [], 1_000);
    expect(out).toEqual({ becameDown: [], becameHealthy: [], stillDown: [] });
    expect(tables.deployWatch).toHaveLength(1);
    expect(tables.deployWatch[0].since).toBe(0);
  });

  test("the first observation of a DOWN deployment is a transition", async () => {
    const tables = { deployWatch: [] as Row[] };
    const out = await record(tables, ["vercel"], 1_000);
    expect(out.becameDown).toEqual(["vercel"]);
    expect(tables.deployWatch[0].since).toBe(1_000);
  });

  test("a second tick with the same failure is NOT a transition", async () => {
    const tables = { deployWatch: [] as Row[] };
    await record(tables, ["vercel"], 1_000);
    const out = await record(tables, ["vercel"], 2_000);
    expect(out).toEqual({
      becameDown: [],
      becameHealthy: [],
      stillDown: ["vercel"],
    });
    // The episode start is preserved, so the recovery mail can say how long.
    expect(tables.deployWatch[0].since).toBe(1_000);
  });

  test("recovery is a transition and clears the episode", async () => {
    const tables = { deployWatch: [] as Row[] };
    await record(tables, ["vercel"], 1_000);
    const out = await record(tables, [], 3_000);
    expect(out.becameHealthy).toEqual(["vercel"]);
    expect(tables.deployWatch[0].since).toBe(0);
    expect(tables.deployWatch[0].down).toEqual([]);
  });

  test("a second mirror failing mid-episode is its own transition", async () => {
    const tables = { deployWatch: [] as Row[] };
    await record(tables, ["vercel"], 1_000);
    const out = await record(tables, ["vercel", "workers"], 2_000);
    expect(out.becameDown).toEqual(["workers"]);
    expect(out.stillDown).toEqual(["vercel"]);
    // The episode began when the FIRST mirror failed, not when the second did.
    expect(tables.deployWatch[0].since).toBe(1_000);
  });

  test("only one row is ever written", async () => {
    const tables = { deployWatch: [] as Row[] };
    for (let i = 0; i < 5; i++) await record(tables, ["vercel"], i * 1_000);
    expect(tables.deployWatch).toHaveLength(1);
  });
});

describe("R42: checkDeploy emails on transitions only", () => {
  /** Run the action with a stubbed fetch and a stubbed mail transport. */
  const run = async (opts: {
    tables: Record<string, Row[]>;
    down: string[];
    operators: string | undefined;
  }) => {
    const previous = {
      operators: process.env.MILO_OPERATOR_EMAILS,
      from: process.env.MAIL_FROM,
      key: process.env.RESEND_API_KEY,
      provider: process.env.MAIL_PROVIDER,
    };
    if (opts.operators === undefined) delete process.env.MILO_OPERATOR_EMAILS;
    else process.env.MILO_OPERATOR_EMAILS = opts.operators;
    // `sendEmail` fails closed without these, which is correct — so the harness
    // has to look like a configured deployment for the mail path to be reached.
    process.env.MAIL_FROM = "Milo <sign-in@milo.example>";
    process.env.RESEND_API_KEY = "re_probe_key";
    delete process.env.MAIL_PROVIDER;

    const sent: { to: string; subject: string }[] = [];
    const realFetch = globalThis.fetch;
    // probeMirror uses the injected fetch; sendEmail uses global fetch. Route
    // both: the mirrors answer from `down`, and the mail endpoint records.
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      if (href.includes("api.resend.com") || href.includes("/emails")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          to?: string[];
          subject?: string;
        };
        sent.push({
          to: String(body.to?.[0] ?? ""),
          subject: String(body.subject ?? ""),
        });
        return new Response(JSON.stringify({ id: "re_probe" }), {
          status: 200,
        });
      }
      const name = href.includes("workers.dev") ? "workers" : "vercel";
      if (opts.down.includes(name))
        return new Response("down", { status: 503 });
      return new Response(JSON.stringify({ commit: SHA }), { status: 200 });
    }) as unknown as typeof fetch;

    const db = databaseDouble(opts.tables);
    const ctx = {
      runMutation: async (
        _ref: unknown,
        args: { down: string[]; now: number },
      ) =>
        (
          recordWatch as unknown as {
            _handler: (c: never, a: typeof args) => Promise<unknown>;
          }
        )._handler(db.ctx as never, args),
    } as never;

    try {
      const out = await (
        checkDeploy as unknown as {
          _handler: (c: never) => Promise<{
            down: string[];
            emailed: number;
            transition: boolean;
          }>;
        }
      )._handler(ctx);
      return { out, sent };
    } finally {
      globalThis.fetch = realFetch;
      for (const [name, value] of [
        ["MILO_OPERATOR_EMAILS", previous.operators],
        ["MAIL_FROM", previous.from],
        ["RESEND_API_KEY", previous.key],
        ["MAIL_PROVIDER", previous.provider],
      ] as const) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  };

  test("a healthy deployment sends nothing", async () => {
    const { out, sent } = await run({
      tables: { deployWatch: [] },
      down: [],
      operators: "op@studio.example",
    });
    expect(out).toEqual({ down: [], emailed: 0, transition: false });
    expect(sent).toHaveLength(0);
  });

  test("the first failure emails exactly once", async () => {
    const { out, sent } = await run({
      tables: { deployWatch: [] },
      down: ["vercel"],
      operators: "op@studio.example",
    });
    expect(out.transition).toBe(true);
    expect(out.emailed).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("op@studio.example");
    expect(sent[0].subject).toContain("DOWN");
  });

  test("a SECOND tick with the same failure sends nothing", async () => {
    // This is the whole point: 1,440 ticks a day must not be 1,440 emails.
    const tables = { deployWatch: [] as Row[] };
    await run({ tables, down: ["vercel"], operators: "op@studio.example" });
    const { out, sent } = await run({
      tables,
      down: ["vercel"],
      operators: "op@studio.example",
    });
    expect(out.transition).toBe(false);
    expect(out.emailed).toBe(0);
    expect(sent).toHaveLength(0);
  });

  test("recovery emails a recovery notice", async () => {
    const tables = { deployWatch: [] as Row[] };
    await run({ tables, down: ["vercel"], operators: "op@studio.example" });
    const { out, sent } = await run({
      tables,
      down: [],
      operators: "op@studio.example",
    });
    expect(out.transition).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toContain("recovered");
  });

  test("no operator configured means no send and no crash", async () => {
    const { out, sent } = await run({
      tables: { deployWatch: [] },
      down: ["vercel"],
      operators: undefined,
    });
    expect(out.emailed).toBe(0);
    expect(sent).toHaveLength(0);
  });
});

describe("R42: the cron is registered", () => {
  test("crons.ts schedules the watchdog and names the function", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(
      new URL("./crons.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain('"deploy watchdog"');
    expect(source).toContain("deployWatch:checkDeploy");
    // An interval, not a daily: a watchdog that runs once a day misses the day.
    expect(source).toMatch(/"deploy watchdog",\s*\{ minutes: \d+ \}/);
  });

  test("the interval is short enough to catch a bad deploy", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(
      new URL("./crons.ts", import.meta.url),
      "utf8",
    );
    const match = source.match(/"deploy watchdog",\s*\{ minutes: (\d+) \}/);
    expect(match).not.toBeNull();
    const minutes = Number(match?.[1]);
    expect(minutes).toBeGreaterThanOrEqual(1);
    expect(minutes).toBeLessThanOrEqual(15);
  });
});

/**
 * R54: the two conditions liveness + shape could not see.
 *
 * On 2026-10-31 both hosts answered 200 with a valid 40-hex commit and
 * production sat 12 commits behind `origin/main`. Every check above passed.
 */
describe("R54: disagreement and staleness", () => {
  const NOW = Date.parse("2026-10-31T18:00:00.000Z");
  const FRESH = NOW - 60_000;
  const OLD = NOW - STALE_AFTER_MS - 60_000;
  const A = "a".repeat(40);
  const B = "b".repeat(40);

  const ok = (name: string, commit: string, builtAt?: number): MirrorState => ({
    name,
    ok: true,
    reason: "ok",
    commit,
    ...(builtAt === undefined ? {} : { builtAt }),
  });

  test("the threshold is a day, from the measured 27 s spread", () => {
    // workers 12:49:33.992Z vs vercel 12:49:06.695Z = 27.297 s apart, same push.
    expect(STALE_AFTER_MS).toBe(24 * 60 * 60_000);
    const workers = Date.parse("2026-10-31T12:49:33.992Z");
    const vercel = Date.parse("2026-10-31T12:49:06.695Z");
    expect(workers - vercel).toBe(27_297);
    expect(workers - vercel).toBeLessThan(STALE_AFTER_MS);
  });

  test("two hosts agreeing and fresh report no fault", () => {
    expect(
      faultsFor([ok("workers", A, FRESH), ok("vercel", A, FRESH)], NOW),
    ).toEqual([]);
  });

  test("two hosts disagreeing is its own fault, naming neither host", () => {
    expect(
      faultsFor([ok("workers", A, FRESH), ok("vercel", B, FRESH)], NOW),
    ).toEqual([COMMITS_DISAGREE]);
  });

  test("a stale host is a fault named after the host", () => {
    expect(
      faultsFor([ok("workers", A, OLD), ok("vercel", A, FRESH)], NOW),
    ).toEqual(["workers-stale"]);
  });

  test("both stale is two faults; stale AND disagreeing is three", () => {
    expect(
      faultsFor([ok("workers", A, OLD), ok("vercel", A, OLD)], NOW),
    ).toEqual(["workers-stale", "vercel-stale"]);
    expect(
      faultsFor([ok("workers", A, OLD), ok("vercel", B, OLD)], NOW),
    ).toEqual([COMMITS_DISAGREE, "workers-stale", "vercel-stale"]);
  });

  test("exactly at the threshold is not stale: the comparison is strict", () => {
    expect(faultsFor([ok("workers", A, NOW - STALE_AFTER_MS)], NOW)).toEqual(
      [],
    );
  });

  test("a missing builtAt is skipped, not a fault", () => {
    expect(faultsFor([ok("workers", A), ok("vercel", A)], NOW)).toEqual([]);
    // ...and a missing stamp on one host does not hide a stale sibling.
    expect(faultsFor([ok("workers", A), ok("vercel", A, OLD)], NOW)).toEqual([
      "vercel-stale",
    ]);
  });

  test("a malformed builtAt is skipped, not a crash", () => {
    const bad = {
      name: "workers",
      ok: true,
      reason: "ok",
      commit: A,
      builtAt: Number.NaN,
    } as MirrorState;
    expect(() => faultsFor([bad, ok("vercel", A, FRESH)], NOW)).not.toThrow();
    expect(faultsFor([bad, ok("vercel", A, FRESH)], NOW)).toEqual([]);
  });

  test("a down host contributes only its own name", () => {
    const down: MirrorState = {
      name: "vercel",
      ok: false,
      reason: "HTTP 503",
    };
    expect(faultsFor([ok("workers", A, FRESH), down], NOW)).toEqual(["vercel"]);
  });

  describe("probeMirror carries what the new checks need", () => {
    test("a real artifact body yields commit and builtAt", async () => {
      const state = await probeMirror(
        target,
        respond({ commit: SHA, builtAt: "2026-10-31T12:49:33.992Z" }),
      );
      expect(state.commit).toBe(SHA);
      expect(state.builtAt).toBe(Date.parse("2026-10-31T12:49:33.992Z"));
    });

    test("an absent builtAt leaves the field off rather than NaN", async () => {
      const state = await probeMirror(target, respond({ commit: SHA }));
      expect(state).not.toHaveProperty("builtAt");
    });

    test("a malformed builtAt leaves the field off, never a throw", async () => {
      for (const bad of ["", "not-a-date", 42, null, {}]) {
        const state = await probeMirror(
          target,
          respond({ commit: SHA, builtAt: bad }),
        );
        expect(state.ok).toBe(true);
        expect(state).not.toHaveProperty("builtAt");
      }
    });
  });
});

describe("R54: checkDeploy emails once for a stale host, again on recovery", () => {
  /** Both hosts answer 200; `builtAt`/`commit` chosen per host. */
  const run = async (opts: {
    tables: Record<string, Row[]>;
    builtAt: Record<string, string | undefined>;
    commits?: Record<string, string>;
  }) => {
    const previous = {
      operators: process.env.MILO_OPERATOR_EMAILS,
      from: process.env.MAIL_FROM,
      key: process.env.RESEND_API_KEY,
      provider: process.env.MAIL_PROVIDER,
    };
    process.env.MILO_OPERATOR_EMAILS = "op@studio.example";
    process.env.MAIL_FROM = "Milo <sign-in@milo.example>";
    process.env.RESEND_API_KEY = "re_probe_key";
    delete process.env.MAIL_PROVIDER;

    const sent: { subject: string }[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      if (href.includes("api.resend.com") || href.includes("/emails")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          subject?: string;
        };
        sent.push({ subject: String(body.subject ?? "") });
        return new Response(JSON.stringify({ id: "re_probe" }), {
          status: 200,
        });
      }
      const name = href.includes("workers.dev") ? "workers" : "vercel";
      const commit = opts.commits?.[name] ?? SHA;
      const builtAt = opts.builtAt[name];
      return new Response(
        JSON.stringify(
          builtAt === undefined ? { commit } : { commit, builtAt },
        ),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const db = databaseDouble(opts.tables);
    const ctx = {
      runMutation: async (
        _ref: unknown,
        args: { down: string[]; now: number },
      ) =>
        (
          recordWatch as unknown as {
            _handler: (c: never, a: typeof args) => Promise<unknown>;
          }
        )._handler(db.ctx as never, args),
    } as never;

    try {
      const out = await (
        checkDeploy as unknown as {
          _handler: (c: never) => Promise<{
            down: string[];
            emailed: number;
            transition: boolean;
          }>;
        }
      )._handler(ctx);
      return { out, sent };
    } finally {
      globalThis.fetch = realFetch;
      for (const [name, value] of [
        ["MILO_OPERATOR_EMAILS", previous.operators],
        ["MAIL_FROM", previous.from],
        ["RESEND_API_KEY", previous.key],
        ["MAIL_PROVIDER", previous.provider],
      ] as const) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  };

  const iso = (ms: number) => new Date(ms).toISOString();

  test("a fresh, agreeing pair sends nothing", async () => {
    const fresh = iso(Date.now() - 60_000);
    const { out, sent } = await run({
      tables: { deployWatch: [] },
      builtAt: { workers: fresh, vercel: fresh },
    });
    expect(out.down).toEqual([]);
    expect(sent).toHaveLength(0);
  });

  test("disagreement emails once", async () => {
    const fresh = iso(Date.now() - 60_000);
    const { out, sent } = await run({
      tables: { deployWatch: [] },
      builtAt: { workers: fresh, vercel: fresh },
      commits: { workers: "a".repeat(40), vercel: "b".repeat(40) },
    });
    expect(out.down).toEqual([COMMITS_DISAGREE]);
    expect(out.emailed).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toContain("DOWN");
  });

  test("a stale host emails once and stays silent on the next tick", async () => {
    const tables = { deployWatch: [] as Row[] };
    const stale = iso(Date.now() - STALE_AFTER_MS - 60_000);
    const fresh = iso(Date.now() - 60_000);

    const first = await run({
      tables,
      builtAt: { workers: stale, vercel: fresh },
    });
    expect(first.out.down).toEqual(["workers-stale"]);
    expect(first.out.emailed).toBe(1);
    expect(first.sent).toHaveLength(1);

    // The whole point: a permanently stale host must not mail every tick.
    const second = await run({
      tables,
      builtAt: { workers: stale, vercel: fresh },
    });
    expect(second.out.down).toEqual(["workers-stale"]);
    expect(second.out.transition).toBe(false);
    expect(second.out.emailed).toBe(0);
    expect(second.sent).toHaveLength(0);
  });

  test("recovery from staleness emails a recovery notice", async () => {
    const tables = { deployWatch: [] as Row[] };
    const stale = iso(Date.now() - STALE_AFTER_MS - 60_000);
    const fresh = iso(Date.now() - 60_000);

    await run({ tables, builtAt: { workers: stale, vercel: fresh } });
    const { out, sent } = await run({
      tables,
      builtAt: { workers: fresh, vercel: fresh },
    });
    expect(out.down).toEqual([]);
    expect(out.transition).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toContain("recovered");
  });
});
