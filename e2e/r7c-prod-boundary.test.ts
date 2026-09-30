/**
 * R7 option C boundary proofs — the local test JWT issuer is absent from
 * production config and production bundles. Extends the demo-boundary /
 * sdk-connector-prod-boundary style (source-graph reachability + string
 * markers + optional dist/ scan).
 *
 * Labels results path `local-convex+test-issuer`.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluateTestIssuerGate,
  isLocalConvexUrl,
  isValidTestSubject,
  MILO_TEST_ISSUER_ENV,
  MILO_TEST_ISSUER_VALUE,
  generateTestIssuerKeys,
  mintTestJwt,
  decodeTestJwtClaims,
  verifyMintedJwtLocally,
  publicJwkFromKeys,
  testJwksDocument,
  testSubjectForRole,
  RESULT_LABEL,
  PRIVY_ISSUER,
  PROPOSED_AUTH_CONFIG_SNIPPET,
  redactUrl,
} from "./test-jwt-issuer";

const E2E_DIR = dirname(fileURLToPath(import.meta.url));
const REPO = join(E2E_DIR, "..");
const WEB_SRC = join(REPO, "apps", "web", "src");
const AUTH_CONFIG = join(REPO, "convex", "auth.config.ts");
const DIST = join(REPO, "dist");

/** Identifiers that must never appear in production config or bundles. */
const TEST_ISSUER_MARKERS = [
  "MILO_TEST_ISSUER",
  "milo-local-test-issuer",
  "milo-local-test-app",
  "test-jwt-issuer",
  "local-convex+test-issuer",
  "MiloTestIssuer",
  "mintTestJwt",
];

function readIfExists(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

function walkFiles(root: string, out: string[] = []): string[] {
  if (!existsSync(root)) return out;
  for (const entry of readdirSync(root)) {
    const full = join(root, entry);
    const st = statSync(full);
    if (st.isDirectory()) walkFiles(full, out);
    else out.push(full);
  }
  return out;
}

/** Source-graph reachability from an entry (same approach as demo-boundary). */
function reachableSources(entry: string): string[] {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop();
    if (!file || seen.has(file)) continue;
    seen.add(file);
    if (!existsSync(file)) continue;
    const source = readFileSync(file, "utf8");
    const localRefs = [
      ...source.matchAll(/from "(\.[^"]+)"/g),
      ...source.matchAll(/import\(\s*"(\.[^"]+)"\s*\)/g),
      ...source.matchAll(/^import\s+"(\.[^"]+)";?$/gm),
    ];
    for (const match of localRefs) {
      const base = new URL(`${match[1]}`, `file://${file}`).pathname;
      for (const candidate of [
        `${base}.tsx`,
        `${base}.ts`,
        `${base}/index.tsx`,
        `${base}/index.ts`,
        `${base}.mjs`,
        `${base}.js`,
      ]) {
        if (existsSync(candidate)) {
          queue.push(candidate);
          break;
        }
      }
    }
  }
  return [...seen];
}

