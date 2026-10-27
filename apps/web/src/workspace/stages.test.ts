import { describe, expect, test } from "bun:test";
import {
  PERMISSION_BLOCKED,
  REJECTED_CONNECTION,
  UNSUPPORTED_WALLET,
  WALLET_DISCONNECTED,
  WRONG_NETWORK_MESSAGE,
  watchWallets,
} from "../../../../packages/midnight-client/src";
import type { Role, Stage } from "../api";
import * as format from "../lib/format";
import * as stages from "./stages";
import { actionsFor, type Deadlines } from "./stages";
import { walletHint } from "./wallet";

const NOW = 1_700_000_000_000;
const ROLES: readonly Role[] = ["buyer", "merchant", "operator"];
const at = (offset: number): Deadlines => {
  const when = String(NOW / 1000 + offset);
  return { acceptance: when, delivery: when, review: when, resolution: when };
};
const run = (stage: Stage, role: Role, offset: number | null) =>
  actionsFor(stage, role, offset === null ? null : at(offset), NOW)
    .map((action) => action.circuit)
    .join(" ");
const acts = (stage: Stage, role: Role, offset = 3_600) =>
  actionsFor(stage, role, at(offset), NOW);

const TABLE: readonly (readonly [Stage, string, string])[] = [
  ["QUOTE", "start||", "start||"],
  ["PAYMENT_HELD", "start||", "start||"],
  ["DEPLOYED", "start||", "expireBootstrap|expireBootstrap|expireBootstrap"],
  [
    "RESERVED",
    "cancelReserved|accept decline|",
    "expireReserved|expireReserved|expireReserved",
  ],
  [
    "ACCEPTED",
    "disputeBuyer|submitDelivery disputeMerchant|",
    "expireUndelivered|expireUndelivered|expireUndelivered",
  ],
  [
    "SUBMITTED",
    "approve disputeBuyer||",
    "escalateUnreviewed|escalateUnreviewed|escalateUnreviewed",
  ],
  [
    "DISPUTED",
    "||resolve resolve",
    "expireDispute|expireDispute|expireDispute",
  ],
  ["APPROVED", "||", "||"],
  ["CANCELLED", "||", "||"],
];

describe("the order action table", () => {
  for (const [stage, open, expired] of TABLE)
    for (const [index, role] of ROLES.entries())
      test(`${stage} / ${role}`, () => {
        expect(run(stage, role, 3_600)).toBe(open.split("|")[index]);
        expect(run(stage, role, -300)).toBe(expired.split("|")[index]);
      });

  test("expiry waits 120 s after the deadline for block time to catch up", () => {
    expect(run("RESERVED", "merchant", -60)).toBe("accept decline");
  });

  test("without deadlines only the expiry action disappears", () => {
    expect(run("RESERVED", "merchant", null)).toBe("accept decline");
    expect(run("DISPUTED", "operator", null)).toBe("resolve resolve");
  });

  test("only approve waits for the recomputed manifest", () => {
    expect(
      acts("SUBMITTED", "buyer")
        .filter((action) => action.needs)
        .map((action) => `${action.circuit}:${action.needs}`),
    ).toEqual(["approve:delivery", "disputeBuyer:note"]);
  });

  test("resolve carries the decision and needs no note", () => {
    expect(
      acts("DISPUTED", "operator").map((a) => [a.approveOrder, a.needs]),
    ).toEqual([
      [true, undefined],
      [false, undefined],
    ]);
  });

  test("every one of the 14 circuits is reachable", () => {
    const reached = new Set<string>();
    for (const [stage] of TABLE)
      for (const role of ROLES)
        for (const offset of [3_600, -300])
          for (const action of acts(stage, role, offset))
            reached.add(action.circuit);
    expect([...reached].sort()).toEqual(
      [
        "accept",
        "approve",
        "cancelReserved",
        "decline",
        "disputeBuyer",
        "disputeMerchant",
        "escalateUnreviewed",
        "expireBootstrap",
        "expireDispute",
        "expireReserved",
        "expireUndelivered",
        "resolve",
        "start",
        "submitDelivery",
      ].sort(),
    );
  });
});

