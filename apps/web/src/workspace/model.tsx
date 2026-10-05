import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { z } from "zod";
import {
  type Action,
  availableActions,
  changeRole,
  createScenario,
  invalidateFileVerification,
  type Role,
  type Scenario,
  type SimState,
  transition,
} from "../../../../packages/domain/src/prototype";
import { sampleFiles, verifySampleFiles } from "../assets";
import { workspaceRoutes } from "../route-table";

export const originalQuote = {
  name: "Still — a quieter kind of care",
  brief:
    "A considered three-image product pack for Still Studio. Warm natural tones, sculptural composition and a clear focus on the ceramic vessel. One hero, one detail and one collection image.",
  amount: 360,
};
export const quoteSchema = z.object({
  name: z.string().trim().min(5).max(80),
  brief: z.string().trim().min(20).max(500),
  amount: z.coerce.number().int().min(1).max(5000),
});
export const scenarios: { value: Scenario; label: string }[] = [
  { value: "review", label: "Delivery ready to review" },
  { value: "fresh", label: "Start with the quote" },
  { value: "dispute", label: "Dispute needs a decision" },
  { value: "expired", label: "Payment hold expired" },
  { value: "pending", label: "Outcome unknown" },
  { value: "lost-capability", label: "Capability unavailable" },
];
export const roleNames: Record<Role, string> = {
  buyer: "Alex · Still Studio",
  merchant: "North Studio",
  operator: "Resolution operator",
};
/** UI action labels — total map so a missing label fails typecheck. */
export const actionLabels: Record<Action, string> = {
  ready: "Prepare this device",
  "verify-recovery": "Verify the recovery kit",
  authorize: "Authorize payment hold",
  deploy: "Deploy the bootstrap",
  reserve: "Reserve the terms",
  accept: "Accept the order",
  submit: "Submit the delivery",
  verify: "Check the three files",
  approve: "Approve the delivery",
  dispute: "Open a sample dispute",
  "resolve-approve": "Resolve: approve delivery",
  "resolve-cancel": "Resolve: cancel order",
  cancel: "Cancel reservation",
  decline: "Decline the scope",
  "advance-deadline": "Advance the sample clock",
  capture: "Capture payment",
  void: "Release the hold",
  "expire-hold": "Mark hold expired",
  reconcile: "Recheck the outcome",
  restore: "Restore capability locally",
  "lose-capability": "Lose capability",
  "mark-unknown": "Mark outcome unknown",
};

type WorkspaceModal =
  | "approve"
  | "dispute"
  | "resolve-approve"
  | "resolve-cancel"
  | "submit"
  | "reserve"
  | "accept"
  | { kind: "image"; index: number }
  | null;

/** Per-route document titles; matched most-specific first. */
export function routeTitle(pathname: string): string {
  const path = pathname.replace(/\/+$/, "") || "/";
  const exact: Record<string, string> = Object.fromEntries(
    workspaceRoutes.map((route) => [route.path, route.title]),
  );
  if (exact[path]) return `Milo — ${exact[path]}`;
  if (/^\/orders\/sample-001\/receipt$/.test(path))
    return "Milo — Sample receipt";
  if (/^\/orders\/sample-001$/.test(path)) return "Milo — Sample order";
  if (/^\/quotes\/sample-001$/.test(path)) return "Milo — Sample agreement";
  if (/^\/operator\/cases\/sample-001$/.test(path))
    return "Milo — Sample resolution case";
  return "Milo — Page not found";
}

const roles: Role[] = ["buyer", "merchant", "operator"];

/** Deep links: ?scenario=review&role=buyer restore a sample state on refresh. */
function parseDeepLink(params: URLSearchParams): {
  scenario: Scenario;
  role: Role | null;
} {
  const scenarioParam = params.get("scenario") ?? "";
  const roleParam = params.get("role") ?? "";
  return {
    scenario: scenarios.some((s) => s.value === scenarioParam)
      ? (scenarioParam as Scenario)
      : "review",
    role: roles.includes(roleParam as Role) ? (roleParam as Role) : null,
  };
}

