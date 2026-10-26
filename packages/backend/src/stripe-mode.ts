export type StripeMode = "test" | "live";

const LIVE_KEY = /^(?:sk|rk)_live_[a-zA-Z0-9]+$/;
const TEST_KEY = /^(?:sk|rk)_test_[a-zA-Z0-9]+$/;

export function stripeMode(key: string | undefined): StripeMode {
  if (typeof key === "string") {
    if (LIVE_KEY.test(key)) return "live";
    if (TEST_KEY.test(key)) return "test";
  }
  throw new Error(
    "Stripe secret key must be an sk_live_/sk_test_/rk_live_/rk_test_ key",
  );
}