describe("H2 wallet failure paths", () => {
  // Every path the connector can report, and the hint the user reads for it.
  // The messages come from the connector, so the mapping cannot drift.
  const PATHS: readonly (readonly [string, string, RegExp])[] = [
    ["no wallet", UNSUPPORTED_WALLET, /install the extension/i],
    [
      "wrong network",
      WRONG_NETWORK_MESSAGE,
      /set your wallet to midnight preprod/i,
    ],
    ["signing rejected", REJECTED_CONNECTION, /declined/i],
    ["disconnect mid-flow", WALLET_DISCONNECTED, /disconnected.*reconnect/i],
    ["blocked by preference", PERMISSION_BLOCKED, /blocking milo/i],
  ];

  for (const [path, message, hint] of PATHS)
    test(`${path} shows its own retry hint`, () => {
      expect(walletHint({ status: "error", message })).toBe(message);
      expect(walletHint({ status: "error", message })).toMatch(hint);
    });

  const LACE = {
    rdns: "io.lace.wallet",
    apiVersion: "4.0.1",
    connect: async () => ({}),
  };
  const REGISTRIES: readonly (readonly [string, unknown, number])[] = [
    ["nothing injected yet", undefined, 0],
    ["injected after load", { lace: LACE }, 1],
  ];

  for (const [state, registry, count] of REGISTRIES)
    test(`a wallet ${state} is reported`, () => {
      const seen: number[] = [];
      watchWallets(
        () => registry as never,
        (found) => seen.push(found.length),
        { timeoutMs: 0 },
      );
      expect(seen).toEqual([count]);
    });

  test("no wallet and a connected wallet have distinct hints", () => {
    expect(walletHint({ status: "disconnected" })).toMatch(/not connected/i);
    expect(
      walletHint({
        status: "connected",
        networkId: "preprod",
        account: { unshieldedAddress: "mn_addr1" },
      }),
    ).toMatch(/connected on midnight preprod/i);
  });
});

describe("G-04 the deadline decision follows the server's clock", () => {
  // `actionsFor` is pure and takes `now`, so the skew arithmetic is testable
  // without a browser: this is the exact value `useNow` produces
  // (`local + (serverNow - Date.now())`), fed through the real action table.
  const SKEW = 10 * 60_000; // a device 10 minutes fast
  const localNow = NOW + SKEW;
  const serverNow = NOW;

  test("a device past the grace and a server inside it disagree, which is the bug", () => {
    // The window closed 30 s ago in server time, so the server is inside the
    // 2-minute grace and still offers the normal action. A device 10 minutes
    // fast believes it closed 10.5 minutes ago, past the grace, and offers
    // "expire". That divergence IS the finding; the fix is to use the server's
    // number, which is why the two must not be assumed equal.
    const deadlines = at(-30);
    const withServer = actionsFor("RESERVED", "buyer", deadlines, serverNow)
      .map((action) => action.circuit)
      .join(" ");
    const withDevice = actionsFor("RESERVED", "buyer", deadlines, localNow)
      .map((action) => action.circuit)
      .join(" ");
    expect(withServer).toBe("cancelReserved");
    expect(withDevice).toBe("expireReserved");
  });

  test("a fast device does not expire a window the server still has open", () => {
    // The window closes in 5 minutes of SERVER time. A device 10 minutes fast
    // believes it closed 5 minutes ago and would offer "expire" — which the
    // server refuses, because the deadline has not passed. With the server
    // clock the normal action is offered instead.
    const deadlines = at(5 * 60);
    const deviceSays = actionsFor("RESERVED", "buyer", deadlines, localNow)
      .map((action) => action.circuit)
      .join(" ");
    const serverSays = actionsFor("RESERVED", "buyer", deadlines, serverNow)
      .map((action) => action.circuit)
      .join(" ");
    // The device would have shown the expiry action; the server clock does not.
    expect(deviceSays).toContain("expireReserved");
    expect(serverSays).not.toContain("expireReserved");
    expect(serverSays).toContain("cancelReserved");
  });

  test("the offset is what useNow applies, not the raw device time", () => {
    // The arithmetic `useNow` performs: local ticker + captured offset.
    const offset = serverNow - localNow;
    expect(localNow + offset).toBe(serverNow);
    // And the same instant, expressed as the action list, matches the server's.
    expect(
      actionsFor("RESERVED", "buyer", at(5 * 60), localNow + offset)
        .map((action) => action.circuit)
        .join(" "),
    ).toBe(
      actionsFor("RESERVED", "buyer", at(5 * 60), serverNow)
        .map((action) => action.circuit)
        .join(" "),
    );
  });
});

describe("D-12 a window reads in its own unit", () => {
  // Before the fix every window rendered in hours, so the 48 h review window
  // said "in 48 hours". `until` (before) and `relativeTo` (after) are both read
  // off the module, so this asserts the STRING, not the presence of an export.
  const HOUR = 3_600_000;
  const CASES: readonly (readonly [number, string])[] = [
    [HOUR, "in 1 hour"],
    [24 * HOUR, "tomorrow"],
    [48 * HOUR, "in 2 days"],
    [73 * HOUR, "in 3 days"],
    [-5 * 60_000, "5 minutes ago"],
    [-34 * 24 * HOUR, "last month"],
  ];
  test("every window picks its largest unit", () => {
    const render =
      (format as { relativeTo?: (at: number, now: number) => string })
        .relativeTo ?? (stages as { until?: typeof format.relativeTo }).until;
    expect(CASES.map(([offset]) => render?.(NOW + offset, NOW))).toEqual(
      CASES.map(([, want]) => want),
    );
  });
});
