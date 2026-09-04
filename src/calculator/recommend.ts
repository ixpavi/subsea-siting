// Rule-based multi-criteria recommendation engine.
//
// This is closed-form weighted scoring (standard MCDA: normalize each metric,
// apply user priority weights, filter to the Pareto-efficient frontier, rank
// by weighted score) -- there is no LLM/external API call anywhere in this
// module. All availability/cost/PUE/CUE/WUE numbers are produced by the
// existing calculateFacilityProfile() in facilityCalculator.ts; this module
// only generates the candidate set, scores it, and ranks it.
import {
  ALL_REDUNDANCIES,
  ALL_TIERS,
  calculateFacilityProfile,
  estimateDeploymentComplexity,
  LAND_COOLING_OPTIONS,
  SUBSEA_COOLING_OPTIONS,
} from "./facilityCalculator";
import type { FacilityConfig, PriorityWeights, RecommendedCandidate } from "./types";

export function generateCandidateConfigs(
  isSubsea: boolean,
  downtimeCostPerHourUsd: number
): FacilityConfig[] {
  const coolings = isSubsea ? SUBSEA_COOLING_OPTIONS : LAND_COOLING_OPTIONS;
  const configs: FacilityConfig[] = [];
  for (const tier of ALL_TIERS) {
    for (const redundancy of ALL_REDUNDANCIES) {
      for (const cooling of coolings) {
        configs.push({ tier, redundancy, cooling, downtimeCostPerHourUsd });
      }
    }
  }
  return configs;
}

/** Min-max normalize to [0, 1], where 1 is always "best" regardless of raw direction. */
function normalize(values: number[], higherRawIsBetter: boolean): number[] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return values.map(() => 1);
  return values.map((v) => (higherRawIsBetter ? (v - min) / (max - min) : (max - v) / (max - min)));
}

interface ScoredInternal {
  config: FacilityConfig;
  profile: ReturnType<typeof calculateFacilityProfile>;
  deploymentComplexity: number;
  nCost: number;
  nAvailability: number;
  nSustainability: number;
  nSpeed: number;
  score: number;
}

function paretoFrontier(items: ScoredInternal[]): ScoredInternal[] {
  return items.filter((a) => {
    const dominatedByOther = items.some((b) => {
      if (b === a) return false;
      const atLeastAsGoodOnAll =
        b.nCost >= a.nCost &&
        b.nAvailability >= a.nAvailability &&
        b.nSustainability >= a.nSustainability &&
        b.nSpeed >= a.nSpeed;
      const strictlyBetterOnOne =
        b.nCost > a.nCost || b.nAvailability > a.nAvailability || b.nSustainability > a.nSustainability || b.nSpeed > a.nSpeed;
      return atLeastAsGoodOnAll && strictlyBetterOnOne;
    });
    return !dominatedByOther;
  });
}

/**
 * @param gridCarbonGco2PerKwh The site's national grid carbon intensity, so
 *   the reported CUE is the real one. Null when no location is known; CUE is
 *   then unavailable. It is a reported figure only -- sustainability ranks on
 *   PUE + WUE -- so this never changes which configuration wins.
 */
export function recommendConfigurations(
  isSubsea: boolean,
  downtimeCostPerHourUsd: number,
  weights: PriorityWeights,
  maxResults = 5,
  gridCarbonGco2PerKwh: number | null = null
): RecommendedCandidate[] {
  const configs = generateCandidateConfigs(isSubsea, downtimeCostPerHourUsd);
  const profiles = configs.map((c) => calculateFacilityProfile(c, gridCarbonGco2PerKwh));
  const complexities = configs.map((c) => estimateDeploymentComplexity(c));

  const nCost = normalize(
    profiles.map((p) => p.annualDowntimeCostUsd),
    false // lower cost is better
  );
  const nAvailability = normalize(
    profiles.map((p) => p.availabilityPct),
    true // higher availability is better
  );
  const nSustainability = normalize(
    profiles.map((p) => p.pue + p.wue),
    false // lower PUE+WUE is better
  );
  const nSpeed = normalize(complexities, false); // lower complexity is faster

  const totalWeight = weights.cost + weights.availability + weights.sustainability + weights.speed || 1;
  const w = {
    cost: weights.cost / totalWeight,
    availability: weights.availability / totalWeight,
    sustainability: weights.sustainability / totalWeight,
    speed: weights.speed / totalWeight,
  };

  const scored: ScoredInternal[] = configs.map((config, i) => ({
    config,
    profile: profiles[i],
    deploymentComplexity: complexities[i],
    nCost: nCost[i],
    nAvailability: nAvailability[i],
    nSustainability: nSustainability[i],
    nSpeed: nSpeed[i],
    score:
      w.cost * nCost[i] +
      w.availability * nAvailability[i] +
      w.sustainability * nSustainability[i] +
      w.speed * nSpeed[i],
  }));

  const frontier = paretoFrontier(scored);
  // The Pareto frontier can be smaller than maxResults; backfill from the
  // full ranked pool so the user still sees a useful shortlist.
  const pool = frontier.length >= 3 ? frontier : scored;
  const ranked = [...pool].sort((a, b) => b.score - a.score).slice(0, maxResults);

  const bestCost = ranked.reduce((best, c) => (c.profile.annualDowntimeCostUsd < best.profile.annualDowntimeCostUsd ? c : best), ranked[0]);
  const bestAvailability = ranked.reduce((best, c) => (c.profile.availabilityPct > best.profile.availabilityPct ? c : best), ranked[0]);
  const bestSustainability = ranked.reduce(
    (best, c) => (c.profile.pue + c.profile.wue < best.profile.pue + best.profile.wue ? c : best),
    ranked[0]
  );
  const bestSpeed = ranked.reduce((best, c) => (c.deploymentComplexity < best.deploymentComplexity ? c : best), ranked[0]);

  return ranked.map((c) => {
    const tags: string[] = [];
    if (c === bestCost) tags.push("Lowest cost");
    if (c === bestAvailability) tags.push("Best availability");
    if (c === bestSustainability) tags.push("Best sustainability trade-off");
    if (c === bestSpeed) tags.push("Fastest to deploy");
    if (tags.length === 0) tags.push("Balanced trade-off across your priorities");
    return {
      config: c.config,
      profile: c.profile,
      deploymentComplexity: c.deploymentComplexity,
      score: c.score,
      tags,
    };
  });
}
