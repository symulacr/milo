import { motion } from "motion/react";
import { forwardRef } from "react";
import {
  MotionIconShell,
  svgBase,
  type MotionIconHandle,
  type MotionIconProps,
} from "./motion-host";

export type LockIconHandle = MotionIconHandle;

const LockIcon = forwardRef<LockIconHandle, MotionIconProps>((props, ref) => (
  <MotionIconShell ref={ref} {...props}>
    {(controls, size) => (
      <motion.svg
        {...svgBase(size)}
        animate={controls}
        initial="normal"
        transition={{ duration: 1, ease: [0.4, 0, 0.2, 1] }}
        variants={{
          normal: { rotate: 0, scale: 1 },
          animate: {
            rotate: [-3, 1, -2, 0],
            scale: [0.95, 1.05, 0.98, 1],
          },
        }}
      >
        <rect height="11" rx="2" ry="2" width="18" x="3" y="11" />
        <motion.path
          animate={controls}
          d="M7 11V7a5 5 0 0 1 10 0v4"
          initial="normal"
          transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
          variants={{
            normal: { pathLength: 1 },
            animate: { pathLength: 0.7 },
          }}
        />
      </motion.svg>
    )}
  </MotionIconShell>
));

LockIcon.displayName = "LockIcon";

export { LockIcon };
