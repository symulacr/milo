import { motion, type Variants } from "motion/react";
import { forwardRef } from "react";
import {
  type MotionIconHandle,
  type MotionIconProps,
  MotionIconShell,
  svgBase,
} from "./motion-host";

export type GavelIconHandle = MotionIconHandle;

const GAVEL_VARIANTS: Variants = {
  normal: {
    rotate: 0,
    transition: {
      duration: 0.3,
      ease: "easeOut",
    },
  },
  animate: {
    rotate: [0, -20, 25, 0],
    transition: {
      duration: 0.8,
      times: [0, 0.6, 0.8, 1],
      ease: ["easeInOut", "easeOut", "easeOut"],
    },
  },
};

const GavelIcon = forwardRef<GavelIconHandle, MotionIconProps>((props, ref) => (
  <MotionIconShell ref={ref} {...props}>
    {(controls, size) => (
      <motion.svg
        aria-hidden="true"
        {...svgBase(size)}
        animate={controls}
        initial="normal"
        variants={GAVEL_VARIANTS}
        style={{ transformOrigin: "0% 100%", transformBox: "fill-box" }}
      >
        <path d="m14 13-8.381 8.38a1 1 0 0 1-3.001-3l8.384-8.381" />
        <path d="m16 16 6-6" />
        <path d="m21.5 10.5-8-8" />
        <path d="m8 8 6-6" />
        <path d="m8.5 7.5 8 8" />
      </motion.svg>
    )}
  </MotionIconShell>
));

GavelIcon.displayName = "GavelIcon";

export { GavelIcon };
