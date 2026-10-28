import type { AppIcon } from "../icons";
import {
  BadgeAlertIcon,
  CheckIcon,
  LoaderCircleIcon,
} from "../icons";
import { PageTitle } from "../PageTitle";
import { cn } from "../../lib/utils";

const STATUS_ICON: Record<"working" | "done" | "failed", AppIcon> = {
  working: LoaderCircleIcon,
  done: CheckIcon,
  failed: BadgeAlertIcon,
};

export function Mark({
  icon: Icon,
  status = "idle",
  className,
  size = 16,
}: {
  icon?: AppIcon;
  status?: "idle" | "working" | "done" | "failed";
  className?: string;
  size?: number;
}) {
  const Shown = status === "idle" ? Icon : STATUS_ICON[status];
  if (!Shown) return null;
  return (
    <Shown
      size={size}
      className={cn(
        // app-icon: prefers-reduced-motion disables pointer so hover morphs stay off
        "app-icon inline-flex shrink-0 text-current [&_svg]:block",
        status === "working" && "motion-safe:animate-spin",
        className,
      )}
      aria-hidden="true"
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
