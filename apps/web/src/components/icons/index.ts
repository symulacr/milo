export { ArrowRightIcon } from "./arrow-right";
export { BadgeAlertIcon } from "./badge-alert";
export { BanIcon } from "./ban";
export { CheckIcon } from "./check";
export { CircleCheckIcon } from "./circle-check";
export { CircleDashedIcon } from "./circle-dashed";
export { ClockIcon } from "./clock";
export { CopyIcon } from "./copy";
export { DownloadIcon } from "./download";
export { GavelIcon } from "./gavel";
export { HourglassIcon } from "./hourglass";
export { KeyIcon } from "./key";
export { LoaderCircleIcon } from "./loader-circle";
export { LockIcon } from "./lock";
export { LogInIcon } from "./login";
export { LogoutIcon } from "./logout";
export { MailboxIcon } from "./mailbox";
export { MailCheckIcon } from "./mail-check";
export { PlusIcon } from "./plus";
export { PlugZapIcon } from "./plug-zap";
export { TimerIcon } from "./timer";
export { UndoIcon } from "./undo";
export { UploadIcon } from "./upload";
export { WalletIcon } from "./wallet";
export { XIcon } from "./x";

import type { ComponentType, HTMLAttributes } from "react";

/** Shared props for lucide-animated / itshover-style motion icons. */
export type AppIcon = ComponentType<
  HTMLAttributes<HTMLSpanElement> & {
    size?: number;
    className?: string;
  }
>;
