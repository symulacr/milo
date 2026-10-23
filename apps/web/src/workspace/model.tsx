import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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

const originalQuote = {
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
  | "decline"
  | "cancel"
  | "deploy"
  | { kind: "image"; index: number }
  | null;

/** Which dialog opened the current one, so a nested dialog can offer Back. */
export type ModalReturn = "approve" | null;

/** Per-file SHA-256 check results for the 3-slot verification strip. */
export type FileResults = Record<string, "ok" | "fail" | "pending">;

/** The three setup checks that survive a perspective switch. */
type RoleFlags = {
  ready: boolean;
  recoveryVerified: boolean;
  filesVerified: boolean;
};

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

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

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
  const [quote, setQuote] = useState(originalQuote);
  const [scenario, setScenario] = useState<Scenario>(initial.scenario);
  const [notice, setNotice] = useState("");
  const [checking, setChecking] = useState(false);
  const [fileCheckError, setFileCheckError] = useState("");
  const [modal, updateModal] = useState<WorkspaceModal>(null);
  const [consent, setConsent] = useState(false);
  const [reason, setReasonState] = useState("");
  // Mirrors `reason` so `act` stays referentially stable while typing.
  const reasonRef = useRef("");
  const setReason = useCallback((value: string) => {
    reasonRef.current = value;
    setReasonState(value);
  }, []);
  const [disputeReason, setDisputeReason] = useState(
    "Second image colorway does not match agreed brief.",
  );
  const [fileResults, setFileResults] = useState<FileResults>({});
  const [modalReturn, setModalReturn] = useState<ModalReturn>(null);
  const [tab, setTab] = useState("delivery");
  const generation = useRef(0);
  const request = useRef<AbortController | null>(null);
  // Setup checks are per-role, so a perspective switch parks them here and
  // restores them when the user comes back (see chooseRole).
  const roleFlags = useRef<Partial<Record<Role, RoleFlags>>>({});
  const navigate = useNavigate();
  const location = useLocation();
  const mainHeading = useRef<HTMLHeadingElement>(null);
  // Distinguishes the first mount from a later route change, so the heading is focused
  // only when the user navigated (see the title effect below).
  const headingMounted = useRef(false);
  const modalOrigin = useRef<HTMLElement | null>(null);
  // Mirrors `modal` so setModal can stay referentially stable; only setModal
  // writes the modal, so the mirror cannot diverge.
  const modalRef = useRef<WorkspaceModal>(null);
  const setModal = useCallback((value: WorkspaceModal) => {
    if (
      value &&
      !modalRef.current &&
      document.activeElement instanceof HTMLElement
    ) {
      modalOrigin.current = document.activeElement;
    }
    modalRef.current = value;
    updateModal(value);
  }, []);
  const money = usd.format(quote.amount);
  const actions = useMemo(() => new Set(availableActions(state)), [state]);
  const can = useCallback((action: Action) => actions.has(action), [actions]);

  const commit = useCallback((next: SimState) => {
    latestState.current = next;
    setState(next);
  }, []);
  const cancelFileCheck = useCallback(() => {
    generation.current++;
    request.current?.abort();
    request.current = null;
    setChecking(false);
  }, []);
  const invalidate = useCallback(() => {
    cancelFileCheck();
    setModal(null);
    setConsent(false);
    setNotice("");
  }, [cancelFileCheck, setModal]);
  // Query string last applied or written by the model, so our own URL writes
  // do not re-trigger the deep-link effect.
  const appliedLink = useRef(searchParams.toString());
  const syncDeepLink = useCallback(
    (nextScenario: Scenario, nextRole: Role) => {
      const params = new URLSearchParams({
        scenario: nextScenario,
        role: nextRole,
      });
      appliedLink.current = params.toString();
      setSearchParams(params, { replace: true });
    },
    [setSearchParams],
  );
  const reset = useCallback(
    (value: Scenario, nextQuote = originalQuote, role?: Role) => {
      invalidate();
      roleFlags.current = {};
      setScenario(value);
      setQuote(nextQuote);
      setTab("delivery");
      setDisputeReason("Second image colorway does not match agreed brief.");
      setFileResults({});
      setModalReturn(null);
      setReason("");
      const base = createScenario(value);
      const next = role && role !== base.role ? changeRole(base, role) : base;
      commit(next);
      syncDeepLink(value, next.role);
    },
    [commit, invalidate, setReason, syncDeepLink],
  );
  const chooseRole = useCallback(
    (role: Role) => {
      invalidate();
      const current = latestState.current;
      // Park the outgoing role's setup checks so switching perspectives is
      // never a silent loss of progress, then restore the target role's.
      roleFlags.current[current.role] = {
        ready: current.ready,
        recoveryVerified: current.recoveryVerified,
        filesVerified: current.filesVerified,
      };
      const switched = changeRole(current, role);
      const saved = roleFlags.current[role];
      commit(
        saved
          ? {
              ...switched,
              ready: saved.ready,
              recoveryVerified: saved.recoveryVerified,
              filesVerified: saved.filesVerified,
            }
          : switched,
      );
      syncDeepLink(scenario, role);
    },
    [commit, invalidate, scenario, syncDeepLink],
  );
  const act = useCallback(
    (action: Action): boolean => {
      // A state change makes any in-flight check stale; let it finish silently
      // instead of reporting a spurious failure.
      if (request.current) cancelFileCheck();
      try {
        commit(transition(latestState.current, action));
        // Keep the submitted dispute reason so the operator desk and the order
        // view can show what the buyer actually wrote.
        const submitted = reasonRef.current.trim();
        if (action === "dispute" && submitted.length >= 10)
          setDisputeReason(submitted);
        setNotice(
          `${actionLabels[action] ?? "Sample updated"} (simulation only).`,
        );
        setModal(null);
        setConsent(false);
        setReason("");
        setModalReturn(null);
        return true;
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "That action is not available.",
        );
        return false;
      }
    },
    [cancelFileCheck, commit, setModal, setReason],
  );
  const checkFiles = useCallback(async () => {
    commit(invalidateFileVerification(latestState.current));
    const current = ++generation.current;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setChecking(true);
    setNotice("Checking file…");
    setFileResults({ "01": "pending", "02": "pending", "03": "pending" });
    try {
      const ids = await verifySampleFiles(controller.signal);
      if (generation.current !== current) return;
      commit(
        transition(latestState.current, "verify", { verifiedFileIds: ids }),
      );
      setFileCheckError("");
      setNotice("All three files match the submitted manifest.");
      // Three-slot strip: every pinned digest matched, so every slot is ok.
      setFileResults({ "01": "ok", "02": "ok", "03": "ok" });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (generation.current === current) {
        // Persistent state, not a transient toast (04 §8.1/§10).
        const message =
          error instanceof Error
            ? error.message
            : "Could not check these files.";
        setFileCheckError(message);
        setNotice(message);
        setFileResults({ "01": "fail", "02": "fail", "03": "fail" });
      }
    } finally {
      if (generation.current === current) {
        request.current = null;
        setChecking(false);
      }
    }
  }, [commit]);
  useEffect(() => () => request.current?.abort(), []);
  const linkKey = searchParams.toString();
  // In-app links such as ?scenario=lost-capability from Account arrive after mount;
  // apply them when they differ from what the model last applied or wrote.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the query string only
  useEffect(() => {
    if (!searchParams.has("scenario") || linkKey === appliedLink.current)
      return;
    appliedLink.current = linkKey;
    const link = parseDeepLink(searchParams);
    reset(link.scenario, originalQuote, link.role ?? undefined);
  }, [linkKey]);
  useEffect(() => {
    document.title = routeTitle(location.pathname);
    // Focus the heading on NAVIGATION, not on first load: focusing it on mount moved
    // the sequential-focus start past the skip link that WorkspaceShell renders first
    // in the DOM, so the link was no longer the first tab stop (WCAG 2.2 SC 2.4.1).
    if (!headingMounted.current) {
      headingMounted.current = true;
      return;
    }
    mainHeading.current?.focus();
  }, [location.pathname]);

  const exportReceipt = useCallback(() => {
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
  }, [quote, state.phase, state.payment, state.filesVerified, state.revision]);
  // Memoized so a keystroke in `reason` only re-renders consumers that read
  // `reason` — the stable callbacks above keep the dependency list honest.
  const value = useMemo(
    () => ({
      state,
      quote,
      scenario,
      notice,
      checking,
      fileCheckError,
      modal,
      setModal,
      consent,
      setConsent,
      reason,
      setReason,
      disputeReason,
      setDisputeReason,
      fileResults,
      modalReturn,
      setModalReturn,
      tab,
      setTab,
      navigate,
      mainHeading,
      modalOrigin,
      money,
      can,
      reset,
      chooseRole,
      act,
      checkFiles,
      exportReceipt,
    }),
    [
      state,
      quote,
      scenario,
      notice,
      checking,
      fileCheckError,
      modal,
      setModal,
      consent,
      reason,
      setReason,
      disputeReason,
      fileResults,
      modalReturn,
      tab,
      navigate,
      money,
      can,
      reset,
      chooseRole,
      act,
      checkFiles,
      exportReceipt,
    ],
  );
  return value;
}

type WorkspaceModel = ReturnType<typeof useModel>;

export const WorkspaceContext = createContext<WorkspaceModel | null>(null);

export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("Missing prototype workspace context");
  return value;
}
