import { type ReactNode, useEffect, useId, useRef } from "react";
import { cn } from "../../lib/utils";
import { Button } from "./button";

type SealSheetProps = {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/** Shared confirmation sheet for chain actions (alertdialog). */
export function SealSheet({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel = "Not now",
  danger,
  pending,
  onConfirm,
  onCancel,
}: SealSheetProps) {
  const titleId = useId();
  const bodyId = useId();
  const priorFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    priorFocus.current = document.activeElement as HTMLElement | null;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      priorFocus.current?.focus?.();
    };
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-end p-4 sm:place-items-center">
      {/* The scrim is a real button, not a div with a click handler: it is the
          dismiss affordance, so it must be reachable and named. It sits behind
          the sheet rather than wrapping it, because a button cannot contain the
          dialog's own buttons. Escape and the cancel button remain the primary
          paths; this is the pointer shortcut, labelled for anyone who lands on
          it with a screen reader. */}
      <button
        type="button"
        aria-label={cancelLabel}
        className="absolute inset-0 cursor-default bg-foreground/40"
        onClick={onCancel}
      />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        className={cn(
          "relative grid w-full max-w-md gap-4 border border-border bg-background p-5 shadow-lg",
          "rounded-none sm:rounded-sm",
        )}
      >
        <h2 id={titleId} className="text-lg font-semibold tracking-tight">
          {title}
        </h2>
        <div id={bodyId} className="grid gap-2 text-sm text-muted-foreground">
          {body}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            autoFocus
            variant={danger ? "danger" : "default"}
            pending={pending}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
          <Button variant="outline" disabled={pending} onClick={onCancel}>
            {cancelLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
