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
    "A considered three-image product pack for Still Studio. Warm natural tones, sculptural composition, one hero, one detail and one collection image.",
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

export type ModalReturn = "approve" | null;

export type FileResults = Record<string, "ok" | "fail" | "pending">;

type RoleFlags = {
  ready: boolean;
  recoveryVerified: boolean;
  filesVerified: boolean;
};

const FILE_SLOTS = ["01", "02", "03"] as const;

const allSlots = (state: "ok" | "fail" | "pending"): FileResults =>
  Object.fromEntries(FILE_SLOTS.map((slot) => [slot, state]));

const TITLED: Record<string, string> = Object.fromEntries(
  workspaceRoutes.map((route) => [route.path, route.title]),
);

const SAMPLE_TITLES: readonly (readonly [RegExp, string])[] = [
  [/^\/orders\/sample-001\/receipt$/, "Milo — Sample receipt"],
  [/^\/orders\/sample-001$/, "Milo — Sample order"],
  [/^\/quotes\/sample-001$/, "Milo — Sample agreement"],
  [/^\/operator\/cases\/sample-001$/, "Milo — Sample resolution case"],
];

export function routeTitle(pathname: string): string {
  const path = pathname.replace(/\/+$/, "") || "/";
  const titled = TITLED[path];
  if (titled) return `Milo — ${titled}`;
  for (const [pattern, title] of SAMPLE_TITLES) {
    if (pattern.test(path)) return title;
  }
  return "Milo — Page not found";
}

const ROLES: readonly Role[] = ["buyer", "merchant", "operator"];
const SCENARIO_VALUES: ReadonlySet<string> = new Set(
  scenarios.map((s) => s.value),
);

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const DEFAULT_DISPUTE_REASON =
  "Second image colorway does not match agreed brief.";

function parseDeepLink(params: URLSearchParams): {
  scenario: Scenario;
  role: Role | null;
} {
  const scenarioParam = params.get("scenario") ?? "";
  const roleParam = params.get("role") ?? "";
  return {
    scenario: SCENARIO_VALUES.has(scenarioParam)
      ? (scenarioParam as Scenario)
      : "review",
    role: ROLES.includes(roleParam as Role) ? (roleParam as Role) : null,
  };
}

export function useModel() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [initial] = useState(() => parseDeepLink(searchParams));
  const [state, setState] = useState(() => {
    const base = createScenario(initial.scenario);
    return initial.role ? changeRole(base, initial.role) : base;
  });
  const latestState = useRef(state);
  const [quote, setQuote] = useState(originalQuote);
  const [scenario, setScenario] = useState<Scenario>(initial.scenario);
  const [notice, setNotice] = useState("");
  const [checking, setChecking] = useState(false);
  const [fileCheckError, setFileCheckError] = useState("");
  const [modal, updateModal] = useState<WorkspaceModal>(null);
  const [consent, setConsent] = useState(false);
  const [reason, setReasonState] = useState("");
  const reasonRef = useRef("");
  const setReason = useCallback((value: string) => {
    reasonRef.current = value;
    setReasonState(value);
  }, []);
  const [disputeReason, setDisputeReason] = useState(DEFAULT_DISPUTE_REASON);
  const [fileResults, setFileResults] = useState<FileResults>({});
  const [modalReturn, setModalReturn] = useState<ModalReturn>(null);
  const [tab, setTab] = useState("delivery");
  const generation = useRef(0);
  const request = useRef<AbortController | null>(null);
  const roleFlags = useRef<Partial<Record<Role, RoleFlags>>>({});
  const navigate = useNavigate();
  const location = useLocation();
  const mainHeading = useRef<HTMLHeadingElement>(null);
  const headingMounted = useRef(false);
  const modalOrigin = useRef<HTMLElement | null>(null);
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
      setDisputeReason(DEFAULT_DISPUTE_REASON);
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
      roleFlags.current[current.role] = {
        ready: current.ready,
        recoveryVerified: current.recoveryVerified,
        filesVerified: current.filesVerified,
      };
      const switched = changeRole(current, role);
      const saved = roleFlags.current[role];
      commit(saved ? { ...switched, ...saved } : switched);
      syncDeepLink(scenario, role);
    },
    [commit, invalidate, scenario, syncDeepLink],
  );
  const act = useCallback(
    (action: Action): boolean => {
      if (request.current) cancelFileCheck();
      try {
        commit(transition(latestState.current, action));
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
    setFileResults(allSlots("pending"));
    try {
      const ids = await verifySampleFiles(controller.signal);
      if (generation.current !== current) return;
      commit(
        transition(latestState.current, "verify", { verifiedFileIds: ids }),
      );
      setFileCheckError("");
      setNotice("All three files match the submitted manifest.");
      setFileResults(allSlots("ok"));
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (generation.current === current) {
        const message =
          error instanceof Error
            ? error.message
            : "Could not check these files.";
        setFileCheckError(message);
        setNotice(message);
        setFileResults(allSlots("fail"));
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
  useEffect(() => {
    const params = new URLSearchParams(linkKey);
    if (!params.has("scenario") || linkKey === appliedLink.current) return;
    appliedLink.current = linkKey;
    const link = parseDeepLink(params);
    reset(link.scenario, originalQuote, link.role ?? undefined);
  }, [linkKey, reset]);
  useEffect(() => {
    document.title = routeTitle(location.pathname);
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
    setTimeout(() => URL.revokeObjectURL(url), 0);
    setNotice("Receipt downloaded — not blockchain or payment evidence.");
  }, [quote, state.phase, state.payment, state.filesVerified, state.revision]);
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
