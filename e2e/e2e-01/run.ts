/**
 * E2E-01 happy-path harness scaffold (D3d).
 *
 * Drives the order happy path once auth is available via option A, B, or C.
 * Three consecutive passes are required before DONE — this harness does NOT
 * mark D3d done and does not invent passes. When auth is unavailable it
 * exits BLOCKED (not fail, not pass).
 *
 * Auth options (DRIFT-CHECK O-PRIVY-AUTH):
 *   A — email + Privy test accounts (needs O-PRIVY-TEST owner gap closed)
 *   B — EVM-wallet SIWE (product change; owner accept)
 *   C — local test JWT issuer on disposable Convex only (e2e/test-jwt-issuer.ts)
 *
 * Option C results are labeled `local-convex+test-issuer`.
 *
 * Usage (local disposable Convex only, ports 3200-3299):
 *   MILO_TEST_ISSUER=local-only CONVEX_URL=http://127.0.0.1:3210 \
 *     bun e2e/e2e-01/run.ts --auth C --runs 3
 *
 * When auth is not yet available:
 *   bun e2e/e2e-01/run.ts --auth C --runs 3
 *   → exit 2, status BLOCKED, no pass counted.
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  decodeTestJwtClaims,
  evaluateTestIssuerGate,
  generateTestIssuerKeys,
  mintTestJwt,
  MILO_TEST_ISSUER_VALUE,
  RESULT_LABEL,
  testSubjectForRole,
  type TestIssuerGateEnv,
} from "../test-jwt-issuer";

export type AuthOption = "A" | "B" | "C";

export type StepName =
  | "auth-gate"
  | "mint-or-acquire-token"
  | "backend-session"
  | "quote-reserve"
  | "merchant-accept"
  | "merchant-submit-delivery"
  | "buyer-approve";

export type StepResult = {
  step: StepName;
  ok: boolean;
  detail: string;
  at: number;
};

export type RunResult = {
  run: number;
  auth: AuthOption;
  label: string;
  status: "pass" | "fail" | "blocked";
  steps: StepResult[];
  at: number;
};

export type HarnessSummary = {
  requiredPasses: number;
  passes: number;
  consecutivePasses: number;
  runs: RunResult[];
  done: false;
  d3dMarkedDone: false;
  label: string;
  note: string;
};

const REQUIRED_PASSES = 3;

const HAPPY_PATH: StepName[] = [
  "auth-gate",
  "mint-or-acquire-token",
  "backend-session",
  "quote-reserve",
  "merchant-accept",
  "merchant-submit-delivery",
  "buyer-approve",
];

export function labelForAuth(auth: AuthOption): string {
  return auth === "C" ? RESULT_LABEL : `privy-option-${auth.toLowerCase()}`;
}

export type AuthAvailability =
  | { available: true; auth: AuthOption; label: string; detail: string }
  | { available: false; auth: AuthOption; code: string; detail: string; ownerAction?: string };

/**
 * Detect whether the chosen auth path can run RIGHT NOW. Never fakes
 * availability. Option C is available only when the test-issuer gate is open
 * and a local Convex URL is configured. Option A needs owner test accounts.
 * Option B needs owner accept of the SIWE product change.
 */
