import type { Stage } from "../../api";
import { cn } from "../../lib/utils";
import {
  PAYMENT_CAPTION,
  STAGE_LABEL,
  TRACK,
  trackIndex,
} from "../../workspace/stages";

type PaymentState = keyof typeof PAYMENT_CAPTION;

/** Phase bar + payment-as-words caption under the order title. */
export function OrderProgress({
  stage,
  payment,
}: {
  stage: Stage;
  payment: PaymentState;
}) {
  // A disputed order is off the happy-path track, so it claims no position.
  const at = stage === "DISPUTED" ? undefined : trackIndex(stage);
  return (
    <>
      <div
        role="progressbar"
        aria-label="Order progress"
        aria-valuemin={0}
        aria-valuemax={at === undefined ? undefined : TRACK.length - 1}
        aria-valuenow={at}
        aria-valuetext={STAGE_LABEL[stage]}
        className="h-1.5 overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn(
            "h-full",
            stage === "DISPUTED" ? "bg-destructive" : "bg-brand",
          )}
          style={{
            width: `${(Math.max(at ?? 0, 0) / (TRACK.length - 1)) * 100}%`,
          }}
        />
      </div>
      <p className="text-sm text-muted-foreground">
        {PAYMENT_CAPTION[payment]}
      </p>
    </>
  );
}
