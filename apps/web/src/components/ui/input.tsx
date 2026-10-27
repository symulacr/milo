import type * as React from "react";
import { cn } from "../../lib/utils";

const control =
  "w-full min-w-0 rounded-md border border-input bg-card px-3 text-sm font-normal outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-[3px] aria-invalid:ring-destructive/20 user-invalid:border-destructive";

function Input({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      data-slot="input"
      autoComplete="off"
      className={cn(control, "h-10", className)}
      {...props}
    />
  );
}

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(control, "min-h-24 py-2", className)}
      {...props}
    />
  );
}

function Field({
  label,
  error,
  id,
  className,
  children,
}: {
  label: React.ReactNode;
  /** Shown under the control and announced with it, so the two are one thing. */
  error?: string;
  /** Set on the control; the error sentence derives its id from it. */
  id?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={cn("grid gap-1.5 text-sm font-medium", className)}>
      {label}
      {children}
      {error && (
        <span
          id={id && `${id}-error`}
          role="alert"
          className="text-destructive"
        >
          {error}
        </span>
      )}
    </label>
  );
}

export { Field, Input, Textarea };
