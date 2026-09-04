// Standalone data-centre sizing calculator.
//
// Tier availability/downtime figures are the published Uptime Institute
// standard values (real industry reference data, not modeled). Redundancy
// modifiers, cooling PUE/WUE benchmarks, and CUE are illustrative typical
// values for scenario comparison -- they are NOT measured data for any real
// facility. Every consumer of this module should present results as a
// hypothetical/modeled estimate, never as fact about a specific site.
import type {
  CoolingConfig,
  CoolingSpec,
  FacilityConfig,
  FacilityProfile,
  RedundancyLevel,
  TierLevel,
  TierSpec,
} from "./types";

export const TIER_SPECS: Record<TierLevel, TierSpec> = {
  I: {
    label: "Tier I",
    availabilityPct: 99.671,
    annualDowntimeHours: 28.8,
    description: "Basic capacity, single non-redundant path.",
  },
  II: {
    label: "Tier II",
    availabilityPct: 99.741,
    annualDowntimeHours: 22.0,
    description: "Redundant capacity components, single path.",
  },
  III: {
    label: "Tier III",
    availabilityPct: 99.982,
    annualDowntimeHours: 1.6,
    description: "Concurrently maintainable, multiple paths.",
  },
  IV: {
    label: "Tier IV",
    availabilityPct: 99.995,
    annualDowntimeHours: 0.4,
    description: "Fault tolerant, no single point of failure.",
  },
};

// Simplified scenario-comparison modifier: how far a chosen redundancy level
// pushes downtime above/below the raw Tier figure. Not an official Uptime
// Institute combination -- Tier already implies a redundancy design, this
// lets a user explore "what if" combinations for planning discussions.
const REDUNDANCY_DOWNTIME_MULTIPLIER: Record<RedundancyLevel, number> = {
  N: 1.4,
  "N+1": 1.0,
  "2N": 0.65,
};

export const COOLING_SPECS: Record<CoolingConfig, CoolingSpec> = {
  "air-crac": {
    label: "Air-cooled (CRAC/CRAH)",
    pue: 1.6,
    wue: 1.0,
    description: "Conventional raised-floor air cooling.",
  },
  "chilled-water": {
    label: "Chilled water",
    pue: 1.4,
    wue: 1.8,
    description: "Central chiller plant, higher water draw.",
  },
  "free-air": {
    label: "Free air / evaporative",
    pue: 1.2,
    wue: 1.1,
    description: "Outside-air economization where climate allows.",
  },
  seawater: {
    label: "Seawater exchange",
    pue: 1.12,
    wue: 0.15,
    description: "Ambient seawater as the cooling medium (subsea deployments).",
  },
  immersion: {
    label: "Immersion / two-phase",
    pue: 1.08,
    wue: 0.1,
    description: "Direct liquid or two-phase immersion cooling.",
  },
};

// CUE is PUE x the grid's carbon intensity, so it is only meaningful once the
// site's grid is known. This used to substitute a flat 0.4 kg/kWh, which is
// wrong nearly everywhere: the real national figures this app already ships
// (Our World in Data, 213 of 216 countries) run from 0 to 1,306 gCO2/kWh,
// median 474. A France site was reported ~10x its actual carbon, an Indian one
// at 60% of it -- and the number was displayed as a computed result.
//
// It is now passed in, and null when the country has no published figure.
// Reporting it as unavailable rather than defaulting is the same rule the rest
// of the app follows: a fabricated number that looks like a measurement is
// worse than an honest gap. CUE feeds no ranking (sustainability scores on
// PUE + WUE), so a null changes no recommendation.

// Cooling types that are physically meaningful for each deployment context.
// A land facility doesn't draw ambient seawater; a subsea pressure vessel
// isn't fitted with raised-floor CRAC units or a chiller plant.
export const LAND_COOLING_OPTIONS: CoolingConfig[] = ["free-air", "air-crac", "chilled-water", "immersion"];
export const SUBSEA_COOLING_OPTIONS: CoolingConfig[] = ["seawater", "immersion"];

export const ALL_TIERS: TierLevel[] = ["I", "II", "III", "IV"];
export const ALL_REDUNDANCIES: RedundancyLevel[] = ["N", "N+1", "2N"];

// Relative build-out complexity units for a simplified "deployment speed"
// heuristic -- higher tier, higher redundancy, and more exotic cooling all
// add engineering/procurement lead time. Illustrative ordering, not a
// measured schedule for any real project.
const TIER_COMPLEXITY: Record<TierLevel, number> = { I: 1, II: 2, III: 3, IV: 4 };
const REDUNDANCY_COMPLEXITY: Record<RedundancyLevel, number> = { N: 1, "N+1": 2, "2N": 3 };
const COOLING_COMPLEXITY: Record<CoolingConfig, number> = {
  "free-air": 1,
  "air-crac": 2,
  "chilled-water": 3,
  seawater: 4,
  immersion: 5,
};

/** Lower = simpler/faster to deploy. Used only for relative ranking, not an absolute duration. */
export function estimateDeploymentComplexity(config: FacilityConfig): number {
  return (
    TIER_COMPLEXITY[config.tier] +
    REDUNDANCY_COMPLEXITY[config.redundancy] +
    COOLING_COMPLEXITY[config.cooling]
  );
}

/**
 * @param gridCarbonGco2PerKwh The site's national grid carbon intensity, from
 *   the shipped country dataset. Pass null (the default) when no location is
 *   known or the country has no published figure -- CUE is then reported as
 *   unavailable rather than invented.
 */
export function calculateFacilityProfile(
  config: FacilityConfig,
  gridCarbonGco2PerKwh: number | null = null
): FacilityProfile {
  const tier = TIER_SPECS[config.tier];
  const cooling = COOLING_SPECS[config.cooling];
  const redundancyMultiplier = REDUNDANCY_DOWNTIME_MULTIPLIER[config.redundancy];

  const annualDowntimeHours = round(tier.annualDowntimeHours * redundancyMultiplier, 2);
  const availabilityPct = round(100 - (annualDowntimeHours / 8760) * 100, 4);
  const annualDowntimeCostUsd = Math.round(annualDowntimeHours * config.downtimeCostPerHourUsd);

  return {
    availabilityPct,
    annualDowntimeHours,
    annualDowntimeCostUsd,
    pue: cooling.pue,
    // g -> kg, so the reported unit stays kg CO2e per kWh of IT load.
    cue:
      gridCarbonGco2PerKwh == null
        ? null
        : round(cooling.pue * (gridCarbonGco2PerKwh / 1000), 3),
    wue: cooling.wue,
  };
}

function round(n: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}
