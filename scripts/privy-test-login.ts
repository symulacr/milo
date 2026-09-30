/**
 * Privy test-account login probe (TODO D3b).
 *
 * Primary sources (see audit/discovery/RESEARCH-LOG.md):
 * - https://docs.privy.io/recipes/using-test-accounts
 * - https://docs.privy.io/recipes/mock-jwt
 * - https://docs.privy.io/api-reference/introduction
 *
 * Scope: enable automated login ONLY through Privy's own test accounts
 * (dashboard-gated hardcoded email/phone + OTP). This script never forges
 * production JWTs, never bypasses Privy JWKS, and never stores app secrets.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");

/** Mirrors Privy `apps().getTestAccessToken` error text (node SDK). */
export const NO_TEST_ACCOUNTS_ERROR =
  "No test accounts found for this app. Create test accounts in the Privy dashboard.";
/** Mirrors Privy node SDK when passwordless authenticate returns no token. */
export const AUTH_FAILED_ERROR =
  "Unable to authenticate with the test account.";
/** Documented getTestAccessToken restriction (docs.privy.io/recipes/using-test-accounts). */
export const ALLOWED_ORIGINS_ERROR =
  "getTestAccessToken is unavailable while allowed origins or a base domain are enabled for the Privy app.";

export type PrivyTestAccount = {
  id?: string;
  email: string;
  phone_number: string;
  otp_code: string;
};

export type JwtClaims = {
  iss?: string;
  sub?: string;
  aud?: string | string[];
  exp?: number;
  iat?: number;
  sid?: string;
};

function loadEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2];
  }
  return out;
}

export function loadPrivyAppEnv(
  env: Record<string, string | undefined> = process.env,
): { appId: string; appSecret: string } {
  const fileEnv = loadEnvFile(resolve(REPO, ".env.local"));
  const appId = (env.PRIVY_APP_ID ?? fileEnv.PRIVY_APP_ID ?? "").trim();
  const appSecret = (
    env.PRIVY_APP_SECRET ??
    fileEnv.PRIVY_APP_SECRET ??
    ""
  ).trim();
  return { appId, appSecret };
}

/** Replace secret material before anything is printed. */
export function redact(text: string, secrets: string[]): string {
  let s = String(text);
  for (const secret of secrets) {
    if (secret && secret.length >= 8)
      s = s.split(secret).join("<redacted:secret>");
  }
  return s;
}

/**
 * Privy `GET /v1/apps/{id}/test_credentials` returns either empty body (none)
 * or `{ data: TestAccount[] }` (go-sdk / node SDK shapes).
 */
export function parseTestCredentials(
  raw: string | null | undefined,
): PrivyTestAccount[] {
  if (!raw) return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return [];
  }
  if (Array.isArray(parsed)) {
    return parsed.filter(
      (row): row is PrivyTestAccount => !!row && typeof row === "object",
    );
  }
  if (
    parsed &&
    typeof parsed === "object" &&
    Array.isArray((parsed as { data?: unknown }).data)
  ) {
    return (parsed as { data: unknown[] }).data.filter(
      (row): row is PrivyTestAccount => !!row && typeof row === "object",
    );
  }
  return [];
}

/** Decode JWT payload claims only. Never returns the raw token. */
export function decodeJwtClaims(token: string): JwtClaims | null {
  const parts = String(token).split(".");
  if (parts.length < 2) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
    return JSON.parse(
      Buffer.from(b64 + pad, "base64").toString("utf8"),
    ) as JwtClaims;
  } catch {
    return null;
  }
}

/** Truncate token for logs: enough to correlate, not enough to reuse. */
export function shortToken(token: string): string {
  const t = String(token);
  return t.length <= 16
    ? "<token>"
    : `${t.slice(0, 8)}…${t.slice(-4)} (len ${t.length})`;
}

export type ProbeResult =
  | { ok: true; accounts: PrivyTestAccount[]; allowedDomains: string[] }
  | {
      ok: false;
      code:
        | "missing_config"
        | "no_test_accounts"
        | "allowed_origins"
        | "http_error"
        | "auth_failed";
      error: string;
      detail?: string;
    };

