import { useConvex } from "convex/react";
import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { PageTitle } from "../components/PageTitle";
import { Button } from "../components/ui/button";
import { Field, Input, Textarea } from "../components/ui/input";
import { errorText, Outcome } from "../components/workspace";
import { useMe } from "../workspace/backend";
import { createQuote } from "../workspace/flows";
import { randomHex } from "../workspace/keys";

/** The server wants a 5-80 character title; the brief's first line is one. */
const titleFrom = (brief: string) => {
  const first = brief.split("\n")[0].trim();
  const title = (first.length >= 5 ? first : brief.trim()).slice(0, 80);
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
  const inFlight = useRef(false);
  if (!me) return null;
  return (
    <>
      <PageTitle title="New quote">
        <p className="text-muted-foreground">Milo emails the link.</p>
      </PageTitle>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <form
          className="grid gap-4 rounded-lg bg-card p-5"
          onSubmit={(event) => {
            event.preventDefault();
            // `busy` only disables the button after a re-render, so guard here.
            if (inFlight.current) return;
            inFlight.current = true;
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
              .then(({ quoteId, emailed, reason }) =>
                navigate(`/orders/${quoteId}`, {
                  state: emailed ? null : { emailFailed: reason },
                }),
              )
              .catch((cause) => setError(errorText(cause)))
              .finally(() => {
                inFlight.current = false;
                setBusy("");
              });
          }}
        >
          {!me.studio && (
            <Field label="Studio name">
              <Input name="studio" required minLength={2} maxLength={60} />
            </Field>
          )}
          <Field label="Brief">
            <Textarea
              name="brief"
              required
              minLength={20}
              maxLength={1000}
              rows={6}
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
              />
            </Field>
            <Field label="Client email">
              <Input name="email" type="email" required autoComplete="off" />
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
