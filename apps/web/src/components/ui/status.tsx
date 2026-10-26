import { Check, CircleAlert, LoaderCircle } from "lucide";
import type { IconNode } from "morphicons";
import { MorphIcon } from "morphicons/react";
import { cn } from "../../lib/utils";
import { PageTitle } from "../PageTitle";

const STATUS_ICON: Record<"working" | "done" | "failed", IconNode> = {
  working: LoaderCircle,
  done: Check,
  failed: CircleAlert,
};

export function Mark({
  icon,
  status = "idle",
  className,
}: {
  icon?: IconNode;
  status?: "idle" | "working" | "done" | "failed";
  className?: string;
}) {
  const shown = status === "idle" ? icon : STATUS_ICON[status];
  if (!shown) return null;
  return (
    <MorphIcon
      icon={shown}
      reducedMotion="user"
      className={cn(
        "size-4",
        status === "working" && "animate-spin",
        className,
      )}
    />
  );
}

export function Loading({ label }: { label: string }) {
  return (
    <PageTitle title={label}>
      <span role="status" aria-label={label}>
        <Mark status="working" />
      </span>
      <Skeleton />
    </PageTitle>
  );
}

const SKELETON_WIDTHS = [100, 88, 76, 64, 52];

/** Holds the height of the content it replaces, so nothing jumps on arrival. */
export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className="grid gap-3"
      style={{ minHeight: `${rows * 2.25}rem` }}
    >
      {SKELETON_WIDTHS.slice(0, rows).map((width) => (
        <div
          key={width}
          className="h-6 rounded-md bg-muted"
          style={{ width: `${width}%` }}
        />
      ))}
    </div>
  );
}
