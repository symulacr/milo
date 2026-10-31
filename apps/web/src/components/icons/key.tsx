import { motion } from "motion/react";
import { forwardRef } from "react";
import {
  type MotionIconHandle,
  type MotionIconProps,
  MotionIconShell,
  svgBase,
} from "./motion-host";

export type KeyIconHandle = MotionIconHandle;

const KeyIcon = forwardRef<KeyIconHandle, MotionIconProps>((props, ref) => (
  <MotionIconShell ref={ref} {...props}>
    {(controls, size) => (
      <motion.svg
        aria-hidden="true"
        {...svgBase(size)}
        animate={controls}
        initial="normal"
        style={{ originX: 0.3, originY: 0.7 }}
        variants={{
          normal: {
            rotate: 0,
            transition: {
              type: "spring",
              stiffness: 120,
              damping: 14,
              duration: 0.8,
            },
          },
          animate: {
            rotate: [-3, -33, -25, -28],
            transition: {
              duration: 0.6,
              times: [0, 0.6, 0.8, 1],
              ease: "easeInOut",
            },
          },
        }}
      >
        <path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4" />
        <path d="m21 2-9.6 9.6" />
        <circle cx="7.5" cy="15.5" r="5.5" />
      </motion.svg>
    )}
  </MotionIconShell>
));

KeyIcon.displayName = "KeyIcon";

export { KeyIcon };
