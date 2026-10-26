import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { z } from "zod";
import { randomBytes } from "../../packages/backend/src/encoding";
import {
  consumeWalletNonce,
  issueWalletNonce,
  parseWalletSignInMessage,
  verifyWalletSignature,
  WALLET_EMAIL_DOMAIN,
  WALLET_NETWORK,
  WALLET_PROVIDER_ID,
  type WalletNonceRecord,
  type WalletNonceStore,
  walletBoundToAddress,
} from "../../packages/backend/src/wallet-auth";

const ADDRESS = /^mn_addr_preprod1[02-9ac-hj-np-z]{20,}$/;
const HEX_32 = /^[0-9a-f]{64}$/;
const HEX_64 = /^[0-9a-f]{128}$/;

const nonceBody = z.object({
  address: z.string().min(1).max(120).regex(ADDRESS),
});

const verifyBody = z.object({
  message: z.string().min(1).max(2048),
  verifyingKey: z.string().regex(HEX_32),
  signature: z.string().regex(HEX_64),
  scheme: z.enum(["schnorr_bip340", "ecdsa_secp256k1_sha256"]).optional(),
});

const unauthorized = (message: string) =>
  APIError.fromStatus("UNAUTHORIZED", { message, status: 401 });

export type WalletAuthOptions = {
  store?: WalletNonceStore;
  now?: () => number;
  random?: (length: number) => Uint8Array;
};

export function walletAuth(options: WalletAuthOptions = {}) {
  const now = options.now ?? (() => Date.now());
  const random = options.random ?? randomBytes;
  const store = options.store;
  const storeFor = (ctx: {
    context: { internalAdapter: unknown };
  }): WalletNonceStore => store ?? adapterStore(ctx.context.internalAdapter);

  return {
    id: "milo-wallet",
    version: "1.0.0",
    endpoints: {
      walletNonce: createAuthEndpoint(
        "/wallet/nonce",
        { method: "POST", body: nonceBody },
        async (ctx) => {
          const issued = await issueWalletNonce(
            storeFor(ctx as never),
            ctx.body.address,
            now(),
            random,
          );
          return ctx.json({
            address: ctx.body.address,
            network: WALLET_NETWORK,
            nonce: issued.nonce,
            expiresAt: issued.expiresAt,
            message: issued.message,
          });
        },
      ),
      walletVerify: createAuthEndpoint(
        "/wallet/verify",
        { method: "POST", body: verifyBody, requireRequest: true },
        async (ctx) => {
          const parsed = parseWalletSignInMessage(ctx.body.message);
          if (!parsed) throw unauthorized("Wallet message is malformed");
          if (!walletBoundToAddress(ctx.body.verifyingKey, parsed.address))
            throw unauthorized("Wallet key does not match the claimed address");
          if (!verifyWalletSignature(ctx.body))
            throw unauthorized("Wallet signature is invalid");
          const current = now();
          if (parsed.expiresAt <= current)
            throw unauthorized("Wallet message has expired");
          const consumed = await consumeWalletNonce(
            storeFor(ctx as never),
            parsed.address,
            parsed.nonce,
            current,
          );
          if (!consumed) throw unauthorized("Wallet nonce is invalid or used");
          const user = await upsertWalletUser(ctx, parsed.address);
          const session = await ctx.context.internalAdapter.createSession(
            user.id,
          );
          if (!session)
            throw unauthorized("Wallet session could not be created");
          await setSessionCookie(ctx, {
            session,
            user: user as never,
          });
          return ctx.json({
            success: true,
            token: session.token,
            address: parsed.address,
            user: { id: user.id, email: user.email },
          });
        },
      ),
    },
  };
}

type InternalAdapter = {
  findAccountByProviderId(
    accountId: string,
    providerId: string,
  ): Promise<{ userId: string } | null>;
  findUserById(userId: string): Promise<WalletUser | null>;
  createUser(user: {
    email: string;
    name: string;
    emailVerified: boolean;
  }): Promise<WalletUser>;
  createAccount(account: {
    userId: string;
    providerId: string;
    accountId: string;
  }): Promise<unknown>;
  createVerificationValue(data: {
    identifier: string;
    value: string;
    expiresAt: Date;
  }): Promise<unknown>;
  findVerificationValue(identifier: string): Promise<{ value: string } | null>;
  consumeVerificationValue(
    identifier: string,
  ): Promise<{ value: string } | null>;
};

type WalletUser = {
  id: string;
  email: string;
  name?: string;
  emailVerified?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
  image?: string | null;
};

function adapterStore(adapter: unknown): WalletNonceStore {
  const internal = adapter as InternalAdapter;
  const parse = (raw: { value: string } | null): WalletNonceRecord | null => {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw.value) as {
        value?: unknown;
        expiresAt?: unknown;
      };
      if (typeof parsed.value !== "string") return null;
      if (typeof parsed.expiresAt !== "number") return null;
      return { value: parsed.value, expiresAt: parsed.expiresAt };
    } catch {
      return null;
    }
  };
  return {
    async put(identifier, value, expiresAt) {
      await internal.createVerificationValue({
        identifier,
        value: JSON.stringify({ value, expiresAt }),
        expiresAt: new Date(expiresAt),
      });
    },
    // Non-destructive: `consumeWalletNonce` compares against this and only then
    // calls `take`, so a wrong guess cannot destroy the real nonce.
    async get(identifier) {
      return parse(await internal.findVerificationValue(identifier));
    },
    async take(identifier) {
      return parse(await internal.consumeVerificationValue(identifier));
    },
  };
}

async function upsertWalletUser(
  ctx: {
    context: { internalAdapter: InternalAdapter };
  },
  address: string,
): Promise<WalletUser> {
  const internal = ctx.context.internalAdapter;
  const account = await internal.findAccountByProviderId(
    address,
    WALLET_PROVIDER_ID,
  );
  if (account) {
    const existing = await internal.findUserById(account.userId);
    if (existing) return existing;
  }
  const email = `wallet-${address.slice(-16)}@${WALLET_EMAIL_DOMAIN}`;
  const user = await internal.createUser({
    email,
    name: address,
    emailVerified: true,
  });
  await internal.createAccount({
    userId: user.id,
    providerId: WALLET_PROVIDER_ID,
    accountId: address,
  });
  return user;
}
