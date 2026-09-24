// Turns a business requirement into a recommended facility design.
//
// Two things decide which configurations are even considered, before any
// scoring happens:
//
//   - THE TIER FLOOR. Configurations below the availability requirement are
//     not candidates. They used to be scored with everything else and dropped
//     afterwards, and because scores are normalised over whatever is scored,
//     the ruled-out Tier I options still set the scale: with Availability as
//     the top priority the planner recommended Tier IV with N redundancy,
//     because 2N's extra uptime looked negligible next to Tier I's 40 hours.
//
//   - THE SITE'S CLIMATE. Free-air cooling only works where outside air can
//     carry the load for a real share of the year. Where it cannot (Chennai:
//     about 4%), the cooling assessment on the same page warns against it, so
//     recommending it would contradict the page. It is left out, and the
//     result says why. This is where the site and the design stop being two
//     separate analyses.
import { ALL_REDUNDANCIES, ALL_TIERS, COOLING_SPECS, LAND_COOLING_OPTIONS } from "../calculator/facilityCalculator";
import { recommendConfigurations } from "../calculator/recommend";
import type { CoolingConfig } from "../calculator/types";
import type { ClimateProfile } from "../siting/climateProfile";
import { economiserCoverage, ECONOMISER_MIN_VIABLE_SHARE } from "../siting/coolingAdvisor";
import { AVAILABILITY_OPTIONS, DEFAULT_DOWNTIME_COST_PER_HOUR_USD, buildPriorityWeights } from "./businessProfiles";
import type { DesignRequirement, DesignResult } from "./designTypes";

const LAND_POOL_SIZE = ALL_TIERS.length * ALL_REDUNDANCIES.length * LAND_COOLING_OPTIONS.length;

/** Cooling types this site's climate rules out, with the reason. */
export function unviableCooling(climate: ClimateProfile | null): DesignResult["excludedCooling"] {
  if (!climate) return [];
  const coverage = economiserCoverage(climate);
  if (coverage >= ECONOMISER_MIN_VIABLE_SHARE) return [];
  return [
    {
      cooling: "free-air",
      label: COOLING_SPECS["free-air"].label,
      reason:
        `outside air could carry the load for only about ${Math.round(coverage * 100)}% of the year at this site, ` +
        "so mechanical cooling would do nearly all the work",
    },
  ];
}

/**
 * @param climate the site's measured climate, or null when it could not be
 *   fetched -- cooling is then not screened, and the result says so.
 */
export function computeDesignResult(
  requirement: DesignRequirement,
  gridCarbonGco2PerKwh: number | null,
  climate: ClimateProfile | null
): DesignResult | null {
  const { businessContext, priorities } = requirement;
  if (!businessContext.availabilityRequirement || !priorities.primary) return null;

  const availability = AVAILABILITY_OPTIONS.find((a) => a.value === businessContext.availabilityRequirement);
  if (!availability) return null;

  const excludedCooling = unviableCooling(climate);
  const coolingOptions: CoolingConfig[] = LAND_COOLING_OPTIONS.filter(
    (c) => !excludedCooling.some((x) => x.cooling === c)
  );

  const weights = buildPriorityWeights(priorities.primary, priorities.secondary);
  const shortlist = recommendConfigurations(
    false,
    DEFAULT_DOWNTIME_COST_PER_HOUR_USD,
    weights,
    LAND_POOL_SIZE,
    gridCarbonGco2PerKwh,
    { minTier: availability.minTier, coolingOptions }
  ).slice(0, 5);
  if (shortlist.length === 0) return null;

  return {
    requirement,
    weights,
    gridCarbonGco2PerKwh,
    minTier: availability.minTier,
    top: shortlist[0],
    alternatives: shortlist,
    excludedCooling,
    climateScreened: climate != null,
  };
}
