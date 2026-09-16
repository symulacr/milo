import { describe, expect, mock, test } from "bun:test";
import {
  backendSessionStatus,
  fetchPrivyAccessToken,
} from "./convex-session-runtime";

describe("Privy token adapter", () => {
  test("calls the SDK on each request without caching or invented refresh arguments", async () => {
    const getAccessToken = mock(async () => "test-token");
    expect(await fetchPrivyAccessToken(getAccessToken)).toBe("test-token");
    await fetchPrivyAccessToken(getAccessToken);
    expect(getAccessToken).toHaveBeenCalledTimes(2);
    expect(getAccessToken).toHaveBeenCalledWith();
  });
  test("missing tokens and provider failures fail closed", async () => {
    expect(await fetchPrivyAccessToken(async () => null)).toBeNull();
    expect(
      await fetchPrivyAccessToken(async () => {
        throw new Error("private provider detail");
      }),
    ).toBeNull();
  });
});

describe("backend verification presentation", () => {
  const result = { subject: "did:privy:synthetic-user" };
  test("a rejected token being refreshed cannot verify a cached session", () => {
    expect(
      backendSessionStatus(true, false, true, result, result.subject, true)
        .verified,
    ).toBe(false);
    expect(
      backendSessionStatus(true, false, true, result, result.subject, false)
        .verified,
    ).toBe(true);
  });
  test("only a successful session query after backend authentication is verified", () => {
    const status = backendSessionStatus(
      true,
      false,
      true,
      result,
      result.subject,
    );
    expect(status.verified).toBe(true);
    expect(status.message).toContain("Backend token verified");
    expect(status.message).not.toContain(result.subject);
  });
  test("sign-in, loading, and token acceptance alone are not query success", () => {
    for (const status of [
      backendSessionStatus(false, false, false, result, result.subject),
      backendSessionStatus(true, true, false, result, result.subject),
      backendSessionStatus(true, false, false, result, result.subject),
      backendSessionStatus(true, false, true, undefined, result.subject),
    ])
      expect(status.verified).toBe(false);
  });
  test("malformed results and query errors never leak details or show success", () => {
    for (const value of [
      null,
      {},
      { subject: "invalid" },
      { subject: 123 },
      new Error("private provider detail"),
    ]) {
      const status = backendSessionStatus(
        true,
        false,
        true,
        value,
        result.subject,
      );
      expect(status.verified).toBe(false);
      expect(status.message).not.toContain("private provider detail");
    }
  });
  test("a cached previous identity cannot verify the current identity", () => {
    const nextSubject = "did:privy:another-synthetic-user";
    const stale = backendSessionStatus(true, false, true, result, nextSubject);
    expect(stale.verified).toBe(false);
    expect(stale.message).not.toContain(result.subject);
    expect(stale.message).not.toContain(nextSubject);
    expect(
      backendSessionStatus(true, false, true, undefined, nextSubject).verified,
    ).toBe(false);
    expect(
      backendSessionStatus(
        true,
        false,
        true,
        { subject: nextSubject },
        nextSubject,
      ).verified,
    ).toBe(true);
  });
  test("missing or malformed current identity cannot verify a cached result", () => {
    for (const subject of [undefined, "", "invalid"])
      expect(
        backendSessionStatus(true, false, true, result, subject).verified,
      ).toBe(false);
  });
});
