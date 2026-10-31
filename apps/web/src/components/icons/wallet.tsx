import { motion, type Variants } from "motion/react";
import { forwardRef } from "react";
import {
  type MotionIconHandle,
  type MotionIconProps,
  MotionIconShell,
  svgBase,
} from "./motion-host";

export type WalletIconHandle = MotionIconHandle;

const VARIANTS: Variants = {
  normal: {
    y: 0,
    rotate: 0,
    transition: {
      duration: 0.3,
      ease: "easeOut",
    },
  },
  animate: {
    y: [0, -3, 0],
    rotate: [0, -4, 0],
    transition: {
      duration: 0.55,
      ease: "easeInOut",
      times: [0, 0.45, 1],
    },
  },
};

const WalletIcon = forwardRef<WalletIconHandle, MotionIconProps>(
  (props, ref) => (
    <MotionIconShell ref={ref} {...props}>
      {(controls, size) => (
        <motion.svg
          aria-hidden="true"
          {...svgBase(size)}
          animate={controls}
          initial="normal"
          variants={VARIANTS}
          style={{ transformOrigin: "12px 12px" }}
        >
          <path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1" />
          <path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" />
        </motion.svg>
      )}
    </MotionIconShell>
  ),
);

WalletIcon.displayName = "WalletIcon";

export { WalletIcon };
