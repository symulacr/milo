/**
 * P5: `api.ts` must name Convex functions the modules actually register.
 * `makeFunctionReference` accepts any string, so a typo only fails at runtime.
 * The modules also export plain handler helpers, so the check requires the
 * registration marker that only a Convex function carries.
 */
import { describe, expect, test } from "bun:test";
import { getFunctionName } from "convex/server";
import * as auth from "../../../convex/auth";
import * as chainObserver from "../../../convex/chainObserver";
import * as files from "../../../convex/files";
import * as orders from "../../../convex/orders";
import * as stripeProvisioning from "../../../convex/stripeProvisioning";
import * as trustedProvisioning from "../../../convex/trustedProvisioning";
import { api } from "./api";

const MODULES: Record<string, Record<string, unknown>> = {
  auth,
  chainObserver,
  files,
  orders,
  stripeProvisioning,
  trustedProvisioning,
};

const KINDS = ["isQuery", "isMutation", "isAction"] as const;

const registered = (value: unknown) => {
  const fn = value as Record<string, unknown> | undefined;
  return fn !== undefined && KINDS.some((kind) => fn[kind] === true);
};

describe("P5 every api reference names a registered Convex function", () => {
  for (const [key, reference] of Object.entries(api)) {
    test(`api.${key}`, () => {
      const name = getFunctionName(reference as never);
      const [moduleName, exportName] = name.split(":");
      const module = MODULES[moduleName];
      expect(module).toBeDefined();
      expect(registered(module[exportName])).toBe(true);
    });
  }
});
