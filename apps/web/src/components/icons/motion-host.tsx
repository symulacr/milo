import { type LegacyAnimationControls, useAnimation } from "motion/react";
import {
  forwardRef,
  type HTMLAttributes,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useImperativeHandle,
  useRef,
} from "react";
import { cn } from "../../lib/utils";

export type MotionIconHandle = {
  startAnimation: () => void;
  stopAnimation: () => void;
};

export type MotionIconProps = HTMLAttributes<HTMLSpanElement> & {
  size?: number;
};

/**
 * `children` is a render function here, not a node. `HTMLAttributes` already
 * declares `children?: ReactNode`, so intersecting the two produced
 * `ReactNode & ((controls, size) => ReactNode)` — an impossible type that made
 * every icon's `<MotionIconShell>{(controls, size) => …}` fail to typecheck.
 * Omitting the inherited member leaves exactly one `children` type.
 */
type ShellProps = Omit<MotionIconProps, "children"> & {
  children: (controls: LegacyAnimationControls, size: number) => ReactNode;
};

/** Shared hover/imperative animation host for lucide-animated-style icons. */
export const MotionIconShell = forwardRef<MotionIconHandle, ShellProps>(
  (
    { onMouseEnter, onMouseLeave, className, size = 28, children, ...props },
    ref,
  ) => {
    const controls = useAnimation();
    const owned = useRef(false);
    useImperativeHandle(ref, () => {
      owned.current = true;
      return {
        startAnimation: () => void controls.start("animate"),
        stopAnimation: () => void controls.start("normal"),
      };
    });
    const enter = useCallback(
      (event: MouseEvent<HTMLSpanElement>) => {
        if (!owned.current) void controls.start("animate");
        onMouseEnter?.(event);
      },
      [controls, onMouseEnter],
    );
    const leave = useCallback(
      (event: MouseEvent<HTMLSpanElement>) => {
        if (!owned.current) void controls.start("normal");
        onMouseLeave?.(event);
      },
      [controls, onMouseLeave],
    );
    return (
      <span
        // The icon is decorative: the hover handlers only drive the animation,
        // never an action. `role="none"` states that, and it is also what tells
        // the a11y lint this is not an unlabelled control. This element must not
        // carry `aria-hidden`, because a caller may pass its own label and an
        // aria-hidden wrapper would swallow it; the `<svg>` inside is the
        // decorative part and carries `aria-hidden` instead.
        role="none"
        className={cn(className)}
        onMouseEnter={enter}
        onMouseLeave={leave}
        {...props}
      >
        {children(controls, size)}
      </span>
    );
  },
);
MotionIconShell.displayName = "MotionIconShell";

/**
 * Shared geometry for the icon set. `focusable: false` keeps IE-era focus stops
 * out of the tab order. The `aria-hidden` that marks each icon decorative lives
 * on the `<svg>` element itself, not here: the a11y lint cannot see an attribute
 * that arrives through a spread, so a literal attribute is required.
 */
export const svgBase = (size: number) => ({
  focusable: "false" as const,
  fill: "none" as const,
  height: size,
  width: size,
  stroke: "currentColor",
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  strokeWidth: 2,
  viewBox: "0 0 24 24",
  xmlns: "http://www.w3.org/2000/svg",
});
