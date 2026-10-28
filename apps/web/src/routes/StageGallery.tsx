/**
 * Localhost-only stage board for design QA without Lace.
 * Not linked from production nav; App.tsx gates the route by hostname.
 */
import { useState } from "react";
import type { Role, Stage } from "../api";
import { PageTitle } from "../components/PageTitle";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardTitle } from "../components/ui/card";
import { SealSheet } from "../components/ui/seal-sheet";
import { Mark } from "../components/ui/status";
import { Note } from "../components/workspace";
import { badgeTone } from "../lib/format";
import { WALLET_MISSING } from "../workspace/order-wallet";
import { OrderProgress } from "../components/ui/order-progress";
import {
  actionsFor,
  PAYMENT_CAPTION,
  STAGE_LABEL,
  turnOf,
} from "../workspace/stages";

const NOW = Date.UTC(2026, 9, 28, 12, 0, 0);
const FAR_SEC = String(Math.floor((NOW + 86_400_000) / 1000));

const ART: Partial<Record<Stage, string>> = {
  QUOTE: "/images/agree.webp",
  PAYMENT_HELD: "/images/agree.webp",
  DEPLOYED: "/images/shoot.webp",
  RESERVED: "/images/shoot.webp",
  ACCEPTED: "/images/sc-03-01.webp",
  SUBMITTED: "/images/proof-review.webp",
  DISPUTED: "/images/sc-05-01.webp",
  APPROVED: "/images/packing.webp",
  CANCELLED: "/images/studio-bench.webp",
};

const ROLES: Role[] = ["buyer", "merchant", "operator"];

const STAGES = Object.keys(STAGE_LABEL) as Stage[];

const deadlines = {
  acceptance: FAR_SEC,
  delivery: FAR_SEC,
  review: FAR_SEC,
  resolution: FAR_SEC,
};

const PAYMENT_STATES = Object.keys(PAYMENT_CAPTION) as (keyof typeof PAYMENT_CAPTION)[];

function StageCard({ stage, role }: { stage: Stage; role: Role }) {
  const turn = turnOf(stage, role, true, false);
  const actions = actionsFor(stage, role, deadlines, NOW);
  const art = ART[stage];
  return (
    <Card className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={badgeTone(stage)}>{STAGE_LABEL[stage]}</Badge>
        <span className="text-sm text-muted-foreground">{role}</span>
      </div>
      {art && (
        <img
          className="aspect-[16/10] w-full max-w-md object-cover"
          src={art}
          alt=""
          width={640}
          height={400}
          loading="lazy"
          decoding="async"
        />
      )}
      <OrderProgress
        stage={stage}
        payment={
          stage === "APPROVED"
            ? "captured"
            : stage === "CANCELLED"
              ? "released"
              : stage === "QUOTE"
                ? "none"
                : "held"
        }
      />
      <div className="grid gap-1">
        <p className="text-sm font-semibold">{turn.title}</p>
        <Note>{turn.body || "No turn for this role."}</Note>
      </div>
      {actions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {actions.map((action) => (
            <Button
              key={`${action.circuit}-${action.label}`}
              variant={action.weight === "danger" ? "danger" : "default"}
              disabled
            >
              <Mark icon={action.icon} />
              {action.label}
            </Button>
          ))}
        </div>
      )}
    </Card>
  );
}

export function StageGallery() {
  const [sealOpen, setSealOpen] = useState(false);
  return (
    <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10">
      <PageTitle title="Stage gallery">
        <p className="max-w-[52ch] text-muted-foreground">
          Local design board. Actions are disabled; Lace is still required for
          live orders.
        </p>
      </PageTitle>
      <Card className="grid gap-3" aria-label="Wallet missing">
        <CardTitle>Wallet missing</CardTitle>
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled>Connect a wallet</Button>
          <Note>{WALLET_MISSING}</Note>
        </div>
      </Card>
      <Card className="grid gap-3" aria-label="Payment captions">
        <CardTitle>Payment as words</CardTitle>
        <ul className="grid gap-1 text-sm text-muted-foreground">
          {PAYMENT_STATES.map((state) => (
            <li key={state}>{PAYMENT_CAPTION[state]}</li>
          ))}
        </ul>
      </Card>
      <Card className="grid gap-3" aria-label="Seal sheet">
        <CardTitle>Seal sheet</CardTitle>
        <Button className="w-fit" onClick={() => setSealOpen(true)}>
          Open confirm sheet
        </Button>
        <SealSheet
          open={sealOpen}
          title="Publish the contract"
          body={
            <>
              <p>Signs with Lace on Midnight Preprod.</p>
              <p>This step cannot be undone.</p>
            </>
          }
          confirmLabel="Publish the contract"
          onCancel={() => setSealOpen(false)}
          onConfirm={() => setSealOpen(false)}
        />
      </Card>
      <div className="grid gap-10">
        {STAGES.map((stage) => (
          <section
            key={stage}
            className="grid gap-4"
            aria-label={STAGE_LABEL[stage]}
          >
            <CardTitle>{STAGE_LABEL[stage]}</CardTitle>
            <div className="grid gap-4 lg:grid-cols-3">
              {ROLES.map((role) => (
                <StageCard key={role} stage={stage} role={role} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
