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
import {
  CircleCheckIcon,
  DownloadIcon,
  LogInIcon,
  PlugZapIcon,
  WalletIcon,
} from "../icons";
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
        <Mark icon={WalletIcon} />
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

  const signAfterConnect = () => {
    const api = walletConnector().connectedApi();
    if (!api) return;
    setBusy(true);
    setError("");
    void signInWithWallet(api)
      .then((result) => {
        if (!result.ok) setError(result.message);
      })
      .finally(() => setBusy(false));
  };

  if (wallet.status === "connected") {
    // On the sign-in sheet the address is not a finished session — Lace still
    // has to sign. Keep the chip neutral and one control that finishes it.
    if (signIn) {
      return (
        <span className="inline-flex flex-wrap items-center gap-2">
          <span
            className="inline-flex h-8 items-center gap-2 rounded-md bg-muted px-3 text-[13px] font-medium"
            title={wallet.account.unshieldedAddress}
          >
            {shortAddress(wallet.account.unshieldedAddress)}
          </span>
          <Button
            variant="outline"
            size="sm"
            pending={busy}
            onClick={signAfterConnect}
          >
            <Mark icon={LogInIcon} />
            Sign in with this wallet
          </Button>
          {error && <Alert>{error}</Alert>}
        </span>
      );
    }
    const chip = (
      <span
        className="inline-flex h-8 items-center gap-2 rounded-full bg-card px-3 text-[13px] font-medium"
        title={wallet.account.unshieldedAddress}
      >
        <Mark icon={CircleCheckIcon} size={14} className="text-positive" />
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
          <Mark icon={WalletIcon} />
        </Button>
      </span>
    );

  if (!wallets.length)
    return (
      <Button asChild size="sm" variant="outline">
        <a
          href={INSTALL[0][1]}
          rel="noopener"
          aria-label="Get Lace: install a Midnight wallet to sign"
          title="Get Lace: install a Midnight wallet to sign"
        >
          <Mark icon={DownloadIcon} />
          <span className="hidden sm:inline">Get Lace</span>
        </a>
      </Button>
    );

  const connecting = wallet.status === "connecting" || busy;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {wallets.map((found) => (
        <WalletRow
          key={found.rdns}
          name={signIn ? `Sign in with ${found.name}` : found.name}
          icon={found.icon}
          duplicate={found.duplicate}
          busy={connecting}
          warm={warm}
          onPick={() => {
            // Connect must stay in the click turn for the wallet popup. Sign-in
            // follows once the connector reports connected.
            void connectWallet(found).then(() => {
              if (!signIn) return;
              signAfterConnect();
            });
          }}
        />
      ))}
      {error && <Alert>{error}</Alert>}
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
      <Mark icon={PlugZapIcon} />
    </Button>
  );
}
