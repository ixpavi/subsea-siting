// Transparent, disclosed MODELED cost estimate for a candidate route. This is
// NOT a contractor quotation and none of the coefficients below are sourced
// market prices -- they are explicit, configurable USER ASSUMPTIONS (see
// provenance.ts), shown in full in the UI so the user can see exactly what
// produced the number.
//
// COST IS NOT AN INDEPENDENT RANKING CRITERION. It is a deterministic
// function of route length and the modeled difficulty index, both of which
// are already MCDA criteria in their own right. Scoring cost separately made
// the ranking double-count length -- measured before the fix, normalized
// cost and normalized length were identical to three decimal places in 9 of
// 9 candidate rows, because the model reduced exactly to
// `49,990.5 x marineKm + 13,800,000`. Cost is still computed and displayed;
// it just no longer votes. See routingTypes.ts's RoutingCriterionId.
//
// Terrain scaling now uses the CONTINUOUS difficulty index rather than a
// three-bin LOW/MEDIUM/HIGH lookup. That bin lookup returned MEDIUM for
// every route tested, which is what made cost perfectly affine in length in
// the first place; with the continuous index a longer route over easier
// seabed can now legitimately cost less than a shorter route over harder
// seabed.
//
//   estimated_cost =
//     base_cost_per_km * marine_length_km            (lengthCostUsd)
//     + installation_factor * lengthCostUsd           (installationCostUsd)
//     + (lengthCost + installation) * (difficultyIndex - 1)   (terrainPenaltyUsd)
//     + environmental constraint penalty (0 while     (environmentalPenaltyUsd)
//       environmental data is unavailable)
//     + shore-end / landing cost x2                   (shoreEndCostUsd)
//     + contingency %                                 (contingencyUsd)
//
// KNOWN STRUCTURAL GAPS, not coefficient inaccuracies: no repeater count, no
// depth-dependent armouring class, no burial cost, no survey cost, no
// EEZ/permitting cost, and no maintenance/repair model. Terrestrial backhaul
// is reported as a distance only and never folded into this total.
import type { CostAssumptions, CostBreakdown, EnvironmentalAssessment, RouteAnalysis } from "./routingTypes";

export const DEFAULT_COST_ASSUMPTIONS: CostAssumptions = {
  baseCostPerKmUsd: 28000,
  installationFactor: 0.35,
  shoreEndCostUsd: 6_000_000,
  environmentalPenaltyPerConstrainedKmUsd: 15000,
  contingencyPct: 0.15,
};

export function computeCost(
  analysis: RouteAnalysis,
  environmental: EnvironmentalAssessment,
  assumptions: CostAssumptions = DEFAULT_COST_ASSUMPTIONS
): CostBreakdown {
  const lengthCostUsd = assumptions.baseCostPerKmUsd * analysis.marineDistanceKm;
  const installationCostUsd = lengthCostUsd * assumptions.installationFactor;

  // Continuous: index 1.0 means no terrain penalty at all.
  const terrainPenaltyUsd = (lengthCostUsd + installationCostUsd) * Math.max(0, analysis.difficultyIndex - 1);

  const environmentalPenaltyUsd =
    environmental.available && environmental.constrainedDistanceKm
      ? environmental.constrainedDistanceKm * assumptions.environmentalPenaltyPerConstrainedKmUsd
      : 0;

  const shoreEndCostUsd = assumptions.shoreEndCostUsd * 2;

  const subtotalUsd = lengthCostUsd + installationCostUsd + terrainPenaltyUsd + environmentalPenaltyUsd + shoreEndCostUsd;
  const contingencyUsd = subtotalUsd * assumptions.contingencyPct;
  const totalUsd = subtotalUsd + contingencyUsd;

  return {
    lengthCostUsd,
    installationCostUsd,
    terrainPenaltyUsd,
    environmentalPenaltyUsd,
    shoreEndCostUsd,
    subtotalUsd,
    contingencyUsd,
    totalUsd,
    assumptions,
  };
}
