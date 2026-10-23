export type Role = "buyer" | "merchant" | "operator";
export type Phase =
  | "DRAFT"
  | "DEPLOYED"
  | "RESERVED"
  | "ACCEPTED"
  | "SUBMITTED"
  | "DISPUTED"
  | "APPROVED"
  | "CANCELLED";
export type Payment =
  | "none"
  | "authorized"
  | "captured"
  | "voided"
  | "expired"
  | "failed";
export type Scenario =
  | "fresh"
  | "review"
  | "dispute"
  | "expired"
  | "pending"
  | "lost-capability";

export const ACTION_NAMES = [
  "ready",
  "verify-recovery",
  "authorize",
  "deploy",
  "reserve",
  "accept",
  "submit",
  "verify",
  "approve",
  "dispute",
  "resolve-approve",
  "resolve-cancel",
  "cancel",
  "decline",
  "advance-deadline",
  "capture",
  "void",
  "expire-hold",
  "reconcile",
  "restore",
  "lose-capability",
  "mark-unknown",
] as const;

export type ActionName = (typeof ACTION_NAMES)[number];

export type Action = ActionName;

export interface ActionPayload {
  verifiedFileIds?: string[];
}

export interface SimEvent {
  id: string;
  label: string;
  detail: string;
}

export interface SimState {
  phase: Phase;
  payment: Payment;
  role: Role;
  ready: boolean;
  filesVerified: boolean;
  outcomeUnknown: boolean;
  capabilityAvailable: boolean;
  deliverySubmitted: boolean;
  recoveryVerified: boolean;
  revision: number;
  events: SimEvent[];
}

export const SYNTHETIC_ORDER_FIXTURE = {
  quote: { amountMinor: 36_000, currency: "USD", merchant: "North Studio" },
  files: [
    { id: "01", name: "01-still-hero.png" },
    { id: "02", name: "02-still-detail.png" },
    { id: "03", name: "03-still-collection.png" },
  ],
} as const;

const FILE_IDS = SYNTHETIC_ORDER_FIXTURE.files.map((file) => file.id);

const seed = (
  phase: Phase,
  payment: Payment,
  role: Role,
  overrides?: Partial<Omit<SimState, "events">>,
): Omit<SimState, "events"> => ({
  phase,
  payment,
  role,
  ready: true,
  filesVerified: false,
  outcomeUnknown: false,
  capabilityAvailable: true,
  deliverySubmitted: true,
  recoveryVerified: true,
  revision: 0,
  ...overrides,
});

const scenarios: Record<Scenario, Omit<SimState, "events">> = {
  fresh: seed("DRAFT", "none", "buyer", {
    ready: false,
    deliverySubmitted: false,
    recoveryVerified: false,
  }),
  review: seed("SUBMITTED", "authorized", "buyer"),
  dispute: seed("DISPUTED", "authorized", "operator"),
  expired: seed("SUBMITTED", "expired", "buyer"),
  pending: seed("APPROVED", "authorized", "operator", {
    filesVerified: true,
    outcomeUnknown: true,
  }),
  "lost-capability": seed("DEPLOYED", "authorized", "buyer", {
    capabilityAvailable: false,
    deliverySubmitted: false,
  }),
};

export function createScenario(scenario: Scenario): SimState {
  return {
    ...scenarios[scenario],
    events: [
      {
        id: "event-0",
        label: "Synthetic scenario",
        detail: `${scenario} fixture; no real order, payment, or chain effect.`,
      },
    ],
  };
}

