import { motion, type Variants } from "motion/react";
import { forwardRef } from "react";
import {
  MotionIconShell,
  svgBase,
  type MotionIconHandle,
  type MotionIconProps,
} from "./motion-host";

export type CheckIconHandle = MotionIconHandle;

const PATH_VARIANTS: Variants = {
  normal: {
    opacity: 1,
    pathLength: 1,
    scale: 1,
    transition: {
      duration: 0.3,
      opacity: { duration: 0.1 },
    },
  },
  animate: {
    opacity: [0, 1],
    pathLength: [0, 1],
    scale: [0.5, 1],
    transition: {
      duration: 0.4,
      opacity: { duration: 0.1 },
    },
  },
};

const CheckIcon = forwardRef<CheckIconHandle, MotionIconProps>(
  (props, ref) => (
    <MotionIconShell ref={ref} {...props}>
      {(controls, size) => (
        <svg
          {...svgBase(size)}
        >
          <motion.path
            animate={controls}
            d="M4 12 9 17L20 6"
            initial="normal"
            variants={PATH_VARIANTS}
          />
        </svg>
      )}
    </MotionIconShell>
  ),
);

CheckIcon.displayName = "CheckIcon";

export { CheckIcon };
