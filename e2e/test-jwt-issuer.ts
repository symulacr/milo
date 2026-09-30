/**
 * R7 option C — local test JWT issuer (LOCAL disposable Convex only).
 *
 * Purpose: unblock E2E-01 happy-path auth without Privy test accounts
 * (O-PRIVY-TEST owner gap). This module mints ES256 JWTs that a LOCAL
 * disposable Convex deployment can verify via a test JWKS, so the existing
 * `requirePrivySubject` identity shape (`iss: "privy.io"` + `sub: did:privy:…`)
 * is satisfied without contacting api.privy.io.
 *
 * Hard boundary — all must hold or minting refuses:
 *   1. `MILO_TEST_ISSUER=local-only` (exact value).
 *   2. Target Convex URL is loopback/local only (never *.convex.cloud).
 *   3. `NODE_ENV` is not `production`.
 *   4. Private key material never leaves this process and is never logged.
 *
 * This file is ONLY imported from `e2e/**`. It is not reachable from
 * `apps/web/src/public-main.tsx`, `apps/web/src/main.tsx`, `convex/**`, or any
 * production bundle. Boundary proofs live in `e2e/r7c-prod-boundary.test.ts`.
 *
 * Label every receipt produced through this path: `local-convex+test-issuer`.
 *
 * Proposed Convex auth.config.ts change (coordinator applies — this agent does
 * not edit convex/**): when MILO_TEST_ISSUER=local-only, append a second
 * customJwt provider whose `jwks` points at the local test JWKS server and
 * whose `issuer`/`algorithm` match the claims minted here. When the env gate
 * is unset, providers must remain Privy-only (api.privy.io).
 */

import {
  createPublicKey,
  createVerify,
  generateKeyPairSync,
  sign as cryptoSign,
  type KeyObject,
} from "node:crypto";
import { Buffer } from "node:buffer";

/** Env gate name and the only accepted value. */
export const MILO_TEST_ISSUER_ENV = "MILO_TEST_ISSUER";
export const MILO_TEST_ISSUER_VALUE = "local-only";

/** Claim shape required by packages/backend/src/privy-identity.ts. */
export const PRIVY_ISSUER = "privy.io";

/** Receipt / harness label for results produced via this issuer. */
export const RESULT_LABEL = "local-convex+test-issuer";

/** Kid registered in the local test JWKS. */
export const TEST_JWK_KID = "milo-local-test-issuer-1";

export type TestIssuerGateEnv = Record<string, string | undefined>;

export type MintSubject = {
  /** Must match `did:privy:<id>` (requirePrivySubject). */
  subject: string;
  /** Optional aud; defaults to a fixed local test application id. */
  applicationId?: string;
  /** Lifetime seconds; default 3600, max 86400. */
  ttlSeconds?: number;
};

export type MintedJwt = {
  token: string;
  label: typeof RESULT_LABEL;
  claims: { iss: string; sub: string; aud: string; iat: number; exp: number };
  /** Public JWK to register in the local Convex test JWKS. Never includes d. */
  publicJwk: Record<string, unknown>;
};

export type GateFailure =
  | "missing_or_wrong_env"
  | "production_node_env"
  | "non_local_convex_url"
  | "missing_convex_url"
  | "invalid_subject";

export type GateResult =
  | { ok: true; convexUrl: string | null }
  | { ok: false; code: GateFailure; reason: string };

const LOCAL_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "[::1]",
  "host.docker.internal",
]);

/**
 * True only for loopback / explicitly local hosts. Rejects every
 * `*.convex.cloud` and any other remote host. Used by the gate and by
 * boundary tests so the same predicate is what production absence proves
 * against.
 */
export function isLocalConvexUrl(raw: string | undefined | null): boolean {
  if (!raw) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  if (LOCAL_HOSTNAMES.has(host)) return true;
  // 127.0.0.0/8 and ::ffff:127.x
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^\[?::ffff:127\./.test(host)) return true;
  return false;
}

