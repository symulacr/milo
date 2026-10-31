import { motion, type Variants } from "motion/react";
import { forwardRef } from "react";
import {
  type MotionIconHandle,
  type MotionIconProps,
  MotionIconShell,
  svgBase,
} from "./motion-host";

export type MailboxIconHandle = MotionIconHandle;

const FLAG_VARIANTS: Variants = {
  normal: {
    rotate: 0,
    transition: {
      type: "spring",
      stiffness: 300,
      damping: 18,
    },
  },
  animate: {
    rotate: -90,
    transition: {
      type: "spring",
      stiffness: 280,
      damping: 12,
      mass: 1,
    },
  },
};

const MailboxIcon = forwardRef<MailboxIconHandle, MotionIconProps>(
  (props, ref) => (
    <MotionIconShell ref={ref} {...props}>
      {(controls, size) => (
        <svg aria-hidden="true" {...svgBase(size)}>
          <path d="M22 17a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9.5C2 7 4 5 6.5 5H18c2.2 0 4 1.8 4 4v8Z" />
          <motion.path
            animate={controls}
            d="M18 11V9H15"
            initial="normal"
            style={{ transformOrigin: "18px 11px" }}
            variants={FLAG_VARIANTS}
          />
          <path d="M6.5 5C9 5 11 7 11 9.5V17a2 2 0 0 1-2 2" />
          <line x1="6" x2="7" y1="10" y2="10" />
        </svg>
      )}
    </MotionIconShell>
  ),
);

MailboxIcon.displayName = "MailboxIcon";

export { MailboxIcon };
