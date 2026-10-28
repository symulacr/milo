import { cubicBezier, motion } from "motion/react";
import { forwardRef } from "react";
import {
  MotionIconShell,
  svgBase,
  type MotionIconHandle,
  type MotionIconProps,
} from "./motion-host";

export type UndoIconHandle = MotionIconHandle;

const CUSTOM_EASING = cubicBezier(0.25, 0.1, 0.25, 1);

const UndoIcon = forwardRef<UndoIconHandle, MotionIconProps>(
  (props, ref) => (
    <MotionIconShell ref={ref} {...props}>
      {(controls, size) => (
        <svg
          {...svgBase(size)}
        >
          <motion.path
            animate={controls}
            d="M3 7v6h6"
            transition={{
              duration: 0.6,
              ease: CUSTOM_EASING,
            }}
            variants={{
              normal: { translateX: 0, translateY: 0, rotate: 0 },
              animate: {
                translateX: [0, 2.1, 0],
                translateY: [0, -1.4, 0],
                rotate: [0, 12, 0],
              },
            }}
          />
          <motion.path
            animate={controls}
            d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"
            transition={{
              duration: 0.6,
              ease: CUSTOM_EASING,
            }}
            variants={{
              normal: { pathLength: 1 },
              animate: { pathLength: [1, 0.8, 1] },
            }}
          />
        </svg>
      )}
    </MotionIconShell>
  ),
);

UndoIcon.displayName = "UndoIcon";

export { UndoIcon };
