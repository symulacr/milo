import { motion, type Variants } from "motion/react";
import { forwardRef } from "react";
import {
  MotionIconShell,
  svgBase,
  type MotionIconHandle,
  type MotionIconProps,
} from "./motion-host";

export type LogoutIconHandle = MotionIconHandle;

const PATH_VARIANTS: Variants = {
  animate: {
    x: 2,
    translateX: [0, -3, 0],
    transition: {
      duration: 0.4,
    },
  },
};

const LogoutIcon = forwardRef<LogoutIconHandle, MotionIconProps>(
  (props, ref) => (
    <MotionIconShell ref={ref} {...props}>
      {(controls, size) => (
        <svg
          {...svgBase(size)}
        >
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <motion.polyline
            animate={controls}
            points="16 17 21 12 16 7"
            variants={PATH_VARIANTS}
          />
          <motion.line
            animate={controls}
            variants={PATH_VARIANTS}
            x1="21"
            x2="9"
            y1="12"
            y2="12"
          />
        </svg>
      )}
    </MotionIconShell>
  ),
);

LogoutIcon.displayName = "LogoutIcon";

export { LogoutIcon };
