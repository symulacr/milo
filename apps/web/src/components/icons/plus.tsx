import { motion } from "motion/react";
import { forwardRef } from "react";
import {
  type MotionIconHandle,
  type MotionIconProps,
  MotionIconShell,
  svgBase,
} from "./motion-host";

export type PlusIconHandle = MotionIconHandle;

const PlusIcon = forwardRef<PlusIconHandle, MotionIconProps>((props, ref) => (
  <MotionIconShell ref={ref} {...props}>
    {(controls, size) => (
      <motion.svg
        aria-hidden="true"
        {...svgBase(size)}
        animate={controls}
        initial="normal"
        transition={{ type: "spring", stiffness: 100, damping: 15 }}
        variants={{
          normal: { rotate: 0 },
          animate: { rotate: 180 },
        }}
      >
        <path d="M5 12h14" />
        <path d="M12 5v14" />
      </motion.svg>
    )}
  </MotionIconShell>
));

PlusIcon.displayName = "PlusIcon";

export { PlusIcon };
