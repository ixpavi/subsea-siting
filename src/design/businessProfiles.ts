// Plain data + deterministic mapping helpers for the "Design a Data Centre"
// workflow. No calculation logic lives here -- this only translates business
// language into the inputs the existing calculator/recommend.ts already
// accepts (PriorityWeights, a Tier floor, a downtime-cost baseline).
import { ALL_TIERS } from "../calculator/facilityCalculator";
import type { PriorityWeights, TierLevel } from "../calculator/types";
import type { AvailabilityRequirement, Industry, PriorityAxis } from "./designTypes";

export const INDUSTRIES: Industry[] = [
  "Financial Services",
  "Healthcare",
  "Cloud / SaaS",
  "E-commerce",
  "AI / HPC",
  "Government",
  "General Enterprise",
];

// Captions follow from the Tier each option requires and the downtime the
// calculator gives that Tier (Uptime Institute figures, adjusted by the
// redundancy modifier): Tier I-II up to about 40 hours a year, Tier III 1.0-2.2
// hours, Tier IV 16-34 minutes. They previously promised "single-digit
// minutes" for mission-critical, which no configuration in this model reaches.
export const AVAILABILITY_OPTIONS: {
  value: AvailabilityRequirement;
  label: string;
  caption: string;
  minTier: TierLevel;
}[] = [
  {
    value: "standard",
    label: "Standard",
    caption: "Outages measured in hours per year.",
    minTier: "I",
  },
  {
    value: "high",
    label: "High",
    caption: "No more than about two hours of outage per year.",
    minTier: "III",
  },
  {
    value: "mission-critical",
    label: "Mission-critical",
    caption: "Outages measured in tens of minutes per year.",
    minTier: "IV",
  },
];

/**
 * Editable starting points shown when an industry is picked -- illustrative
 * defaults for this workflow, not measured/empirical figures. The user can
 * change either value immediately.
 */
export const INDUSTRY_DEFAULTS: Record<Industry, { availability: AvailabilityRequirement; capacityMW: number }> = {
  "Financial Services": { availability: "mission-critical", capacityMW: 20 },
  Healthcare: { availability: "high", capacityMW: 10 },
  "Cloud / SaaS": { availability: "high", capacityMW: 30 },
  "E-commerce": { availability: "high", capacityMW: 15 },
  "AI / HPC": { availability: "standard", capacityMW: 50 },
  Government: { availability: "mission-critical", capacityMW: 12 },
  "General Enterprise": { availability: "standard", capacityMW: 5 },
};

export const PRIORITY_AXES: { value: PriorityAxis; label: string }[] = [
  { value: "cost", label: "Cost" },
  { value: "availability", label: "Availability / uptime" },
  { value: "sustainability", label: "Sustainability (PUE/WUE)" },
  { value: "speed", label: "Deployment speed" },
];

// Deterministic weight levels -- a fixed, disclosed mapping, not an
// empirical or industry-standard weighting scheme.
export const PRIORITY_WEIGHT_PRIMARY = 100;
export const PRIORITY_WEIGHT_SECONDARY = 60;
export const PRIORITY_WEIGHT_REMAINING = 20;

export function buildPriorityWeights(primary: PriorityAxis, secondary: PriorityAxis | null): PriorityWeights {
  const weights: PriorityWeights = {
    cost: PRIORITY_WEIGHT_REMAINING,
    availability: PRIORITY_WEIGHT_REMAINING,
    sustainability: PRIORITY_WEIGHT_REMAINING,
    speed: PRIORITY_WEIGHT_REMAINING,
  };
  weights[primary] = PRIORITY_WEIGHT_PRIMARY;
  if (secondary && secondary !== primary) weights[secondary] = PRIORITY_WEIGHT_SECONDARY;
  return weights;
}

/**
 * Fixed, disclosed placeholder used to feed the existing
 * calculateFacilityProfile()'s downtimeCostPerHourUsd input. Intentionally
 * NOT derived from the user's stated capacity -- doing so would make
 * capacity silently influence the recommendation score, which this phase
 * explicitly does not do (see the capacity disclosure on the result step).
 */
export const DEFAULT_DOWNTIME_COST_PER_HOUR_USD = 9000;

export function tierAtLeast(tier: TierLevel, minTier: TierLevel): boolean {
  return ALL_TIERS.indexOf(tier) >= ALL_TIERS.indexOf(minTier);
}
