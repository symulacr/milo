import { motion, type Variants } from "motion/react";
import { forwardRef } from "react";
import {
  type MotionIconHandle,
  type MotionIconProps,
  MotionIconShell,
  svgBase,
} from "./motion-host";

export type PlugZapIconHandle = MotionIconHandle;

const ZAP_VARIANT: Variants = {
  normal: { opacity: 1 },
  animate: {
    opacity: [1, 0.4, 1],
    transition: {
      duration: 1,
      repeat: Number.POSITIVE_INFINITY,
      ease: "easeInOut",
    },
  },
};

const PlugZapIcon = forwardRef<PlugZapIconHandle, MotionIconProps>(
  (props, ref) => (
    <MotionIconShell ref={ref} {...props}>
      {(controls, size) => (
        <svg aria-hidden="true" {...svgBase(size)}>
          <path d="M6.3 20.3a2.4 2.4 0 0 0 3.4 0L12 18l-6-6-2.3 2.3a2.4 2.4 0 0 0 0 3.4Z" />
          <path d="m2 22 3-3" />
          <path d="M7.5 13.5 10 11" />
          <path d="M10.5 16.5 13 14" />
          <motion.path
            animate={controls}
            d="m18 3-4 4h6l-4 4"
            initial="normal"
            variants={ZAP_VARIANT}
          />
        </svg>
      )}
    </MotionIconShell>
  ),
);

PlugZapIcon.displayName = "PlugZapIcon";

export { PlugZapIcon };
