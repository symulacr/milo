import { Copy, Hourglass } from "lucide";
import {
  type ComponentProps,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { cn } from "../lib/utils";
import type { StepState } from "../workspace/flows";
import { Button } from "./ui/button";
import { Mark } from "./ui/status";

export type Steps = Record<string, { state: StepState; detail?: string }>;

export function StepList({
  plan,
  steps,
}: {
  plan: readonly (readonly [string, string])[];
  steps: Steps;
}) {
  return (
    <ol
      className="grid gap-2 text-sm"
      aria-label="Progress"
      style={{ minHeight: `${Math.max(plan.length, 1) * 1.75}rem` }}
    >
      {plan.map(([id, label]) => {
        const step = steps[id] ?? { state: "waiting" };
        return (
          <li
            key={id}
            data-state={step.state}
            className="grid min-h-6 grid-cols-[20px_1fr] items-start gap-x-3 transition-opacity duration-200 starting:opacity-0 data-[state=waiting]:opacity-50"
          >
            <span className="mt-0.5 flex size-5 items-center justify-center">
              {step.state === "waiting" ? (
                <span className="size-1.5 rounded-full bg-current opacity-40" />
              ) : (
                <Mark
                  status={step.state === "active" ? "working" : step.state}
                  className={cn(
                    "size-4",
                    step.state === "done" && "text-positive",
                    step.state === "failed" && "text-destructive",
                  )}
                />
              )}
            </span>
            <span className="grid">
              <span className="font-medium">{label}</span>
              {step.detail && (
                <span
                  className={
                    step.state === "failed"
                      ? "text-destructive"
                      : "text-muted-foreground"
                  }
                >
                  {step.detail}
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export const Alert = ({ className, ...props }: ComponentProps<"p">) => {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => ref.current?.scrollIntoView({ block: "nearest" }), []);
  return (
    <p
      ref={ref}
      role="alert"
      className={cn("text-sm text-destructive", className)}
      {...props}
    />
  );
};

export const Outcome = ({
  status,
  error,
}: {
  status?: string;
  error?: string;
}) =>
  error ? (
    <Alert>{error}</Alert>
  ) : status ? (
    <p role="status" className="text-sm text-positive">
      {status}
    </p>
  ) : null;

export const Note = ({ children }: { children: ReactNode }) => (
  <p className="text-sm text-muted-foreground">{children}</p>
);

const STATE = [
  ["idle", "text-muted-foreground", ""],
  ["done", "text-positive", "Copied"],
  ["failed", "text-destructive", "Copy failed"],
] as const;

export const Verdict = ({
  state,
  text,
}: {
  state: 0 | 1 | 2;
  text: readonly [string, string, string];
}) => (
  <p className={cn("flex items-center gap-2 text-sm", STATE[state][1])}>
    <Mark icon={Hourglass} status={STATE[state][0]} />
    {text[state]}
  </p>
);

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [status, setStatus] = useState<"idle" | "done" | "failed">("idle");
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      title={label}
      data-status={status}
      onClick={() => {
        // Retry from a clean state, so a failure the user fixed is not sticky.
        setStatus("idle");
        navigator.clipboard.writeText(value).then(
          () => {
            setStatus("done");
            setTimeout(() => setStatus("idle"), 1600);
          },
          () => setStatus("failed"),
        );
      }}
    >
      <Mark icon={Copy} status={status} />
      <span className="sr-only">
        {STATE[status === "done" ? 1 : status === "failed" ? 2 : 0][2]}
      </span>
    </Button>
  );
}

type Body = { code?: string; message?: string };
const FALLBACK = "The step did not complete. Try again.";
const NOISE =
  /^(?:\[CONVEX [^\]]*\]\s*|\[Request ID: [^\]]*\]\s*|Server Error:?\s*|Uncaught Error:?\s*)+|\s+at \S+(?: \([^)]*\)|:\d+)|Called by client/g;
export const CODE_TEXT: Record<string, string> = {
  UNAUTHENTICATED: "Sign in again to continue.",
  FORBIDDEN:
    "You do not have access to this order. Ask the studio for a new link.",
  NOT_FOUND: "That order does not exist. Check the link, or ask the studio.",
  INVALID_INPUT: "Check the values and try again.",
  WRONG_STATE: "The order is not ready for this step. Reload the page.",
  CONFLICT: "Someone else changed this order. Reload the page.",
  PROVIDER_UNAVAILABLE: "The email service is not available. Try again later.",
  RATE_LIMITED: "Wait a minute and try again.",
};
export const errorText = (error: unknown) => {
  // A boundary hands this whatever was thrown, including null. Reading
  // `error.data` unguarded threw inside the error handler itself, so the user
  // saw nothing at all instead of the fallback sentence.
  const data = (error as { data?: string | Body } | null | undefined)?.data;
  const raw =
    (typeof data === "string" ? data : data?.message) ??
    (error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "");
  const text = raw.replace(NOISE, "").trim();
  const code = typeof data === "object" ? data?.code : undefined;
  try {
    const body = JSON.parse(text.startsWith("{") ? text : "") as Body;
    return body.message || CODE_TEXT[body.code ?? code ?? ""] || FALLBACK;
  } catch {
    // The object form of `data` never parses, so its code must be looked up
    // here too; without this a known code rendered as "[object Object]".
    return (
      (text.startsWith("[object") ? "" : text) ||
      CODE_TEXT[code ?? ""] ||
      FALLBACK
    );
  }
};
