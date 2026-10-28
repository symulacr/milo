import {
  DownloadIcon,
  KeyIcon,
  LogoutIcon,
  UploadIcon,
} from "../components/icons";
import { useMemo, useState } from "react";
import { signOut } from "../auth-client";
import { PageTitle } from "../components/PageTitle";
import { Button } from "../components/ui/button";
import { Card, CardTitle, Facts } from "../components/ui/card";
import { ConnectWallet, ForgetWallet } from "../components/ui/connect";
import { Field, Input } from "../components/ui/input";
import { Mark } from "../components/ui/status";
import { errorText, Outcome } from "../components/workspace";
import { ROLE_NAME } from "../lib/format";
import { useGuard } from "../lib/utils";
import { useMe } from "../workspace/backend";
import { backupBlob, readKeys, restoreBackup } from "../workspace/keys";
import { shortAddress, useWallet, walletHint } from "../workspace/wallet";

export function Account() {
  const { me } = useMe();
  const wallet = useWallet();
  const subject = me?.subject ?? "";
  // Derived, not stored: the ring is the source of truth. `version` only forces
  // a re-read after a backup or a restore writes to it.
  const [version, setVersion] = useState(0);
  // Derived, not stored: the ring is the source of truth. `version` is read
  // inside so a backup or restore invalidates the memo.
  const count = useMemo(() => {
    void version;
    return Object.keys(readKeys(subject)).length;
  }, [subject, version]);
  const [password, setPassword] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [restorePassword, setRestorePassword] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  // U-01: neither form had a guard, so a double-click ran the whole handler
  // twice. For backup that is two downloads; for restore it is two decrypts of
  // the same file, and the second can interleave with the first's writes. One
  // shared hook instead of a third and fourth copy of the ref.
  const backupGuard = useGuard();
  const restoreGuard = useGuard();
  if (!me) return null;
  return (
    <>
      <PageTitle title="Account" />
      <div className="grid gap-6">
        <Card>
          <div className="flex items-center justify-between gap-4">
            <CardTitle>You</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => void signOut()}>
              <Mark icon={LogoutIcon} />
              Sign out
            </Button>
          </div>
          <Facts
            rows={[
              ["Email", me.email ?? "Not set"],
              ["Studio", me.studio?.name ?? "None"],
              ...(me.operator ? [["Role", ROLE_NAME.operator] as const] : []),
              [
                "Lace",
                wallet.status === "connected"
                  ? `Signs order steps · ${shortAddress(wallet.account.unshieldedAddress)}`
                  : me.walletAddress
                    ? `Signs order steps · last used ${shortAddress(me.walletAddress)}`
                    : `Signs order steps. ${walletHint(wallet)}`,
              ],
            ]}
          />
          {wallet.status === "connected" && <ForgetWallet />}
          {wallet.status !== "connected" && <ConnectWallet warm />}
        </Card>
        <Card>
          <CardTitle>Order keys</CardTitle>
          <p className="max-w-[64ch] text-sm text-muted-foreground">
            Each order has a key that only this browser holds. Clear the browser
            and it is gone; Milo cannot make a new one. Download a backup.
          </p>
          <div className="flex items-center gap-2 text-sm font-medium">
            <Mark icon={KeyIcon} className="text-muted-foreground" />
            {count} order {count === 1 ? "key" : "keys"} in this browser
          </div>
          <div className="grid gap-6 md:grid-cols-2">
            <form
              className="grid content-start gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (!backupGuard.start()) return;
                setError("");
                void backupBlob(subject, password)
                  .then((blob) => {
                    const anchor = document.createElement("a");
                    anchor.href = URL.createObjectURL(blob);
                    anchor.download = `milo-order-keys-${new Date().toISOString().slice(0, 10)}.json`;
                    anchor.click();
                    setTimeout(() => URL.revokeObjectURL(anchor.href), 0);
                    setPassword("");
                    setStatus("Saved. Keep it off this computer.");
                  })
                  .catch((cause) => setError(errorText(cause)))
                  .finally(backupGuard.end);
              }}
            >
              <Field label="Backup password (10 characters or more)">
                <Input
                  type="password"
                  required
                  minLength={10}
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </Field>
              <Button
                type="submit"
                variant={count ? "default" : "outline"}
                className="w-fit"
                disabled={!count}
              >
                <Mark icon={DownloadIcon} />
                Download the backup
              </Button>
            </form>
            <form
              className="grid content-start gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (!file) return;
                if (!restoreGuard.start()) return;
                setError("");
                void file
                  .text()
                  .then((text) => restoreBackup(subject, text, restorePassword))
                  .then(({ restored, kept }) => {
                    setVersion((v) => v + 1);
                    setRestorePassword("");
                    // G-08: say what was kept, not only what was added. A file
                    // whose keys are all already here used to report the same
                    // number as one that replaced them, so a user could not tell
                    // a no-op from a silent overwrite.
                    setStatus(
                      [
                        restored > 0 &&
                          `${restored} order ${restored === 1 ? "key is" : "keys are"} back in this browser.`,
                        kept > 0 &&
                          `${kept} ${kept === 1 ? "key was" : "keys were"} already here and left alone.`,
                      ]
                        .filter(Boolean)
                        .join(" ") || "That file had no order keys in it.",
                    );
                  })
                  .catch((cause) => setError(errorText(cause)))
                  .finally(restoreGuard.end);
              }}
            >
              <Field label="Backup file">
                <Input
                  type="file"
                  accept="application/json,.json"
                  required
                  className="py-1.5"
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                />
              </Field>
              <Field label="Backup password">
                <Input
                  type="password"
                  required
                  autoComplete="current-password"
                  value={restorePassword}
                  onChange={(event) => setRestorePassword(event.target.value)}
                />
              </Field>
              <Button type="submit" variant="outline" className="w-fit">
                <Mark icon={UploadIcon} />
                Restore the keys
              </Button>
            </form>
          </div>
          <Outcome status={status} error={error} />
        </Card>
      </div>
    </>
  );
}
