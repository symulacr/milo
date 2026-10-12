/**
 * LOC-reuse audit: a pure calculator over measured prototype data.
 *
 * This module holds NO source knowledge and does NO I/O. It takes the
 * measurements produced by the scratch prototypes (lines removed, dependency
 * copies removed, risk, whether the gates still pass, whether a live run is
 * needed) and ranks them, so the numbers in the accompanying report are
 * checkable arithmetic rather than prose.
 *
 * Yield model (deliberately simple and auditable):
 *   score = linesRemoved + dependencyCopiesRemoved * DEPENDENCY_WEIGHT
 *   score = score * RISK_MULTIPLIER[risk]
 * A prototype that needs a live run carries a small additional penalty, because
 * its measured lines are not yet proven at runtime.
 */

/** One removed dependency copy is worth this many removed lines. */
export const DEPENDENCY_WEIGHT = 40;

/** A live run is worth this many lines of unproven yield. */
export const RUN_PENALTY = 5;

/** Multiplier applied to raw yield, by risk band. */
export const RISK_MULTIPLIER = Object.freeze({
  low: 1,
  medium: 0.8,
  high: 0.5,
});

const RISK_BANDS = Object.keys(RISK_MULTIPLIER);

/**
 * Validate and normalise one prototype measurement. Throws on anything that
 * would make the ranking meaningless (missing id, negative lines, unknown
 * risk), so a typo cannot silently rank as zero.
 */
export function normalizePrototype(entry) {
  if (!entry || typeof entry !== "object")
    throw new TypeError("prototype entry must be an object");
  const { id, name, linesRemoved, dependencyCopiesRemoved = 0, risk } = entry;
  if (typeof id !== "string" || id.length === 0)
    throw new TypeError("prototype id must be a non-empty string");
  if (typeof name !== "string" || name.length === 0)
    throw new TypeError(`prototype ${id}: name must be a non-empty string`);
  if (!Number.isInteger(linesRemoved))
    throw new TypeError(`prototype ${id}: linesRemoved must be an integer`);
  if (!Number.isInteger(dependencyCopiesRemoved) || dependencyCopiesRemoved < 0)
    throw new TypeError(
      `prototype ${id}: dependencyCopiesRemoved must be a non-negative integer`,
    );
  if (!RISK_BANDS.includes(risk))
    throw new TypeError(
      `prototype ${id}: risk must be one of ${RISK_BANDS.join(", ")}`,
    );
  return {
    id,
    name,
    linesRemoved,
    dependencyCopiesRemoved,
    risk,
    gatesPass: entry.gatesPass === true,
    needsRun: entry.needsRun === true,
    notes: typeof entry.notes === "string" ? entry.notes : "",
  };
}

/**
 * Raw, unweighted yield for one prototype: lines plus dependency copies valued
 * at DEPENDENCY_WEIGHT, minus the run penalty.
 */
export function rawYield(prototype) {
  const p = normalizePrototype(prototype);
  const dependencyValue = p.dependencyCopiesRemoved * DEPENDENCY_WEIGHT;
  const runPenalty = p.needsRun ? RUN_PENALTY : 0;
  return p.linesRemoved + dependencyValue - runPenalty;
}

/**
 * Risk-adjusted score. A prototype whose gates do not pass scores zero: it is
 * not a candidate until the gates are green.
 */
export function scorePrototype(prototype) {
  const p = normalizePrototype(prototype);
  if (!p.gatesPass) return 0;
  return rawYield(p) * RISK_MULTIPLIER[p.risk];
}

/**
 * Rank prototypes best-first. Ties break by fewer lines removed, then by id,
 * so the order is total and deterministic.
 */
export function rankPrototypes(prototypes) {
  if (!Array.isArray(prototypes))
    throw new TypeError("prototypes must be an array");
  return prototypes
    .map((entry) => {
      const prototype = normalizePrototype(entry);
      return {
        ...prototype,
        rawYield: rawYield(prototype),
        score: scorePrototype(prototype),
      };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.linesRemoved !== a.linesRemoved)
        return b.linesRemoved - a.linesRemoved;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
}

/** The single highest-scoring variant, or null for an empty set. */
export function bestPrototype(prototypes) {
  const ranked = rankPrototypes(prototypes);
  return ranked.length > 0 ? ranked[0] : null;
}

/**
 * A prototype is low-cost when it carries low risk and needs no live run: only
 * then is its measured line count a settled gain rather than an estimate.
 */
export function isLowCost(prototype) {
  const p = normalizePrototype(prototype);
  return p.risk === "low" && !p.needsRun && p.gatesPass;
}

/**
 * The single best low-cost variant (low risk, no run, gates green), or null
 * when none qualifies. This is the variant to apply first.
 */
export function bestLowCost(prototypes) {
  const ranked = rankPrototypes(prototypes).filter(isLowCost);
  return ranked.length > 0 ? ranked[0] : null;
}

/** Totals across a set of prototypes, with the best one named. */
export function summarize(prototypes) {
  const ranked = rankPrototypes(prototypes);
  const totals = ranked.reduce(
    (acc, p) => ({
      linesRemoved: acc.linesRemoved + p.linesRemoved,
      dependencyCopiesRemoved:
        acc.dependencyCopiesRemoved + p.dependencyCopiesRemoved,
      gatesPass: acc.gatesPass && p.gatesPass,
      needsRun: acc.needsRun || p.needsRun,
    }),
    {
      linesRemoved: 0,
      dependencyCopiesRemoved: 0,
      gatesPass: ranked.length > 0,
      needsRun: false,
    },
  );
  const best = ranked.length > 0 ? ranked[0] : null;
  return {
    count: ranked.length,
    ...totals,
    bestId: best ? best.id : null,
    bestScore: best ? best.score : 0,
  };
}
