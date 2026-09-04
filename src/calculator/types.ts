// Standalone facility-sizing calculator types.
// No dependency on the globe/React app -- reusable in any context.

export type RedundancyLevel = "N" | "N+1" | "2N";
export type TierLevel = "I" | "II" | "III" | "IV";
export type CoolingConfig =
  | "air-crac"
  | "chilled-water"
  | "free-air"
  | "seawater"
  | "immersion";

export interface FacilityConfig {
  redundancy: RedundancyLevel;
  tier: TierLevel;
  cooling: CoolingConfig;
  /** Estimated cost of one hour of downtime, in USD. Used to derive annual downtime cost. */
  downtimeCostPerHourUsd: number;
}

export interface FacilityProfile {
  /** Estimated availability, e.g. 99.982 */
  availabilityPct: number;
  /** Estimated unplanned downtime per year, in hours */
  annualDowntimeHours: number;
  /** Estimated annual cost of that downtime, in USD */
  annualDowntimeCostUsd: number;
  /** Power Usage Effectiveness (total facility power / IT power) */
  pue: number;
  /**
   * Carbon Usage Effectiveness (kg CO2e / kWh IT load), computed from the
   * site's real national grid carbon intensity. null when no location is known
   * or the country has no published figure -- never a substituted default.
   */
  cue: number | null;
  /** Water Usage Effectiveness (litres / kWh IT load), illustrative benchmark */
  wue: number;
}

export interface TierSpec {
  label: string;
  /** Uptime Institute standard availability figure for this tier */
  availabilityPct: number;
  annualDowntimeHours: number;
  description: string;
}

export interface CoolingSpec {
  label: string;
  pue: number;
  wue: number;
  description: string;
}

/** User-stated priority weights for the recommendation engine. Any relative scale is fine -- they get normalized. */
export interface PriorityWeights {
  cost: number;
  availability: number;
  sustainability: number;
  speed: number;
}

export interface RecommendedCandidate {
  config: FacilityConfig;
  profile: FacilityProfile;
  deploymentComplexity: number;
  score: number;
  tags: string[];
}