const DESCRIPTIONS: Record<ActionName, string> = {
  ready: "Confirm simulated prerequisites",
  "verify-recovery": "Verify recovery kit",
  authorize: "Authorize synthetic payment hold",
  deploy: "Deploy synthetic order",
  reserve: "Reserve order",
  accept: "Accept order",
  submit: "Submit three-image delivery",
  verify: "Verify supplied file receipts",
  approve: "Approve delivery",
  dispute: "Open dispute",
  "resolve-approve": "Resolve dispute for approval",
  "resolve-cancel": "Resolve dispute by cancellation",
  cancel: "Cancel reserved order",
  decline: "Decline reserved order",
  "advance-deadline": "Advance synthetic deadline",
  capture: "Reconcile capture",
  void: "Reconcile void",
  "expire-hold": "Mark hold expired",
  reconcile: "Reconcile unknown outcome",
  restore: "Restore synthetic capability",
  "lose-capability": "Lose synthetic capability",
  "mark-unknown": "Mark outcome unknown",
};

export function actionDescription(action: Action): string {
  return action === "ready" ? DESCRIPTIONS.ready : DESCRIPTIONS[action];
}

export function changeRole(state: SimState, role: Role): SimState {
  if (!isRole(role))
    throw new Error("Cannot change role: unsupported synthetic role");
  if (state.role === role) return copy(state);
  return apply(
    state,
    "Role changed",
    `Synthetic role switch to ${role}; it does not authenticate a real actor.`,
    { role, ready: false, filesVerified: false, recoveryVerified: false },
  );
}

export function invalidateFileVerification(state: SimState): SimState {
  if (!state.filesVerified) return copy(state);
  return apply(
    state,
    "Sample byte check invalidated",
    "A new check must finish before approval.",
    { filesVerified: false },
  );
}

export function availableActions(state: SimState): Action[] {
  return ACTION_NAMES.filter((action) => {
    try {
      transition(
        state,
        action,
        action === "verify" ? { verifiedFileIds: [...FILE_IDS] } : undefined,
      );
      return true;
    } catch {
      return false;
    }
  });
}

type Check = (state: SimState, action: Action, payload?: ActionPayload) => void;

const guard = (action: Action, condition: unknown, message: string): void => {
  if (!condition) throw new Error(`Cannot ${action}: ${message}`);
};

const all =
  (...checks: Check[]): Check =>
  (state, action, payload) => {
    for (const check of checks) check(state, action, payload);
  };

const asRole =
  (role: Role): Check =>
  (state, action) =>
    guard(action, state.role === role, `${role} role required`);

const inPhase =
  (phase: Phase): Check =>
  (state, action) =>
    guard(action, state.phase === phase, `${phase} phase required`);

const holdsPayment =
  (payment: Payment): Check =>
  (state, action) =>
    guard(
      action,
      state.payment === payment,
      `${payment} payment hold required`,
    );

const capable: Check = (state, action) =>
  guard(action, state.capabilityAvailable, "synthetic capability unavailable");

const known: Check = (state, action) =>
  guard(action, !state.outcomeUnknown, "outcome must be reconciled first");

const actionable = all(capable, known);

const DEADLINE_PHASES: Partial<Record<Phase, Phase>> = {
  DEPLOYED: "CANCELLED",
  RESERVED: "CANCELLED",
  ACCEPTED: "CANCELLED",
  SUBMITTED: "DISPUTED",
  DISPUTED: "CANCELLED",
};

const DEADLINE_DETAIL =
  "Deadline reached; awaiting the applicable action. Synthetic advance only — no clock, network action, or automatic external effect occurred.";

interface Rule {
  check: Check;
  detail: string | ((state: SimState) => string);
  changes?: Partial<SimState>;
  resolve?: (state: SimState) => SimState;
}

const rule = (
  check: Check,
  detail: Rule["detail"],
  changes?: Partial<SimState>,
): Rule => ({ check, detail, changes });

