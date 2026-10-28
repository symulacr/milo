import { motion, type Variants } from "motion/react";
import { forwardRef } from "react";
import {
  MotionIconShell,
  svgBase,
  type MotionIconHandle,
  type MotionIconProps,
} from "./motion-host";

export type MailCheckIconHandle = MotionIconHandle;

const CHECK_VARIANTS: Variants = {
  normal: {
    pathLength: 1,
    opacity: 1,
    transition: {
      duration: 0.3,
    },
  },
  animate: {
    pathLength: [0, 1],
    opacity: [0, 1],
    transition: {
      pathLength: { duration: 0.4, ease: "easeInOut" },
      opacity: { duration: 0.4, ease: "easeInOut" },
    },
  },
};

const MailCheckIcon = forwardRef<MailCheckIconHandle, MotionIconProps>(
  (props, ref) => (
    <MotionIconShell ref={ref} {...props}>
      {(controls, size) => (
        <svg
          {...svgBase(size)}
        >
          <path d="M22 13V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v12c0 1.1.9 2 2 2h8" />
          <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
          <motion.path
            animate={controls}
            d="m16 19 2 2 4-4"
            initial="normal"
            style={{ transformOrigin: "center" }}
            variants={CHECK_VARIANTS}
          />
        </svg>
      )}
    </MotionIconShell>
  ),
);

MailCheckIcon.displayName = "MailCheckIcon";

export { MailCheckIcon };
