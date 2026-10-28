import { useAnimation, type AnimationControls } from "motion/react";
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
  type HTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from "react";
import { cn } from "../../lib/utils";

export type MotionIconHandle = {
  startAnimation: () => void;
  stopAnimation: () => void;
};

export type MotionIconProps = HTMLAttributes<HTMLSpanElement> & {
  size?: number;
};

type ShellProps = MotionIconProps & {
  children: (controls: AnimationControls, size: number) => ReactNode;
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

export const svgBase = (size: number) => ({
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
