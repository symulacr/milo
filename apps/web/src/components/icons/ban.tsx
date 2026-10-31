import { motion, type Variants } from "motion/react";
import { forwardRef } from "react";
import {
  type MotionIconHandle,
  type MotionIconProps,
  MotionIconShell,
  svgBase,
} from "./motion-host";

export type BanIconHandle = MotionIconHandle;

const CIRCLE_VARIANTS: Variants = {
  normal: {
    opacity: 1,
    pathLength: 1,
    transition: {
      duration: 0.3,
      opacity: { duration: 0.1 },
    },
  },
  animate: {
    opacity: [0, 1],
    pathLength: [0, 1],
    transition: {
      duration: 0.4,
      opacity: { duration: 0.1 },
    },
  },
};

const LINE_VARIANTS: Variants = {
  normal: {
    opacity: 1,
    pathLength: 1,
    transition: {
      duration: 0.3,
      opacity: { duration: 0.1 },
    },
  },
  animate: () => ({
    opacity: [0, 1],
    pathLength: [0, 1],
    transition: {
      duration: 0.4,
      opacity: { duration: 0.1 },
    },
  }),
};

const BanIcon = forwardRef<BanIconHandle, MotionIconProps>((props, ref) => (
  <MotionIconShell ref={ref} {...props}>
    {(controls, size) => (
      <svg aria-hidden="true" {...svgBase(size)}>
        <motion.circle
          animate={controls}
          cx="12"
          cy="12"
          initial="normal"
          r="10"
          variants={CIRCLE_VARIANTS}
        />
        <motion.path
          animate={controls}
          d="m4.9 4.9 14.2 14.2"
          initial="normal"
          variants={LINE_VARIANTS}
        />
      </svg>
    )}
  </MotionIconShell>
));

BanIcon.displayName = "BanIcon";

export { BanIcon };
