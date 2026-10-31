import { motion, type Variants } from "motion/react";
import { forwardRef } from "react";
import {
  type MotionIconHandle,
  type MotionIconProps,
  MotionIconShell,
  svgBase,
} from "./motion-host";

export type XIconHandle = MotionIconHandle;

const PATH_VARIANTS: Variants = {
  normal: {
    opacity: 1,
    pathLength: 1,
  },
  animate: {
    opacity: [0, 1],
    pathLength: [0, 1],
  },
};

const XIcon = forwardRef<XIconHandle, MotionIconProps>((props, ref) => (
  <MotionIconShell ref={ref} {...props}>
    {(controls, size) => (
      <svg aria-hidden="true" {...svgBase(size)}>
        <motion.path
          animate={controls}
          d="M18 6 6 18"
          variants={PATH_VARIANTS}
        />
        <motion.path
          animate={controls}
          d="m6 6 12 12"
          transition={{ delay: 0.2 }}
          variants={PATH_VARIANTS}
        />
      </svg>
    )}
  </MotionIconShell>
));

XIcon.displayName = "XIcon";

export { XIcon };
