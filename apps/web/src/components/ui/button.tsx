import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cloneElement, isValidElement } from "react";
import { cn } from "../../lib/utils";

/** Occupies the icon slot the button already reserves, so nothing moves. */
const Spinner = () => (
  <span
    aria-hidden="true"
    data-slot="spinner"
    className="size-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none"
  />
);

const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md text-sm font-semibold whitespace-nowrap transition-[color,background-color,transform] outline-none select-none focus-visible:ring-[3px] focus-visible:ring-ring/40 active:translate-y-px disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-mint text-black hover:bg-mint/85",
        outline: "border border-input bg-card hover:bg-muted",
        ghost: "hover:bg-muted",
      },
      size: {
        default: "h-9 px-4",
        sm: "h-8 px-3 text-[13px]",
        "icon-sm": "size-8 px-0",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  type = "button",
  pending = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    /** Disables, announces work, and keeps the label in place. */
    pending?: boolean;
  }) {
  const merged = cn(buttonVariants({ variant, size, className }));
  const child = asChild ? props.children : null;
  if (isValidElement<{ className?: string }>(child)) {
    return cloneElement(child, {
      className: cn(merged, child.props.className),
    });
  }
  return (
    <button
      data-slot="button"
      type={type}
      className={merged}
      disabled={pending || props.disabled}
      aria-busy={pending || undefined}
      {...props}
    >
      {pending ? <Spinner /> : null}
      {props.children}
    </button>
  );
}

export { Button };