/**
 * Evaluate every hard boundary. Pure and synchronous so unit tests and the
 * harness share one gate. When `requireConvexUrl` is true, a missing URL
 * fails closed.
 */
export function evaluateTestIssuerGate(
  env: TestIssuerGateEnv,
  options: { convexUrl?: string | null; requireConvexUrl?: boolean } = {},
): GateResult {
  const gate = env[MILO_TEST_ISSUER_ENV];
  if (gate !== MILO_TEST_ISSUER_VALUE) {
    return {
      ok: false,
      code: "missing_or_wrong_env",
      reason: `Set ${MILO_TEST_ISSUER_ENV}=${MILO_TEST_ISSUER_VALUE} to enable the local test issuer. Found ${gate === undefined ? "unset" : JSON.stringify(gate)}.`,
    };
  }
  if (env.NODE_ENV === "production") {
    return {
      ok: false,
      code: "production_node_env",
      reason:
        "MILO_TEST_ISSUER is never honored when NODE_ENV=production (production bundles must not mint test JWTs).",
    };
  }
  const convexUrl = options.convexUrl ?? env.CONVEX_URL ?? null;
  if (options.requireConvexUrl && !convexUrl) {
    return {
      ok: false,
      code: "missing_convex_url",
      reason:
        "A target Convex URL is required so the issuer can refuse cloud deployments.",
    };
  }
  if (convexUrl && !isLocalConvexUrl(convexUrl)) {
    return {
      ok: false,
      code: "non_local_convex_url",
      reason: `Test issuer targets LOCAL disposable Convex only. Refused ${redactUrl(convexUrl)}. Use a loopback Convex backend (ports 3200-3299).`,
    };
  }
  return { ok: true, convexUrl };
}

/** Strip any userinfo from a URL before it can reach a log or error. */
export function redactUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return "<unparseable-url>";
  }
}

const SUBJECT_RE = /^did:privy:[a-zA-Z0-9_-]+$/;

export function isValidTestSubject(subject: string): boolean {
  return SUBJECT_RE.test(subject);
}

/**
 * In-process ES256 keypair. Ephemeral by default so every disposable local
 * Convex session has its own key; tests can inject a fixed pair for JWKS
 * stability within one run.
 */
export type TestIssuerKeys = {
  privateKey: KeyObject;
  publicKey: KeyObject;
};

export function generateTestIssuerKeys(): TestIssuerKeys {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "P-256",
  });
  return { privateKey, publicKey };
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function decodeB64UrlObject(raw: string): Record<string, unknown> {
  const pad = raw.length % 4 === 0 ? "" : "=".repeat(4 - (raw.length % 4));
  const text = Buffer.from(
    raw.replace(/-/g, "+").replace(/_/g, "/") + pad,
    "base64",
  ).toString("utf8");
  return JSON.parse(text) as Record<string, unknown>;
}

/** Public JWK only — never includes `d` (private exponent). */
export function publicJwkFromKeys(
  keys: TestIssuerKeys,
  kid = TEST_JWK_KID,
): Record<string, unknown> {
  const jwk = createPublicKey(keys.privateKey).export({
    format: "jwk",
  }) as Record<string, unknown>;
  return {
    kty: jwk.kty,
    crv: jwk.crv,
    x: jwk.x,
    y: jwk.y,
    kid,
    use: "sig",
    alg: "ES256",
  };
}

/** JWKS document for the local disposable Convex test provider. */
export function testJwksDocument(keys: TestIssuerKeys): {
  keys: Record<string, unknown>[];
} {
  return { keys: [publicJwkFromKeys(keys)] };
}

/**
 * Mint a test JWT. Throws if any hard boundary fails. The token is returned
 * to the caller (e2e harness / Convex client) and is never written to a log
 * by this module.
 */