export function useModel() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [initial] = useState(() => parseDeepLink(searchParams));
  const [state, setState] = useState(() => {
    const base = createScenario(initial.scenario);
    return initial.role ? changeRole(base, initial.role) : base;
  });
  // Latest committed state, read by async closures as a staleness guard;
  // written only inside commit() so the mirror cannot diverge.
  const latestState = useRef(state);
  // The deep link this model is currently showing. Every write the model makes
  // records it here, so the restore effect below can tell a link the model did
  // not produce from one it wrote itself.
  const appliedLink = useRef(initial);
  const [quote, setQuote] = useState(originalQuote);
  const [scenario, setScenario] = useState<Scenario>(initial.scenario);
  const [notice, setNotice] = useState("");
  const [checking, setChecking] = useState(false);
  const [fileCheckError, setFileCheckError] = useState("");
  const [modal, updateModal] = useState<WorkspaceModal>(null);
  const [consent, setConsent] = useState(false);
  const [reason, setReason] = useState("");
  const [tab, setTab] = useState("delivery");
  const generation = useRef(0);
  const request = useRef<AbortController | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const mainHeading = useRef<HTMLHeadingElement>(null);
  const modalOrigin = useRef<HTMLElement | null>(null);
  function setModal(value: WorkspaceModal) {
    if (value && !modal && document.activeElement instanceof HTMLElement) {
      modalOrigin.current = document.activeElement;
    }
    updateModal(value);
  }
  const money = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(quote.amount);
  const actions = availableActions(state);
  const can = (action: Action) => actions.includes(action);

  function commit(next: SimState) {
    latestState.current = next;
    setState(next);
  }
  function invalidate() {
    generation.current++;
    request.current?.abort();
    setChecking(false);
    setModal(null);
    setConsent(false);
    setNotice("");
  }
  function syncDeepLink(nextScenario: Scenario, nextRole: Role) {
    appliedLink.current = { scenario: nextScenario, role: nextRole };
    setSearchParams(
      { scenario: nextScenario, role: nextRole },
      { replace: true },
    );
  }
  function reset(value: Scenario, nextQuote = originalQuote) {
    invalidate();
    setScenario(value);
    setQuote(nextQuote);
    setTab("delivery");
    const next = createScenario(value);
    commit(next);
    syncDeepLink(value, next.role);
  }
  function chooseRole(role: Role) {
    invalidate();
    commit(changeRole(latestState.current, role));
    syncDeepLink(scenario, role);
  }
  function act(action: Action) {
    try {
      commit(transition(latestState.current, action));
      setNotice(
        `${actionLabels[action] ?? "Sample updated"} (simulation only).`,
      );
      setModal(null);
      setConsent(false);
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "That action is not available.",
      );
    }
  }
  async function checkFiles() {
    commit(invalidateFileVerification(latestState.current));
    const current = ++generation.current;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setChecking(true);
    setNotice("Checking file…");
    try {
      const ids = await verifySampleFiles(controller.signal);
      if (generation.current !== current) return;
      commit(
        transition(latestState.current, "verify", { verifiedFileIds: ids }),
      );
      setFileCheckError("");
      setNotice("All three files match the submitted manifest.");
    } catch (error) {
      if (generation.current === current) {
        // Persistent state, not a transient toast (04 §8.1/§10).
        const message =
          error instanceof Error
            ? error.message
            : "Could not check these files.";
        setFileCheckError(message);
        setNotice(message);
      }
    } finally {
      if (generation.current === current) setChecking(false);
    }
  }
  useEffect(() => () => request.current?.abort(), []);
  // A deep link is a full state restore on a client-side navigation as well as
  // on a cold load. Reading it once in a useState initializer left the URL and
  // the screen disagreeing until a reload (I140). Only a URL carrying its own
  // scenario restores, and only when it differs from the link this model last
  // wrote, so reset() and chooseRole() never re-apply their own writes.
  // The body inlines invalidate() and commit() rather than calling them, so the
  // effect depends only on the search string and on stable setters and refs.
  useEffect(() => {
    if (!searchParams.has("scenario")) return;
    const requested = parseDeepLink(searchParams);
    if (
      requested.scenario === appliedLink.current.scenario &&
      requested.role === appliedLink.current.role
    ) {
      return;
    }
    appliedLink.current = requested;
    generation.current++;
    request.current?.abort();
    setChecking(false);
    updateModal(null);
    setConsent(false);
    setNotice("");
    setScenario(requested.scenario);
    setQuote(originalQuote);
    setTab("delivery");
    const base = createScenario(requested.scenario);
    const next = requested.role ? changeRole(base, requested.role) : base;
    latestState.current = next;
    setState(next);
  }, [searchParams]);
  // The heading is announced on a real route change only. Focusing it on the
  // first render moved the browser's sequential-focus starting point into main
  // content, so the first Tab after a cold load walked the page body and never
  // reached aside.sidebar's skip link (B1-F038N).
  const announcedPath = useRef<string | null>(null);
  useEffect(() => {
    document.title = routeTitle(location.pathname);
    const previous = announcedPath.current;
    announcedPath.current = location.pathname;
    if (previous !== null && previous !== location.pathname) {
      mainHeading.current?.focus();
    }
  }, [location.pathname]);

  function exportReceipt() {
    const data = {
      environment: "synthetic-ui-prototype",
      notAChainReceipt: true,
      order: "sample-001",
      quote,
      phase: state.phase,
      payment: state.payment,
      sampleBytesChecked: state.filesVerified,
      revision: state.revision,
      files: sampleFiles.map(({ name, hash }) => ({ name, sha256: hash })),
      limitations: [
        "No real authentication, wallet, proof, chain transaction or payment.",
        "Sample file digests are pinned locally, not committed to Midnight.",
        "No customer data or private-state backup is included.",
      ],
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "milo-sample-receipt.json";
    anchor.click();
    // Deferred past download initiation; the URL is per-export and the page
    // is short-lived, so a single deferred revoke is sufficient.
    setTimeout(() => URL.revokeObjectURL(url), 0);
    setNotice("Receipt downloaded — not blockchain or payment evidence.");
  }
  return {
    state,
    quote,
    setQuote,
    scenario,
    setScenario,
    notice,
    checking,
    fileCheckError,
    modal,
    setModal,
    consent,
    setConsent,
    reason,
    setReason,
    tab,
    setTab,
    navigate,
    mainHeading,
    modalOrigin,
    money,
    can,
    commit,
    invalidate,
    reset,
    chooseRole,
    act,
    checkFiles,
    exportReceipt,
  };
}

export type WorkspaceModel = ReturnType<typeof useModel>;

export const WorkspaceContext = createContext<WorkspaceModel | null>(null);

export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("Missing prototype workspace context");
  return value;
}
