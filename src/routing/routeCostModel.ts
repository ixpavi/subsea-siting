// Transparent, disclosed MODELED cost estimate for a candidate route. This
// is NOT a contractor quotation and none of the coefficients below are
// sourced market prices -- they are explicit, configurable modeling
// assumptions, shown in full in the UI (see design/RouteInspector.tsx) so
// the user can see exactly what produced the number, not just the total.
//
//   estimated_cost =
//     base_cost_per_km * marine_length_km          (lengthCostUsd)
//     + installation_factor * lengthCostUsd         (installationCostUsd)
//     + terrain/depth difficulty penalty             (terrainPenaltyUsd)
//     + environmental constraint penalty (0 while    (environmentalPenaltyUsd)
//       environmental data is unavailable)
//     + shore-end / landing cost x2                  (shoreEndCostUsd)
//     + contingency %                                (contingencyUsd)
//
// Terrestrial backhaul (data-centre site <-> marine access point) is
// reported elsewhere as a distance only (MarineEndpoint.terrestrialAccessKm)
// -- it is a materially different cost model (terrestrial fiber build,
// permitting, right-of-way) that this module does not attempt to estimate,
// and is never silently folded into the marine cost total.
import type { CostAssumptions, CostBreakdown, EnvironmentalAssessment, RouteAnalysis, SeabedDifficulty } from "./routingTypes";

export const DEFAULT_COST_ASSUMPTIONS: CostAssumptions = {
  baseCostPerKmUsd: 28000,
  installationFactor: 0.35,
  depthDifficultyMultiplier: { LOW: 1.0, MEDIUM: 1.15, HIGH: 1.35 },
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

  const difficultyMultiplier = assumptions.depthDifficultyMultiplier[analysis.seabedDifficulty as SeabedDifficulty];
  const terrainPenaltyUsd = (lengthCostUsd + installationCostUsd) * (difficultyMultiplier - 1);

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
