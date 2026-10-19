import type { ReactNode, SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function Svg({ children, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className="svg-icon"
      {...props}
    >
      {children}
    </svg>
  );
}

export const CheckIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.5 10.5l3.5 3.5 7.5-8" />
  </Svg>
);
export const XIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" />
  </Svg>
);
export const AlertIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 3.5l7 12.5H3L10 3.5z" />
    <path d="M10 8.5v3.5M10 14.25v.01" />
  </Svg>
);
export const ShieldIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 2.75l6 2.25v4.5c0 3.75-2.5 6.5-6 7.75-3.5-1.25-6-4-6-7.75V5l6-2.25z" />
  </Svg>
);
export const FileIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5.5 2.75h6l3 3v11.5h-9V2.75z" />
    <path d="M11.5 2.75v3h3M7.75 10.5h4.5M7.75 13.5h4.5" />
  </Svg>
);
export const InboxIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 11l2-6.5h10L17 11v5H3v-5z" />
    <path d="M3 11h4l1 2h4l1-2h4" />
  </Svg>
);
export const FlagIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 17.5V3M5 3.5h9l-2 3.5 2 3.5H5" />
  </Svg>
);
export const PlugIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7.5 2.75V6M12.5 2.75V6M5.5 6h9v3a4.5 4.5 0 01-9 0V6zM10 13.5v3.75" />
  </Svg>
);
export const ArrowUpRightIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6.5 13.5l7-7M7.5 6.5h6v6" />
  </Svg>
);