export function checkAuthAvailability(
  auth: AuthOption,
  env: TestIssuerGateEnv = process.env,
  convexUrl?: string | null,
): AuthAvailability {
  if (auth === "C") {
    const gate = evaluateTestIssuerGate(env, {
      convexUrl: convexUrl ?? env.CONVEX_URL ?? null,
      requireConvexUrl: true,
    });
    if (!gate.ok) {
      return {
        available: false,
        auth,
        code: gate.code,
        detail: gate.reason,
        ownerAction:
          "For option C: set MILO_TEST_ISSUER=local-only and CONVEX_URL to a loopback disposable Convex (3200-3299). Coordinator must also apply the proposed auth.config.ts patch.",
      };
    }
    return {
      available: true,
      auth,
      label: RESULT_LABEL,
      detail: `local test issuer gate open; convex=${gate.convexUrl ?? "unset"}`,
    };
  }
  if (auth === "A") {
    const hasPrivy =
      Boolean(env.PRIVY_APP_ID) && Boolean(env.PRIVY_APP_SECRET);
    const hasTestAccount = Boolean(env.PRIVY_TEST_EMAIL || env.PRIVY_TEST_PHONE);
    if (hasPrivy && hasTestAccount) {
      return {
        available: true,
        auth,
        label: labelForAuth(auth),
        detail: "Privy app credentials and a dashboard test account are present.",
      };
    }
    return {
      available: false,
      auth,
      code: "o-privy-test",
      detail:
        "O-PRIVY-TEST owner gap: Privy dashboard test accounts (or app secret) are not provisioned.",
      ownerAction:
        "Privy Dashboard → User management → Authentication → Advanced → Enable test accounts; export PRIVY_TEST_EMAIL / PRIVY_TEST_OTP.",
    };
  }
  return {
    available: false,
    auth,
    code: "o-privy-auth-b",
    detail:
      "Option B (SIWE) is a product change requiring explicit owner accept (O-PRIVY-AUTH).",
    ownerAction: "OWNER-QUEUE O-PRIVY-AUTH: accept or reject SIWE login change.",
  };
}

export type StepContext = {
  auth: AuthOption;
  label: string;
  convexUrl: string | null;
  token: string | null;
  env: TestIssuerGateEnv;
};

/**
 * One happy-path step. Scaffold: real UI/chain calls land here once auth is
 * live. Each step must either succeed with evidence detail or return ok:false.
 * No step may invent success.
 */
export async function runStep(
  step: StepName,
  ctx: StepContext,
): Promise<StepResult> {
  const at = Date.now();
  switch (step) {
    case "auth-gate": {
      const availability = checkAuthAvailability(ctx.auth, ctx.env, ctx.convexUrl);
      return {
        step,
        ok: availability.available,
        detail: availability.available
          ? availability.detail
          : `BLOCKED ${"code" in availability ? availability.code : "?"}: ${availability.detail}`,
        at,
      };
    }
    case "mint-or-acquire-token": {
      if (ctx.auth === "C") {
        try {
          const keys = generateTestIssuerKeys();
          const minted = mintTestJwt(
            keys,
            { subject: testSubjectForRole("buyer") },
            ctx.env,
            { convexUrl: ctx.convexUrl },
          );
          const claims = decodeTestJwtClaims(minted.token);
          return {
            step,
            ok: Boolean(claims?.claims.sub),
            detail: `minted ${minted.label} sub=${String(claims?.claims.sub)} (token not logged)`,
            at,
          };
        } catch (error) {
          return {
            step,
            ok: false,
            detail: `mint refused: ${error instanceof Error ? error.message : String(error)}`,
            at,
          };
        }
      }
      return {
        step,
        ok: false,
        detail: `Option ${ctx.auth} token acquisition is not implemented in scaffold — requires owner-provisioned credentials.`,
        at,
      };
    }
    case "backend-session": {
      return {
        step,
        ok: false,
        detail:
          "Scaffold: wire auth/session:current over the Convex client once a token is accepted by local Convex (requires coordinator auth.config patch).",
        at,
      };
    }
    case "quote-reserve":
    case "merchant-accept":
    case "merchant-submit-delivery":
    case "buyer-approve": {
      return {
        step,
        ok: false,
        detail: `Scaffold step ${step}: drive via UI or Convex mutations once backend-session passes. No stub pass.`,
        at,
      };
    }
  }
}

/**
 * Run the happy path `runs` times. Requires `REQUIRED_PASSES` consecutive
 * passes for DONE. Always returns `done: false` and `d3dMarkedDone: false`:
 * marking D3d is the coordinator's action after independent 3× evidence.
 */
