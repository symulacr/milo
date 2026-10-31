import { motion, type Transition, type Variants } from "motion/react";
import { forwardRef } from "react";
import {
  type MotionIconHandle,
  type MotionIconProps,
  MotionIconShell,
  svgBase,
} from "./motion-host";

export type LoaderCircleIconHandle = MotionIconHandle;

const G_VARIANTS: Variants = {
  normal: { rotate: 0 },
  animate: {
    rotate: 360,
    transition: {
      repeat: Number.POSITIVE_INFINITY,
      duration: 0.8,
      ease: "linear",
    },
  },
};

const DEFAULT_TRANSITION: Transition = {
  type: "spring",
  stiffness: 50,
  damping: 10,
};

const LoaderCircleIcon = forwardRef<LoaderCircleIconHandle, MotionIconProps>(
  (props, ref) => (
    <MotionIconShell ref={ref} {...props}>
      {(controls, size) => (
        <svg aria-hidden="true" {...svgBase(size)}>
          <motion.path
            animate={controls}
            d="M21 12a9 9 0 1 1-6.219-8.56"
            style={{ transformOrigin: "12px 12px" }}
            transition={DEFAULT_TRANSITION}
            variants={G_VARIANTS}
          />
        </svg>
      )}
    </MotionIconShell>
  ),
);

LoaderCircleIcon.displayName = "LoaderCircleIcon";

export { LoaderCircleIcon };