const RULES: Record<ActionName, Rule> = {
  ready: rule(
    all(
      asRole("buyer"),
      (s, a) =>
        guard(
          a,
          s.phase === "DRAFT" || s.phase === "DEPLOYED",
          "DRAFT or DEPLOYED phase required",
        ),
      (s, a) => guard(a, !s.ready, "simulated prerequisites already ready"),
      actionable,
    ),
    "Synthetic prerequisites marked ready.",
    { ready: true },
  ),
  "verify-recovery": rule(
    all(
      asRole("buyer"),
      inPhase("DRAFT"),
      actionable,
      (s, a) => guard(a, s.ready, "device preparation required first"),
      (s, a) => guard(a, !s.recoveryVerified, "recovery kit already verified"),
    ),
    "Synthetic recovery kit verified locally; no bytes leave this browser.",
    { recoveryVerified: true },
  ),
  authorize: rule(
    all(
      asRole("buyer"),
      inPhase("DRAFT"),
      (s, a) => guard(a, s.ready, "simulated prerequisites not ready"),
      (s, a) =>
        guard(
          a,
          s.recoveryVerified,
          "verified recovery kit required before the hold",
        ),
      (s, a) =>
        guard(
          a,
          s.payment === "none",
          "payment hold already has a terminal or authorized state",
        ),
      actionable,
    ),
    "Synthetic payment hold authorized; no provider was contacted.",
    { payment: "authorized" },
  ),
  deploy: rule(
    all(
      asRole("buyer"),
      inPhase("DRAFT"),
      (s, a) => guard(a, s.ready, "simulated prerequisites not ready"),
      holdsPayment("authorized"),
      actionable,
    ),
    "Synthetic order moved to DEPLOYED; no chain transaction was sent. A real bootstrap is staged and multi-transaction today.",
    { phase: "DEPLOYED" },
  ),
  reserve: rule(
    all(
      asRole("buyer"),
      inPhase("DEPLOYED"),
      (s, a) => guard(a, s.ready, "simulated prerequisites not ready"),
      holdsPayment("authorized"),
      actionable,
    ),
    "Synthetic order reserved.",
    { phase: "RESERVED" },
  ),
  accept: rule(
    all(
      asRole("merchant"),
      inPhase("RESERVED"),
      holdsPayment("authorized"),
      actionable,
    ),
    "Synthetic merchant acceptance recorded.",
    { phase: "ACCEPTED" },
  ),
  submit: rule(
    all(asRole("merchant"), inPhase("ACCEPTED"), actionable),
    "Synthetic immutable delivery submission recorded.",
    { phase: "SUBMITTED", deliverySubmitted: true },
  ),
  verify: rule(
    all(
      asRole("buyer"),
      inPhase("SUBMITTED"),
      actionable,
      (s, a) => guard(a, !s.filesVerified, "file receipts already verified"),
      (_s, a, payload) =>
        guard(
          a,
          sameFileIds(payload),
          "all three synthetic file receipt IDs (01, 02, 03) are required",
        ),
    ),
    "Sample file receipt IDs recorded. The UI separately compares downloaded SHA-256 digests; no chain commitment is verified.",
    { filesVerified: true },
  ),
  approve: rule(
    all(
      asRole("buyer"),
      inPhase("SUBMITTED"),
      holdsPayment("authorized"),
      actionable,
      (s, a) => guard(a, s.filesVerified, "verified file receipts required"),
    ),
    "Synthetic approval recorded; payment remains separately authorized.",
    { phase: "APPROVED" },
  ),
  dispute: rule(
    all(
      (s, a) =>
        guard(
          a,
          (s.role === "buyer" &&
            (s.phase === "SUBMITTED" || s.phase === "ACCEPTED")) ||
            (s.role === "merchant" && s.phase === "ACCEPTED"),
          "dispute requires buyer in SUBMITTED or either party in ACCEPTED",
        ),
      actionable,
    ),
    (state) => `Synthetic ${state.role} dispute opened.`,
    { phase: "DISPUTED" },
  ),
  "resolve-approve": rule(
    all(asRole("operator"), inPhase("DISPUTED"), actionable, (s, a) =>
      guard(
        a,
        s.deliverySubmitted,
        "a submitted delivery is required for full approval",
      ),
    ),
    "Synthetic operator resolved for full approval; payment remains separate.",
    { phase: "APPROVED" },
  ),
  "resolve-cancel": rule(
    all(asRole("operator"), inPhase("DISPUTED"), actionable),
    "Synthetic operator resolved for full cancellation; payment remains separate.",
    { phase: "CANCELLED" },
  ),
  cancel: rule(
    all(asRole("buyer"), inPhase("RESERVED"), actionable),
    "Synthetic reserved order cancelled.",
    { phase: "CANCELLED" },
  ),
  decline: rule(
    all(asRole("merchant"), inPhase("RESERVED"), actionable),
    "Synthetic merchant decline recorded as cancellation.",
    { phase: "CANCELLED" },
  ),
  "advance-deadline": {
    check: known,
    detail: DEADLINE_DETAIL,
    resolve: advanceDeadline,
  },
  capture: rule(
    all(
      asRole("operator"),
      inPhase("APPROVED"),
      holdsPayment("authorized"),
      actionable,
    ),
    "Synthetic capture reconciliation recorded; no payment was captured.",
    { payment: "captured" },
  ),
  void: rule(
    all(
      asRole("operator"),
      inPhase("CANCELLED"),
      holdsPayment("authorized"),
      actionable,
    ),
    "Synthetic void reconciliation recorded; no payment was voided.",
    { payment: "voided" },
  ),
  "expire-hold": rule(
    all(holdsPayment("authorized"), known),
    "Synthetic hold expiry recorded; order phase is unchanged.",
    { payment: "expired" },
  ),
  reconcile: rule(
    (s, a) => guard(a, s.outcomeUnknown, "outcome is already known"),
    "Synthetic observation reconciled; no external effect was repeated.",
    { outcomeUnknown: false },
  ),
  restore: rule(
    (s, a) =>
      guard(
        a,
        !s.capabilityAvailable,
        "synthetic capability is already available",
      ),
    "Synthetic capability restored only in this fixture.",
    { capabilityAvailable: true },
  ),
  "lose-capability": rule(capable, "Synthetic capability marked unavailable.", {
    capabilityAvailable: false,
  }),
  "mark-unknown": rule(known, "Synthetic external outcome marked unknown.", {
    outcomeUnknown: true,
  }),
};

