import { motion, type Variants } from "motion/react";
import { forwardRef } from "react";
import {
  type MotionIconHandle,
  type MotionIconProps,
  MotionIconShell,
  svgBase,
} from "./motion-host";

export type HourglassIconHandle = MotionIconHandle;

const HourglassIcon = forwardRef<HourglassIconHandle, MotionIconProps>(
  (props, ref) => (
    <MotionIconShell ref={ref} {...props}>
      {(controls, size) => (
        <svg aria-hidden="true" {...svgBase(size)}>
          <motion.g
            animate={controls}
            style={{
              transformOrigin: "12px 12px",
            }}
            transition={{
              type: "spring",
              stiffness: 100,
              damping: 15,
              mass: 1,
            }}
            variants={{
              normal: {
                rotate: 0,
              },
              animate: {
                rotate: 180,
              },
            }}
          >
            <path d="M5 22h14" />
            <path d="M5 2h14" />
            <path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22" />
            <path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2" />
          </motion.g>
        </svg>
      )}
    </MotionIconShell>
  ),
);

HourglassIcon.displayName = "HourglassIcon";

export { HourglassIcon };