function basicAuth(appId: string, appSecret: string): string {
  return Buffer.from(`${appId}:${appSecret}`, "utf8").toString("base64");
}

async function privyGet(
  path: string,
  appId: string,
  appSecret: string,
): Promise<{ status: number; body: string }> {
  const res = await fetch(`https://api.privy.io${path}`, {
    method: "GET",
    headers: {
      Authorization: `Basic ${basicAuth(appId, appSecret)}`,
      "privy-app-id": appId,
      Accept: "application/json",
      "User-Agent": "milo-d3b-privy-test-login/1.0",
    },
  });
  return { status: res.status, body: await res.text() };
}

async function privyPost(
  path: string,
  appId: string,
  appSecret: string,
  body: unknown,
): Promise<{ status: number; body: string }> {
  const res = await fetch(`https://api.privy.io${path}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth(appId, appSecret)}`,
      "privy-app-id": appId,
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "milo-d3b-privy-test-login/1.0",
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.text() };
}

/**
 * Fetch test credentials + app settings. Implements the documented
 * getTestAccessToken preconditions without contacting production auth.
 */
export async function probeTestAccounts(
  appId: string,
  appSecret: string,
): Promise<ProbeResult> {
  if (!appId || !appSecret) {
    return {
      ok: false,
      code: "missing_config",
      error:
        "Set PRIVY_APP_ID and PRIVY_APP_SECRET (owner app id + secret in .env.local).",
    };
  }

  const settings = await privyGet(
    `/v1/apps/${encodeURIComponent(appId)}`,
    appId,
    appSecret,
  );
  if (settings.status !== 200) {
    return {
      ok: false,
      code: "http_error",
      error: `Privy app settings HTTP ${settings.status}`,
      detail: settings.body.slice(0, 300),
    };
  }
  let allowedDomains: string[] = [];
  try {
    const app = JSON.parse(settings.body) as { allowed_domains?: unknown };
    if (Array.isArray(app.allowed_domains)) {
      allowedDomains = app.allowed_domains.filter(
        (d): d is string => typeof d === "string",
      );
    }
  } catch {
    // keep []
  }

  const creds = await privyGet(
    `/v1/apps/${encodeURIComponent(appId)}/test_credentials`,
    appId,
    appSecret,
  );
  if (creds.status !== 200) {
    return {
      ok: false,
      code: "http_error",
      error: `Privy test_credentials HTTP ${creds.status}`,
      detail: creds.body.slice(0, 300),
    };
  }
  const accounts = parseTestCredentials(creds.body);
  if (accounts.length === 0) {
    return {
      ok: false,
      code: "no_test_accounts",
      error: NO_TEST_ACCOUNTS_ERROR,
      detail:
        "GET /v1/apps/{id}/test_credentials returned HTTP 200 with an empty body. Dashboard path: User management → Authentication → Advanced → Enable test accounts.",
    };
  }
  if (allowedDomains.length > 0) {
    return {
      ok: false,
      code: "allowed_origins",
      error: ALLOWED_ORIGINS_ERROR,
      detail: `allowed_domains=${JSON.stringify(allowedDomains)}`,
    };
  }
  return { ok: true, accounts, allowedDomains };
}

/**
 * Mirror of Privy node SDK `privy.apps().getTestAccessToken()`.
 * Uses the hardcoded dashboard OTP — no mailbox access, no production bypass.
 */