export function mintTestJwt(
  keys: TestIssuerKeys,
  input: MintSubject,
  env: TestIssuerGateEnv = process.env,
  options: { convexUrl?: string | null; requireConvexUrl?: boolean } = {},
): MintedJwt {
  const gate = evaluateTestIssuerGate(env, {
    convexUrl: options.convexUrl,
    requireConvexUrl: options.requireConvexUrl ?? true,
  });
  if (!gate.ok) {
    throw new Error(`test-jwt-issuer gated: [${gate.code}] ${gate.reason}`);
  }
  if (!isValidTestSubject(input.subject)) {
    throw new Error(
      "test-jwt-issuer: subject must match did:privy:<id> so requirePrivySubject can accept the local identity.",
    );
  }
  const ttl = Math.min(Math.max(input.ttlSeconds ?? 3600, 60), 86400);
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + ttl;
  const aud = input.applicationId ?? "milo-local-test-app";
  const header = { alg: "ES256", typ: "JWT", kid: TEST_JWK_KID };
  const payload = { iss: PRIVY_ISSUER, sub: input.subject, aud, iat, exp };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = cryptoSign("sha256", Buffer.from(signingInput), {
    key: keys.privateKey,
    dsaEncoding: "ieee-p1363",
  });
  const token = `${signingInput}.${base64url(signature)}`;
  return {
    token,
    label: RESULT_LABEL,
    claims: payload,
    publicJwk: publicJwkFromKeys(keys),
  };
}

/**
 * Decode claims only (header + payload). Never returns the signature as a
 * reusable secret; used for assertions and for logging redacted claims.
 */
export function decodeTestJwtClaims(token: string): {
  header: Record<string, unknown>;
  claims: Record<string, unknown>;
} | null {
  const parts = String(token).split(".");
  if (parts.length !== 3) return null;
  try {
    return {
      header: decodeB64UrlObject(parts[0]),
      claims: decodeB64UrlObject(parts[1]),
    };
  } catch {
    return null;
  }
}

/**
 * Verify a minted token against the public key (local self-check). This is
 * not a substitute for Convex-hosted JWKS verification; it only proves the
 * issuer produced a well-formed ES256 JWT.
 */
export function verifyMintedJwtLocally(
  token: string,
  keys: TestIssuerKeys,
): boolean {
  const parts = String(token).split(".");
  if (parts.length !== 3) return false;
  try {
    const verify = createVerify("sha256");
    verify.update(`${parts[0]}.${parts[1]}`);
    verify.end();
    return verify.verify(
      { key: keys.publicKey, dsaEncoding: "ieee-p1363" },
      Buffer.from(
        parts[2].replace(/-/g, "+").replace(/_/g, "/"),
        "base64",
      ),
    );
  } catch {
    return false;
  }
}

/** Fixed subject factory for E2E-01 roles. */
export function testSubjectForRole(role: "buyer" | "merchant" | "operator"): string {
  return `did:privy:local-test-${role}`;
}

/**
 * Prop text for the coordinator: the exact auth.config.ts shape to apply.
 * This agent does not edit convex/auth.config.ts.
 */
export const PROPOSED_AUTH_CONFIG_SNIPPET = `
// PROPOSED (R7 option C) — coordinator applies to convex/auth.config.ts.
// Do NOT edit from the e2e agent. Keep Privy provider unchanged.
//
// When MILO_TEST_ISSUER=local-only AND the deployment is a LOCAL disposable
// Convex (never cloud dev, never production), append a second provider:
//
//   ...(process.env.MILO_TEST_ISSUER === "local-only"
//     ? [
//         {
//           type: "customJwt" as const,
//           issuer: "privy.io",
//           applicationID: process.env.PRIVY_APP_ID ?? "milo-local-test-app",
//           algorithm: "ES256" as const,
//           jwks: process.env.MILO_TEST_ISSUER_JWKS!, // e.g. http://127.0.0.1:3210/jwks.json
//         },
//       ]
//     : []),
//
// When MILO_TEST_ISSUER is unset, providers MUST remain Privy-only
// (jwks: https://api.privy.io/v1/apps/\${PRIVY_APP_ID}/jwks.json).
// Boundary tests assert the test provider string set is absent from the
// production config path (e2e/r7c-prod-boundary.test.ts).
`.trim();
