// Rule-based multi-criteria recommendation engine.
//
// COST IS NOT AN INDEPENDENT CRITERION, for the same reason it is not one in
// the routing engine (see routing/routeCostModel.ts). The only cost this
// module knows is annual downtime cost, which is
// `annualDowntimeHours x downtimeCostPerHourUsd`, while availability is
// `100 - annualDowntimeHours / 87.6`. Both are affine in the same variable, so
// after min-max normalisation they are THE SAME NUMBER -- measured across all
// 48 land candidates, max |nCost - nAvailability| was 1.6e-4, which is nothing
// but the rounding of the dollar figure.
//
// Scoring both therefore double-counted downtime against sustainability and
// speed, and made the user's choice of priority inert: "Cost" and
// "Availability" as primary priority produced an identical shortlist in an
// identical order.
//
// The two weights are now combined with MAX, not SUM. Summing is what the old
// code effectively did -- with the two normalised values identical,
// `w.cost * n + w.availability * n` is just `(w.cost + w.availability) * n` --
// and that is the inflation itself: with the default 20/20/20/20 weights,
// downtime took 50% of the score and sustainability and speed 25% each, when
// three independent axes should be a third apiece. Taking the max treats
// selecting the same axis under two names as selecting it once, at the
// strength of the stronger selection. Downtime cost is still computed and
// displayed -- it just no longer votes twice.
//
// There is deliberately no capex/opex model standing in as a second axis:
// this module has no sourced build-cost data, and inventing coefficients to
// manufacture an independent criterion would be worse than admitting there is
// only one.
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
  nAvailability: number;
  nSustainability: number;
  nSpeed: number;
  score: number;
}

function paretoFrontier(items: ScoredInternal[]): ScoredInternal[] {
  return items.filter((a) => {
    const dominatedByOther = items.some((b) => {
      if (b === a) return false;
      // Three axes, not four: downtime cost is the availability axis
      // restated, and counting it twice here shrank the frontier on a
      // dimension that carried no extra information.
      const atLeastAsGoodOnAll =
        b.nAvailability >= a.nAvailability &&
        b.nSustainability >= a.nSustainability &&
        b.nSpeed >= a.nSpeed;
      const strictlyBetterOnOne =
        b.nAvailability > a.nAvailability || b.nSustainability > a.nSustainability || b.nSpeed > a.nSpeed;
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

  const nAvailability = normalize(
    profiles.map((p) => p.availabilityPct),
    true // higher availability is better
  );
  const nSustainability = normalize(
    profiles.map((p) => p.pue + p.wue),
    false // lower PUE+WUE is better
  );
  const nSpeed = normalize(complexities, false); // lower complexity is faster

  const downtimeWeight = Math.max(weights.cost, weights.availability);
  const totalWeight = downtimeWeight + weights.sustainability + weights.speed || 1;
  const w = {
    // Downtime cost and availability are the same preference expressed two
    // ways (see this file's header), so they collapse to one axis at the
    // stronger of the two weights rather than accumulating both.
    availability: downtimeWeight / totalWeight,
    sustainability: weights.sustainability / totalWeight,
    speed: weights.speed / totalWeight,
  };

  const scored: ScoredInternal[] = configs.map((config, i) => ({
    config,
    profile: profiles[i],
    deploymentComplexity: complexities[i],
    nAvailability: nAvailability[i],
    nSustainability: nSustainability[i],
    nSpeed: nSpeed[i],
    score: w.availability * nAvailability[i] + w.sustainability * nSustainability[i] + w.speed * nSpeed[i],
  }));

  const frontier = paretoFrontier(scored);
  // The Pareto frontier can be smaller than maxResults; backfill from the
  // full ranked pool so the user still sees a useful shortlist.
  const pool = frontier.length >= 3 ? frontier : scored;
  const ranked = [...pool].sort((a, b) => b.score - a.score).slice(0, maxResults);

  // One tag, not two: the candidate with the lowest downtime cost is always
  // the candidate with the best availability, so emitting both put two labels
  // saying the same thing on one row.
  const bestUptime = ranked.reduce((best, c) => (c.profile.availabilityPct > best.profile.availabilityPct ? c : best), ranked[0]);
  const bestSustainability = ranked.reduce(
    (best, c) => (c.profile.pue + c.profile.wue < best.profile.pue + best.profile.wue ? c : best),
    ranked[0]
  );
  const bestSpeed = ranked.reduce((best, c) => (c.deploymentComplexity < best.deploymentComplexity ? c : best), ranked[0]);

  return ranked.map((c) => {
    const tags: string[] = [];
    if (c === bestUptime) tags.push("Best availability, lowest downtime cost");
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
