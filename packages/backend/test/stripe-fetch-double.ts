/**
 * Stripe test-mode provider double for the server modules that construct the
 * real SDK client themselves (stripe-observer.server.ts observeTestPayment,
 * stripe-customer-provisioning.server.ts). The Stripe SDK under Bun resolves
 * its `bun` export condition to the fetch HTTP client, so intercepting
 * globalThis.fetch drives the real client, its real request URLs and its real
 * response parsing with no network and no mocked module.
 */
export type StripeDoubleRoutes = {
  account?: unknown;
  /** Keyed by the last path segment, e.g. "pi_123" for /v1/payment_intents/pi_123. */
  intent?: (id: string) => unknown;
  customer?: unknown;
  status?: number;
};

export type StripeDouble = {
  urls: string[];
  restore(): void;
};

export function installStripeDouble(
  routes: StripeDoubleRoutes = {},
): StripeDouble {
  const urls: string[] = [];
  const realFetch = globalThis.fetch;
  const realEventTarget = globalThis.EventTarget;
  const injectedWindow = (
    globalThis as unknown as { window?: { EventTarget?: typeof EventTarget } }
  ).window;
  const dispatches = () => {
    try {
      return new globalThis.EventTarget().dispatchEvent(
        new globalThis.Event("milo-stripe-double-probe"),
      );
    } catch {
      return false;
    }
  };
  // Bun shares one global realm across test files, and apps/web's happy-dom
  // suites (approve-flow.test.tsx:20-51) overwrite globalThis.Event. The SDK's
  // emitter builds a native EventTarget and dispatches a `_StripeEvent extends
  // Event`, which throws ERR_INVALID_ARG_TYPE against that native EventTarget.
  // Realigning EventTarget to the realm Event came from keeps the pair
  // consistent. Both globals are restored by restore().
  if (!dispatches() && injectedWindow?.EventTarget)
    globalThis.EventTarget = injectedWindow.EventTarget;
  globalThis.fetch = (async (resource: string | URL | Request) => {
    const url = String(resource);
    urls.push(url);
    const status = routes.status ?? 200;
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    if (status >= 400)
      return json({
        error: {
          type: "invalid_request_error",
          message: "raw provider secret cus_leak",
        },
      });
    const path = url.replace("https://api.stripe.com", "");
    if (path === "/v1/account")
      return json(routes.account ?? { id: "acct_x", object: "account" });
    if (path.startsWith("/v1/customers/"))
      return json(
        routes.customer ?? {
          id: path.slice("/v1/customers/".length),
          object: "customer",
          deleted: false,
          livemode: false,
        },
      );
    if (path.startsWith("/v1/payment_intents/")) {
      const id = path.slice("/v1/payment_intents/".length);
      const body = routes.intent?.(id);
      if (body !== undefined) return json(body);
      return json({ error: { message: `no intent stub for ${id}` } });
    }
    return json({ error: { message: `unstubbed route ${path}` } });
  }) as typeof fetch;
  return {
    urls,
    restore: () => {
      globalThis.fetch = realFetch;
      globalThis.EventTarget = realEventTarget;
    },
  };
}

export function withStripeSecretKey(
  run: () => Promise<void>,
  key = "sk_test_serverdouble",
): Promise<void> {
  const previous = process.env.STRIPE_SECRET_KEY;
  if (key === undefined) delete process.env.STRIPE_SECRET_KEY;
  else process.env.STRIPE_SECRET_KEY = key;
  return run().finally(() => {
    if (previous === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = previous;
  });
}