export async function getTestAccessToken(
  appId: string,
  appSecret: string,
  pick?: { email?: string; phone_number?: string },
): Promise<{ access_token: string; account: PrivyTestAccount }> {
  const probe = await probeTestAccounts(appId, appSecret);
  if (probe.ok !== true) throw new Error(probe.error);

  let account: PrivyTestAccount | undefined;
  if (pick?.email) {
    account = probe.accounts.find((a) => a.email === pick.email);
    if (!account) {
      throw new Error(
        `No test account found with email "${pick.email}". Available: ${probe.accounts
          .map((a) => a.email)
          .join(", ")}`,
      );
    }
  } else if (pick?.phone_number) {
    account = probe.accounts.find((a) => a.phone_number === pick.phone_number);
    if (!account) {
      throw new Error(
        `No test account found with phone number "${pick.phone_number}". Available: ${probe.accounts
          .map((a) => a.phone_number)
          .join(", ")}`,
      );
    }
  } else {
    account = probe.accounts[0];
  }
  if (!account) throw new Error(NO_TEST_ACCOUNTS_ERROR);

  const auth = await privyPost(
    "/v1/passwordless/authenticate",
    appId,
    appSecret,
    { email: account.email, code: account.otp_code },
  );
  if (auth.status !== 200) {
    throw new Error(
      `${AUTH_FAILED_ERROR} (HTTP ${auth.status}: ${auth.body.slice(0, 200)})`,
    );
  }
  let token = "";
  try {
    const parsed = JSON.parse(auth.body) as {
      token?: string;
      access_token?: string;
    };
    token = parsed.token ?? parsed.access_token ?? "";
  } catch {
    token = "";
  }
  if (!token) throw new Error(AUTH_FAILED_ERROR);
  return { access_token: token, account };
}

/** M8-style acceptance gap when automation cannot proceed. */
export function ownerGapBlocker(
  probe: Exclude<ProbeResult, { ok: true }>,
): string {
  return [
    "OWNER GAP (M8-style acceptance)",
    `error: ${probe.error}`,
    probe.detail ? `detail: ${probe.detail}` : "",
    "owner action: Privy Dashboard → User management → Authentication → Advanced → Enable test accounts",
    "owner action: copy the generated test-XXXX@privy.io + OTP (or +1 555 555 XXXX) into CI/env as PRIVY_TEST_EMAIL / PRIVY_TEST_OTP",
    "owner action: keep allowed origins / base domain unset while using getTestAccessToken, or drive the email OTP UI path with the same test credentials",
    "not done without that: signed-in click map (D3b→D3d), authenticated Convex session, E2E-01",
    "forbidden workaround: forging Privy JWTs for Convex customJwt (JWKS is live api.privy.io — production auth bypass)",
  ]
    .filter(Boolean)
    .join("\n");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const mode = args.includes("--login") ? "login" : "status";
  const { appId, appSecret } = loadPrivyAppEnv();
  const secrets = [appSecret];

  if (!appId || !appSecret) {
    console.error(
      redact(
        "missing_config: Set PRIVY_APP_ID and PRIVY_APP_SECRET in .env.local (owner paste).",
        secrets,
      ),
    );
    process.exitCode = 1;
    return;
  }

  const probe = await probeTestAccounts(appId, appSecret);
  if (probe.ok !== true) {
    console.log(
      redact(`mode=${mode} status=blocked code=${probe.code}`, secrets),
    );
    console.log(redact(ownerGapBlocker(probe), secrets));
    process.exitCode = probe.code === "missing_config" ? 1 : 2;
    return;
  }

  console.log(
    redact(
      `mode=${mode} status=test-accounts-present count=${probe.accounts.length} allowed_domains=${JSON.stringify(probe.allowedDomains)}`,
      secrets,
    ),
  );
  for (const account of probe.accounts) {
    console.log(
      redact(
        `account email=${account.email} phone=${account.phone_number} otp=<redacted:otp> id=${account.id ?? "—"}`,
        secrets,
      ),
    );
  }

  if (mode !== "login") {
    console.log(
      "next: run with --login to mint a test access token via hardcoded dashboard OTP",
    );
    return;
  }

  try {
    const { access_token, account } = await getTestAccessToken(
      appId,
      appSecret,
      {
        email: process.env.PRIVY_TEST_EMAIL || undefined,
        phone_number: process.env.PRIVY_TEST_PHONE || undefined,
      },
    );
    const claims = decodeJwtClaims(access_token);
    console.log(
      redact(
        `login=ok account=${account.email} token=${shortToken(access_token)}`,
        secrets,
      ),
    );
    console.log(
      redact(
        `claims iss=${claims?.iss ?? "?"} sub=${claims?.sub ?? "?"} aud=${JSON.stringify(claims?.aud ?? null)} exp=${claims?.exp ?? "?"}`,
        secrets,
      ),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(
      redact(`login=failed code=auth_failed error=${message}`, secrets),
    );
    process.exitCode = 3;
  }
}

if (import.meta.main) {
  await main();
}