export function transition(
  state: SimState,
  action: Action,
  payload?: ActionPayload,
): SimState {
  const rule = RULES[action];
  rule.check(state, action, payload);
  if (rule.resolve) return rule.resolve(state);
  const detail = rule.detail;
  return apply(
    state,
    DESCRIPTIONS[action],
    typeof detail === "function" ? detail(state) : detail,
    rule.changes ?? {},
  );
}

function advanceDeadline(state: SimState): SimState {
  const nextPhase = DEADLINE_PHASES[state.phase];
  if (!nextPhase)
    throw new Error(
      `Cannot advance-deadline: no pending deadline in ${state.phase}`,
    );
  return apply(state, DESCRIPTIONS["advance-deadline"], DEADLINE_DETAIL, {
    phase: nextPhase,
  });
}

function sameFileIds(payload?: ActionPayload): boolean {
  const ids = payload?.verifiedFileIds;
  return (
    Array.isArray(ids) &&
    ids.length === FILE_IDS.length &&
    new Set(ids).size === FILE_IDS.length &&
    FILE_IDS.every((id) => ids.includes(id))
  );
}

function apply(
  state: SimState,
  label: string,
  detail: string,
  changes: Partial<SimState>,
): SimState {
  const revision = state.revision + 1;
  return {
    ...state,
    ...changes,
    revision,
    events: [...state.events, { id: `event-${revision}`, label, detail }],
  };
}

function copy(state: SimState): SimState {
  return { ...state, events: state.events.map((event) => ({ ...event })) };
}

function isRole(role: unknown): role is Role {
  return role === "buyer" || role === "merchant" || role === "operator";
}
