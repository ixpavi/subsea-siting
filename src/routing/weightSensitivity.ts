// How much does the recommendation actually depend on the weights?
//
// WHY THIS EXISTS. An MCDA hands the user four sliders and returns one
// recommended route. What it does not tell them is whether that recommendation
// is a real finding or an artefact of where the sliders happen to sit. Those
// are very different claims:
//
//   "the shortest route wins under all 64 weightings you can set"  -- robust
//   "the shortest route wins, but raise seabed to High and it      -- fragile
//    loses"
//
// Both look identical in the UI today. A planner who cannot tell them apart
// will read a knife-edge preference as a conclusion, which is exactly the
// failure mode a decision tool should not have.
//
// The engine already ranks deterministically, so this needs no new modelling
// and invents no data: it re-runs the SAME ranking over a sweep of weightings
// and reports what changes. Everything here is derived from the candidates the
// user is already looking at.
import type {
  RoutingCriterionId,
  RoutingProfileId,
  RoutingWeights,
} from "./routingTypes";

/**
 * The weights a user can actually select, and the single source of truth for
 * them -- RouteInspector imports this rather than keeping its own copy.
 *
 * Sweeping a continuous 0..1 range instead would test weightings that cannot
 * be set in the UI, and would report flip points the user could never reach.
 * "Holds across 58 of the 64 weightings you can choose" is a claim about this
 * tool; "holds up to a seabed weight of 0.65" is not.
 */
export const SELECTABLE_WEIGHT_LEVELS = [0.5, 1, 1.5, 2] as const;

export const SENSITIVITY_CRITERIA: RoutingCriterionId[] = [
  "length",
  "seabedDifficulty",
  "resilience",
  "environmental",
];

/** One candidate's per-criterion normalized scores, which is all the ranking
 *  needs. Taking normalized values rather than raw ones keeps this exactly
 *  consistent with how the engine scored them in the first place. */
export interface SensitivityCandidate {
  id: RoutingProfileId;
  label: string;
  normalized: Record<RoutingCriterionId, number>;
}

export interface CriterionSensitivity {
  id: RoutingCriterionId;
  /** False when the criterion is unavailable or does not discriminate, in
   *  which case sweeping it is meaningless rather than merely uninteresting. */
  applicable: boolean;
  /** Weight at which the winner changes, sweeping this criterion alone with
   *  the others held at their current values. null when it never changes. */
  flipsAt: number | null;
  /** Who wins after the flip. */
  flipsTo: RoutingProfileId | null;
  /** Winner across the whole sweep, keyed by weight. Ordered ascending. */
  sweep: { weight: number; winner: RoutingProfileId }[];
}

export interface WeightSensitivityResult {
  /** Winner at the user's current weights. */
  currentWinner: RoutingProfileId | null;
  perCriterion: CriterionSensitivity[];
  /** Share of a uniform grid of weightings where the current winner still
   *  wins, 0..1. The single most useful number here. */
  winShare: number;
  /** Every candidate that wins somewhere in the grid, with its share. */
  contenders: { id: RoutingProfileId; share: number }[];
  /** True when the current winner holds across the entire grid. */
  unconditional: boolean;
  gridPoints: number;
  summary: string;
}

/** Winner under a given weighting. Mirrors the engine's own scoring: weighted
 *  sum of normalized values over criteria with positive weight, ties broken by
 *  candidate order so the result is deterministic. */
function winnerUnder(
  candidates: SensitivityCandidate[],
  weights: RoutingWeights,
  applicable: RoutingCriterionId[]
): RoutingProfileId | null {
  if (candidates.length === 0) return null;
  let bestId: RoutingProfileId | null = null;
  let bestScore = -Infinity;
  const total = applicable.reduce((a, c) => a + (weights[c] ?? 0), 0);
  for (const c of candidates) {
    const score =
      total > 0
        ? applicable.reduce((sum, id) => sum + (weights[id] ?? 0) * (c.normalized[id] ?? 0), 0) / total
        : 0;
    // Strictly greater keeps the first candidate on a tie, which makes the
    // sweep stable instead of flickering between equal-scoring routes.
    if (score > bestScore + 1e-12) {
      bestScore = score;
      bestId = c.id;
    }
  }
  return bestId;
}

/**
 * @param applicable criteria that actually discriminate between the
 *        candidates. Sweeping a criterion on which every route scores the same
 *        would report "never flips" for a criterion that could not flip
 *        anything by construction, which reads as robustness and is not.
 */
