import { useConvex } from "convex/react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { PageTitle } from "../components/PageTitle";
import { Button } from "../components/ui/button";
import { Field, Input, Textarea } from "../components/ui/input";
import { errorText, Outcome } from "../components/workspace";
import { useGuard } from "../lib/utils";
import { useMe } from "../workspace/backend";
import { createQuote } from "../workspace/flows";
import { randomHex, readQuoteDraft, writeQuoteDraft } from "../workspace/keys";

/** The server wants a 5-80 character title; the brief's first line is one. */
export const titleFrom = (brief: string) => {
  const first = brief.split("\n")[0].trim();
  const source = first.length >= 5 ? first : brief.trim();
  // Take whole code points while the UTF-16 length still fits in 80.
  //
  // `slice(0, 80)` counts code units, so a surrogate pair straddling index 80
  // becomes a lone surrogate: the server accepts it (it counts units too) and
  // the orders list renders a replacement glyph. `Array.from(...).slice(0, 80)`
  // fixes the surrogate but can exceed 80 units — 80 emoji are 160 units — and
  // the server would then reject the title. This takes code points only while
  // the running unit count fits, so the result is whole-emoji-safe AND legal.
  let title = "";
  for (const point of source) {
    if (title.length + point.length > 80) break;
    title += point;
  }
  return title.length >= 5 ? title : "New order";
};

export function NewQuote() {
  const { me } = useMe();
  const convex = useConvex();
  const navigate = useNavigate();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  // One nonce per form session: a resubmit reuses it, so the server's own
  // duplicate-nonce guard fires instead of creating a second quote.
  const [nonce] = useState(randomHex);
  const inFlight = useGuard();
  // AD-02: the stale-chunk recovery in `bootstrap.tsx` calls `location.reload()`
  // unconditionally — correctly, because a broken chunk cannot be fixed without
  // one. The order page's note survives that (r23 persists it); this form had no
  // persistence at all, so a reload mid-quote lost the whole brief. One draft
  // entry, read once here and written on input, closes the asymmetry.
  const [draft] = useState(readQuoteDraft);
  if (!me) return null;
  return (
    <>
      <PageTitle title="New quote">
        <p className="text-muted-foreground">Milo emails the link.</p>
      </PageTitle>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <form
          className="grid gap-4 rounded-lg bg-card p-5"
          // One listener for the whole form rather than one per field: the
          // inputs stay uncontrolled, so this is the cheapest way to keep the
          // draft current without turning four fields into controlled state.
          onInput={(event) => {
            const data = new FormData(event.currentTarget);
            writeQuoteDraft({
              studio: String(data.get("studio") ?? ""),
              brief: String(data.get("brief") ?? ""),
              amount: String(data.get("amount") ?? ""),
              email: String(data.get("email") ?? ""),
            });
          }}
          onSubmit={(event) => {
            event.preventDefault();
            // `busy` only disables the button after a re-render, so guard here.
            if (!inFlight.start()) return;
            const data = new FormData(event.currentTarget);
            const studioName = String(data.get("studio") ?? "").trim();
            const brief = String(data.get("brief")).trim();
            setError("");
            setBusy("Preparing the order keys…");
            const form = {
              title: titleFrom(brief),
              brief,
              amountUsd: Number(data.get("amount")),
              clientEmail: String(data.get("email")).trim().toLowerCase(),
              orderNonce: nonce,
            };
            createQuote(convex, me.subject, me.studio ?? { studioName }, form)
              .then(({ quoteId, emailed, reason }) => {
                // The quote exists, so the draft is spent: leaving it would
                // pre-fill the next quote with the previous brief.
                writeQuoteDraft({
                  studio: "",
                  brief: "",
                  amount: "",
                  email: "",
                });
                navigate(`/orders/${quoteId}`, {
                  state: emailed ? null : { emailFailed: reason },
                });
              })
              .catch((cause) => setError(errorText(cause)))
              .finally(() => {
                inFlight.end();
                setBusy("");
              });
          }}
        >
          {!me.studio && (
            <Field label="Studio name">
              <Input
                name="studio"
                required
                minLength={2}
                maxLength={60}
                defaultValue={draft.studio}
              />
            </Field>
          )}
          <Field label="Brief">
            <Textarea
              name="brief"
              required
              minLength={20}
              maxLength={1000}
              rows={6}
              defaultValue={draft.brief}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Fixed price (USD)">
              <Input
                name="amount"
                type="number"
                required
                min={1}
                max={5000}
                step={1}
                inputMode="numeric"
                defaultValue={draft.amount}
              />
            </Field>
            <Field label="Client email">
              <Input
                name="email"
                type="email"
                required
                autoComplete="off"
                defaultValue={draft.email}
              />
            </Field>
          </div>
          <Button type="submit" className="w-fit" pending={Boolean(busy)}>
            Send the quote
          </Button>
          <Outcome status={busy} error={error} />
        </form>
      </div>
    </>
  );
}