export async function runE2E01(options: {
  auth: AuthOption;
  runs?: number;
  env?: TestIssuerGateEnv;
  convexUrl?: string | null;
  onRun?: (result: RunResult) => void;
}): Promise<HarnessSummary> {
  const env = options.env ?? process.env;
  const runs = Math.max(1, options.runs ?? REQUIRED_PASSES);
  const convexUrl = options.convexUrl ?? env.CONVEX_URL ?? null;
  const label = labelForAuth(options.auth);
  const results: RunResult[] = [];
  let consecutive = 0;

  for (let run = 1; run <= runs; run++) {
    const steps: StepResult[] = [];
    let status: RunResult["status"] = "pass";
    let ctx: StepContext = {
      auth: options.auth,
      label,
      convexUrl,
      token: null,
      env,
    };

    for (const step of HAPPY_PATH) {
      const result = await runStep(step, ctx);
      steps.push(result);
      if (!result.ok) {
        status = result.detail.startsWith("BLOCKED") ? "blocked" : "fail";
        break;
      }
      if (step === "mint-or-acquire-token" && options.auth === "C") {
        // Token stays in-process for later steps; never persisted.
        ctx = { ...ctx, token: "<in-memory>" };
      }
    }

    const runResult: RunResult = {
      run,
      auth: options.auth,
      label,
      status,
      steps,
      at: Date.now(),
    };
    results.push(runResult);
    options.onRun?.(runResult);

    if (status === "pass") {
      consecutive += 1;
      if (consecutive >= REQUIRED_PASSES) break;
    } else {
      consecutive = 0;
      // A blocked/fail run stops the streak; keep going only if caller asked
      // for more runs to collect evidence — but never count them as DONE.
      if (status === "blocked") break;
    }
  }

  return {
    requiredPasses: REQUIRED_PASSES,
    passes: results.filter((r) => r.status === "pass").length,
    consecutivePasses: consecutive,
    runs: results,
    done: false,
    d3dMarkedDone: false,
    label,
    note:
      consecutive >= REQUIRED_PASSES
        ? `${REQUIRED_PASSES} consecutive passes observed at label=${label}. D3d still NOT marked done — coordinator must verify 3× independently (video/HAR/SRT).`
        : `Auth happy path not proven (${consecutive} consecutive passes, need ${REQUIRED_PASSES}). D3d remains blocked/not done.`,
  };
}

/** CLI entry — writes a receipt under e2e/e2e-01/out/ and exits 0/2. */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const authArg = args.find((a) => a.startsWith("--auth"))?.split("=")[1] ??
    args[args.indexOf("--auth") + 1];
  const runsArg = args.find((a) => a.startsWith("--runs"))?.split("=")[1] ??
    args[args.indexOf("--runs") + 1];
  const auth = (authArg === "A" || authArg === "B" || authArg === "C"
    ? authArg
    : "C") as AuthOption;
  const runs = Number(runsArg) || REQUIRED_PASSES;

  const summary = await runE2E01({ auth, runs });
  const outDir = join(import.meta.dir, "out");
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, `e2e-01-${auth}-${Date.now()}.json`);
  writeFileSync(outFile, JSON.stringify(summary, null, 2) + "\n");
  appendFileSync(
    join(outDir, "trail.jsonl"),
    JSON.stringify({ event: "e2e-01-summary", at: Date.now(), outFile, summary }) +
      "\n",
  );

  console.log(
    JSON.stringify(
      {
        label: summary.label,
        status: summary.consecutivePasses >= REQUIRED_PASSES ? "3x-pass" : "not-done",
        consecutivePasses: summary.consecutivePasses,
        requiredPasses: REQUIRED_PASSES,
        done: false,
        d3dMarkedDone: false,
        receipt: outFile,
        note: summary.note,
      },
      null,
      2,
    ),
  );

  if (summary.runs.some((r) => r.status === "blocked")) {
    process.exitCode = 2;
  } else if (summary.consecutivePasses < REQUIRED_PASSES) {
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  await main();
}