export function analyzeWeightSensitivity(
  candidates: SensitivityCandidate[],
  current: RoutingWeights,
  applicable: RoutingCriterionId[]
): WeightSensitivityResult {
  const active = SENSITIVITY_CRITERIA.filter((c) => applicable.includes(c));
  const currentWinner = winnerUnder(candidates, current, active);

  const perCriterion: CriterionSensitivity[] = SENSITIVITY_CRITERIA.map((id) => {
    if (!active.includes(id) || candidates.length < 2) {
      return { id, applicable: false, flipsAt: null, flipsTo: null, sweep: [] };
    }
    const sweep: { weight: number; winner: RoutingProfileId }[] = [];
    let flipsAt: number | null = null;
    let flipsTo: RoutingProfileId | null = null;
    for (const weight of SELECTABLE_WEIGHT_LEVELS) {
      const w = { ...current, [id]: weight } as RoutingWeights;
      const winner = winnerUnder(candidates, w, active);
      if (winner) sweep.push({ weight, winner });
      if (flipsAt === null && winner && currentWinner && winner !== currentWinner) {
        flipsAt = weight;
        flipsTo = winner;
      }
    }
    return { id, applicable: true, flipsAt, flipsTo, sweep };
  });

  // Multi-way grid: vary every applicable criterion together, so the share
  // reflects the whole weighting space rather than one axis at a time. A
  // recommendation can survive every single-axis sweep and still lose on a
  // combination, which one-at-a-time analysis would never reveal.
  const counts = new Map<RoutingProfileId, number>();
  let gridPoints = 0;
  const levels = SELECTABLE_WEIGHT_LEVELS;

  const walk = (idx: number, acc: RoutingWeights) => {
    if (idx === active.length) {
      const w = winnerUnder(candidates, acc, active);
      if (w) {
        counts.set(w, (counts.get(w) ?? 0) + 1);
        gridPoints++;
      }
      return;
    }
    for (const level of levels) {
      walk(idx + 1, { ...acc, [active[idx]]: level } as RoutingWeights);
    }
  };
  if (active.length > 0 && candidates.length > 1) walk(0, { ...current });

  const contenders = [...counts.entries()]
    .map(([id, n]) => ({ id, share: gridPoints > 0 ? n / gridPoints : 0 }))
    .sort((a, b) => b.share - a.share || a.id.localeCompare(b.id));

  const winShare = currentWinner ? (counts.get(currentWinner) ?? 0) / Math.max(1, gridPoints) : 0;
  const unconditional = gridPoints > 0 && winShare >= 0.999;

  return {
    currentWinner,
    perCriterion,
    winShare,
    contenders,
    unconditional,
    gridPoints,
    summary: buildSummary(currentWinner, winShare, unconditional, contenders, gridPoints, active.length),
  };
}

function buildSummary(
  winner: RoutingProfileId | null,
  winShare: number,
  unconditional: boolean,
  contenders: { id: RoutingProfileId; share: number }[],
  gridPoints: number,
  activeCount: number
): string {
  if (!winner || gridPoints === 0 || activeCount === 0) {
    return "No criterion separates these candidates, so there is no weighting under which one is preferred. The ranking carries no information.";
  }
  if (unconditional) {
    return `This recommendation does not depend on the weights: it wins under every one of the ${gridPoints.toLocaleString()} weightings tested. Moving the sliders will not change it.`;
  }
  const pct = Math.round(winShare * 100);
  const rival = contenders.find((c) => c.id !== winner);
  const rivalText = rival
    ? ` The main alternative wins ${Math.round(rival.share * 100)}% of the time.`
    : "";
  if (winShare >= 0.75) {
    return `This recommendation holds across ${pct}% of the ${gridPoints.toLocaleString()} weightings tested, so it is reasonably robust to how the sliders are set.${rivalText}`;
  }
  if (winShare >= 0.4) {
    return `This recommendation holds for only ${pct}% of the ${gridPoints.toLocaleString()} weightings tested. It reflects the current weighting as much as the routes themselves, and should be read as one defensible choice rather than the answer.${rivalText}`;
  }
  return `This recommendation holds for just ${pct}% of the ${gridPoints.toLocaleString()} weightings tested -- it is a knife-edge result driven by the current slider positions, not a property of the routes.${rivalText}`;
}
