import type * as React from "react";
import { cn } from "../../lib/utils";

function Card({ className, ...props }: React.ComponentProps<"section">) {
  return (
    <section
      data-slot="card"
      className={cn(
        "flex min-w-0 flex-col gap-4 rounded-lg bg-card p-5 text-card-foreground",
        className,
      )}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return (
    <h2
      data-slot="card-title"
      className={cn("text-base font-semibold", className)}
      {...props}
    />
  );
}

type Fact = readonly [string, React.ReactNode];

function Facts({ rows }: { rows: readonly Fact[] }) {
  return (
    <dl className="grid gap-2 text-sm">
      {rows.map(([term, detail]) => (
        <div
          key={term}
          className="grid gap-1 sm:grid-cols-[minmax(0,180px)_1fr] sm:gap-4"
        >
          <dt className="text-muted-foreground">{term}</dt>
          <dd className="min-w-0 break-words">{detail}</dd>
        </div>
      ))}
    </dl>
  );
}

export { Card, CardTitle, type Fact, Facts };
