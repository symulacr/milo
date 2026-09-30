import { describe, expect, test } from "bun:test";
import {
  ALLOWED_ORIGINS_ERROR,
  AUTH_FAILED_ERROR,
  decodeJwtClaims,
  NO_TEST_ACCOUNTS_ERROR,
  ownerGapBlocker,
  parseTestCredentials,
  redact,
  shortToken,
} from "./privy-test-login";

describe("Privy test-account helpers (D3b)", () => {
  test("parses empty and missing test_credentials like the node SDK", () => {
    expect(parseTestCredentials("")).toEqual([]);
    expect(parseTestCredentials("   ")).toEqual([]);
    expect(parseTestCredentials(null)).toEqual([]);
    expect(parseTestCredentials('{"data":[]}')).toEqual([]);
    expect(parseTestCredentials("{}")).toEqual([]);
  });

  test("parses dashboard test account shapes", () => {
    const fromData = parseTestCredentials(
      JSON.stringify({
        data: [
          {
            id: "ta_1",
            email: "test-1234@privy.io",
            phone_number: "+1 555 555 1234",
            otp_code: "123456",
          },
        ],
      }),
    );
    expect(fromData).toHaveLength(1);
    expect(fromData[0].email).toBe("test-1234@privy.io");
    expect(fromData[0].otp_code).toBe("123456");

    const bare = parseTestCredentials(
      JSON.stringify([
        {
          email: "test-9@privy.io",
          phone_number: "+1 555 555 0009",
          otp_code: "000009",
        },
      ]),
    );
    expect(bare).toHaveLength(1);
    expect(bare[0].phone_number).toBe("+1 555 555 0009");
  });

  test("decodes JWT claims without returning the token", () => {
    const payload = Buffer.from(
      JSON.stringify({
        iss: "privy.io",
        sub: "did:privy:test-user",
        aud: "cmtvmx5n-test",
        exp: 1_700_000_000,
        sid: "sess",
      }),
    ).toString("base64url");
    const claims = decodeJwtClaims(`hdr.${payload}.sig`);
    expect(claims?.iss).toBe("privy.io");
    expect(claims?.sub).toBe("did:privy:test-user");
    expect(claims?.aud).toBe("cmtvmx5n-test");
    expect(decodeJwtClaims("not-a-jwt")).toBeNull();
  });

  test("redacts secrets and truncates tokens for logs", () => {
    expect(
      redact("key=privy_secret_value_here", ["privy_secret_value_here"]),
    ).toBe("key=<redacted:secret>");
    expect(shortToken("short")).toBe("<token>");
    const long = shortToken("abcdefghijklmnopqrstuvwxyz");
    expect(long.startsWith("abcdefgh")).toBe(true);
    expect(long).toContain("len 26");
    expect(long.length).toBeLessThan(40);
  });

  test("owner gap carries the exact Privy error and dashboard action", () => {
    const gap = ownerGapBlocker({
      ok: false,
      code: "no_test_accounts",
      error: NO_TEST_ACCOUNTS_ERROR,
      detail: "empty body",
    });
    expect(gap).toContain(NO_TEST_ACCOUNTS_ERROR);
    expect(gap).toContain("Enable test accounts");
    expect(gap).toContain("OWNER GAP");
    expect(gap).toContain("production auth bypass");

    expect(ALLOWED_ORIGINS_ERROR).toContain("allowed origins");
    expect(AUTH_FAILED_ERROR).toContain("Unable to authenticate");
  });
});
