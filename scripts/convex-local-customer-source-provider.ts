// Copied only into .tools; deliberately exposes no provider write methods.
export function testStripeClient() {
  return {
    accounts: {
      retrieveCurrent: async () => ({
        id: "acct_SyntheticCustomerSource",
        email: "synthetic-provider-private@example.invalid",
        metadata: { secret: "synthetic-provider-private-metadata" },
      }),
    },
    customers: {
      retrieve: async (id: string) => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        if (id.startsWith("cus_ProviderError"))
          throw new Error("synthetic-provider-private-error");
        return {
          id: id.startsWith("cus_Mismatch") ? "cus_WrongCustomer" : id,
          deleted: id.startsWith("cus_Deleted"),
          livemode: id.startsWith("cus_Live"),
          email: "synthetic-provider-private@example.invalid",
          name: "synthetic-provider-private-name",
          metadata: { secret: "synthetic-provider-private-metadata" },
        };
      },
    },
  };
}