describe("R7C gate — local-only hard boundaries", () => {
  test("refuses when MILO_TEST_ISSUER is unset or wrong", () => {
    for (const env of [{}, { MILO_TEST_ISSUER: "prod" }, { MILO_TEST_ISSUER: "1" }]) {
      const result = evaluateTestIssuerGate(env, {
        convexUrl: "http://127.0.0.1:3210",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("missing_or_wrong_env");
    }
  });

  test("refuses NODE_ENV=production even with the gate set", () => {
    const result = evaluateTestIssuerGate(
      { MILO_TEST_ISSUER: MILO_TEST_ISSUER_VALUE, NODE_ENV: "production" },
      { convexUrl: "http://127.0.0.1:3210" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("production_node_env");
  });

  test("refuses cloud and remote Convex URLs", () => {
    for (const url of [
      "https://happy-animal-123.convex.cloud",
      "https://convex.cloud",
      "https://example.com",
      "http://10.0.0.5:3210",
    ]) {
      const result = evaluateTestIssuerGate(
        { MILO_TEST_ISSUER: MILO_TEST_ISSUER_VALUE },
        { convexUrl: url },
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("non_local_convex_url");
    }
  });

  test("accepts loopback Convex URLs on the 3200-3299 band", () => {
    for (const url of [
      "http://127.0.0.1:3200",
      "http://127.0.0.1:3299",
      "http://localhost:3210",
      "http://[::1]:3210",
    ]) {
      expect(isLocalConvexUrl(url)).toBe(true);
      const result = evaluateTestIssuerGate(
        { MILO_TEST_ISSUER: MILO_TEST_ISSUER_VALUE },
        { convexUrl: url },
      );
      expect(result.ok).toBe(true);
    }
  });

  test("fails closed when a Convex URL is required but missing", () => {
    const result = evaluateTestIssuerGate(
      { MILO_TEST_ISSUER: MILO_TEST_ISSUER_VALUE },
      { requireConvexUrl: true },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("missing_convex_url");
  });

  test("subject must match did:privy:<id> for requirePrivySubject", () => {
    expect(isValidTestSubject("did:privy:local-test-buyer")).toBe(true);
    expect(isValidTestSubject("did:privy:abc-123")).toBe(true);
    expect(isValidTestSubject("user_1")).toBe(false);
    expect(isValidTestSubject("did:privy:")).toBe(false);
    expect(isValidTestSubject("did:other:x")).toBe(false);
  });
});

describe("R7C mint — ES256 JWT under the gate", () => {
  const keys = generateTestIssuerKeys();
  const gateEnv = {
    MILO_TEST_ISSUER: MILO_TEST_ISSUER_VALUE,
    NODE_ENV: "test",
    CONVEX_URL: "http://127.0.0.1:3210",
  };

  test("mints a verifiable ES256 JWT with Privy-shaped claims", () => {
    const minted = mintTestJwt(
      keys,
      { subject: testSubjectForRole("buyer") },
      gateEnv,
      { convexUrl: "http://127.0.0.1:3210" },
    );
    expect(minted.label).toBe(RESULT_LABEL);
    expect(minted.claims.iss).toBe(PRIVY_ISSUER);
    expect(minted.claims.sub).toBe("did:privy:local-test-buyer");
    expect(verifyMintedJwtLocally(minted.token, keys)).toBe(true);

    const decoded = decodeTestJwtClaims(minted.token);
    expect(decoded?.header.alg).toBe("ES256");
    expect(decoded?.header.kid).toBe("milo-local-test-issuer-1");
    expect(decoded?.claims.sub).toBe("did:privy:local-test-buyer");
    expect(decoded?.claims.iss).toBe("privy.io");
  });

  test("mint refuses without the env gate", () => {
    expect(() =>
      mintTestJwt(keys, { subject: testSubjectForRole("buyer") }, {}, {
        convexUrl: "http://127.0.0.1:3210",
      }),
    ).toThrow(/gated/);
  });

  test("mint refuses cloud Convex target", () => {
    expect(() =>
      mintTestJwt(
        keys,
        { subject: testSubjectForRole("buyer") },
        { MILO_TEST_ISSUER: MILO_TEST_ISSUER_VALUE },
        { convexUrl: "https://prod.convex.cloud" },
      ),
    ).toThrow(/LOCAL disposable Convex/);
  });

  test("public JWK never carries private material", () => {
    const jwk = publicJwkFromKeys(keys) as Record<string, unknown>;
    expect(jwk.d).toBeUndefined();
    expect(jwk.kty).toBe("EC");
    expect(jwk.crv).toBe("P-256");
    expect(jwk.alg).toBe("ES256");
    const doc = testJwksDocument(keys);
    expect(doc.keys).toHaveLength(1);
    expect(doc.keys[0].d).toBeUndefined();
  });

  test("redactUrl strips userinfo before any log use", () => {
    expect(redactUrl("http://user:secret@127.0.0.1:3210")).not.toContain(
      "secret",
    );
    expect(redactUrl("https://x.convex.cloud")).toContain("convex.cloud");
    expect(redactUrl("not a url")).toBe("<unparseable-url>");
  });
});

describe("R7C production config boundary", () => {
  test("convex/auth.config.ts exists and is Privy-only without the gate", () => {
    const source = readIfExists(AUTH_CONFIG);
    expect(source).not.toBeNull();
    expect(source).toContain("privy.io");
    expect(source).toContain("api.privy.io");
    // Production path must not reference the test issuer gate or local JWKS.
    expect(source).not.toContain("MILO_TEST_ISSUER");
    expect(source).not.toContain("milo-local-test");
    expect(source).not.toContain("127.0.0.1");
    expect(source).not.toContain("test-jwt-issuer");
  });

  test("proposed snippet documents the coordinator-only patch", () => {
    expect(PROPOSED_AUTH_CONFIG_SNIPPET).toContain("MILO_TEST_ISSUER");
    expect(PROPOSED_AUTH_CONFIG_SNIPPET).toContain("customJwt");
    expect(PROPOSED_AUTH_CONFIG_SNIPPET).toContain("local-only");
    // The snippet is documentation for the coordinator, not wired code.
    expect(PROPOSED_AUTH_CONFIG_SNIPPET).toContain("coordinator");
  });

  test("requirePrivySubject identity contract is documented by the issuer", () => {
    // privy-identity.ts still requires iss=privy.io + did:privy: sub.
    const privyIdentity = readIfExists(
      join(REPO, "packages", "backend", "src", "privy-identity.ts"),
    );
    expect(privyIdentity).toContain('issuer !== "privy.io"');
    expect(privyIdentity).toContain("did:privy:");
  });
});

describe("R7C production bundle boundary", () => {
  test("workspace and public entries never reach the test issuer", () => {
    for (const entry of ["main.tsx", "public-main.tsx"]) {
      const graph = reachableSources(join(WEB_SRC, entry));
      const offenders = graph.filter((path) =>
        /test-jwt-issuer|e2e\//.test(path),
      );
      expect(offenders).toEqual([]);
      const names = graph.map((p) => p.split("/").pop() ?? "");
      expect(names).not.toContain("test-jwt-issuer.ts");
    }
  });

  test("no apps/web source imports the test issuer", () => {
    const webFiles = walkFiles(WEB_SRC).filter((p) => /\.tsx?$/.test(p));
    for (const file of webFiles) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(/from\s+["'].*test-jwt-issuer["']/);
      expect(source).not.toContain("mintTestJwt");
      expect(source).not.toContain("MILO_TEST_ISSUER");
    }
  });

  test("no convex/** source imports the test issuer", () => {
    const convexFiles = walkFiles(join(REPO, "convex")).filter((p) =>
      /\.tsx?$/.test(p),
    );
    for (const file of convexFiles) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(/from\s+["'].*test-jwt-issuer["']/);
      expect(source).not.toContain("mintTestJwt");
    }
  });

  test("production dist/ (when present) carries no test-issuer markers", () => {
    if (!existsSync(DIST)) {
      // Bundle not built in this worktree — source-graph proof above still holds.
      expect(existsSync(DIST)).toBe(false);
      return;
    }
    const bundles = walkFiles(DIST).filter((p) => /\.(js|mjs|html|json)$/.test(p));
    expect(bundles.length).toBeGreaterThan(0);
    for (const file of bundles) {
      const source = readFileSync(file, "utf8");
      for (const marker of TEST_ISSUER_MARKERS) {
        if (marker === "test-jwt-issuer" && !file.endsWith(".js") && !file.endsWith(".mjs")) {
          // HTML/JSON may mention docs; only enforce on JS bundles for path-like markers.
          continue;
        }
        expect(source).not.toContain(marker);
      }
    }
  });

  test("build entrypoints do not list the test issuer", () => {
    const build = readIfExists(join(REPO, "scripts", "build.ts"));
    expect(build).not.toBeNull();
    expect(build).not.toContain("test-jwt-issuer");
    expect(build).not.toContain("e2e/");
  });
});
