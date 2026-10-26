import { CircleCheck, Download, LogIn, Unplug, Wallet } from "lucide";
import { useState } from "react";
import { Link } from "react-router";
import { signInWithWallet } from "../../auth-client";
import {
  connectWallet,
  preferredWallet,
  shortAddress,
  useWallet,
  useWallets,
  walletConnector,
  walletHint,
  warmChain,
} from "../../workspace/wallet";
import { Alert } from "../workspace";
import { Button } from "./button";
import { Mark } from "./status";

const INSTALL: readonly (readonly [string, string])[] = [
  ["Lace", "https://www.lace.io"],
  ["1AM", "https://1am.xyz"],
];

function WalletRow({
  name,
  icon,
  duplicate,
  busy,
  warm,
  onPick,
}: {
  name: string;
  icon: string;
  duplicate: boolean;
  busy: boolean;
  /** Prefetch the chain chunk: only where an order action is one click away. */
  warm: boolean;
  onPick: () => void;
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      pending={busy}
      onPointerEnter={warm ? warmChain : undefined}
      onFocus={warm ? warmChain : undefined}
      onClick={onPick}
    >
      {icon ? (
        <img src={icon} alt="" className="size-4 rounded-sm" />
      ) : (
        <Mark icon={Wallet} />
      )}
      {name}
      {duplicate && (
        <span className="text-[11px] font-normal text-warning">
          more than one copy
        </span>
      )}
    </Button>
  );
}

export function ConnectWallet({
  signIn = false,
  to,
  warm = false,
}: {
  signIn?: boolean;
  to?: string;
  /** Prefetch the chain chunk: pass true only where an order action follows. */
  warm?: boolean;
}) {
  const wallet = useWallet();
  const wallets = useWallets();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (wallet.status === "connected") {
    const chip = (
      <span
        className="inline-flex h-8 items-center gap-2 rounded-full bg-card px-3 text-[13px] font-medium"
        title={wallet.account.unshieldedAddress}
      >
        <Mark icon={CircleCheck} className="size-3.5 text-positive" />
        <span className="sr-only">Wallet connected: </span>
        {shortAddress(wallet.account.unshieldedAddress)}
      </span>
    );
    return (
      <span className="inline-flex items-center gap-2">
        {to ? (
          <Link to={to} className="rounded-full hover:bg-muted">
            {chip}
          </Link>
        ) : (
          chip
        )}
        {signIn && (
          <Button
            variant="outline"
            pending={busy}
            onClick={() => {
              const api = walletConnector().connectedApi();
              if (!api) return;
              setBusy(true);
              setError("");
              void signInWithWallet(api)
                .then((result) => {
                  if (!result.ok) setError(result.message);
                })
                .finally(() => setBusy(false));
            }}
          >
            <Mark icon={LogIn} />
            Sign in with a wallet
          </Button>
        )}
        {error && <Alert>{error}</Alert>}
      </span>
    );
  }

  if (wallet.status === "error")
    return (
      <span className="inline-flex items-center gap-2">
        <Alert>{walletHint(wallet)}</Alert>
        <Button
          size="icon-sm"
          variant="outline"
          aria-label="Try the wallet again"
          title="Try the wallet again"
          onClick={() => {
            const wallet = preferredWallet();
            if (wallet) void connectWallet(wallet);
          }}
        >
          <Mark icon={Wallet} />
        </Button>
      </span>
    );

  if (!wallets.length)
    return (
      <Button asChild size="sm" variant="outline">
        <a
          href={INSTALL[0][1]}
          rel="noopener"
          aria-label="Install a Midnight wallet to sign"
          title="Install a Midnight wallet to sign"
        >
          <Mark icon={Download} />
          <span className="hidden sm:inline">Get a wallet</span>
        </a>
      </Button>
    );

  const connecting = wallet.status === "connecting";
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {wallets.map((found) => (
        <WalletRow
          key={found.rdns}
          name={found.name}
          icon={found.icon}
          duplicate={found.duplicate}
          busy={connecting}
          warm={warm}
          onPick={() => void connectWallet(found)}
        />
      ))}
    </span>
  );
}

export function ForgetWallet() {
  return (
    <Button
      size="icon-sm"
      variant="outline"
      aria-label="Forget the wallet connection"
      title="Forget the wallet connection"
      onClick={() => walletConnector().disconnect()}
    >
      <Mark icon={Unplug} />
    </Button>
  );
}
