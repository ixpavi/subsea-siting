// "Design a Data Centre" business-requirement workflow types.
// Deliberately decoupled from Globe/App state -- this models a hypothetical
// planning scenario, not real infrastructure. See calculator/types.ts for
// the existing, unmodified facility-sizing types this workflow feeds into.
import type { PriorityWeights, RecommendedCandidate, TierLevel } from "../calculator/types";

export type Industry =
  | "Financial Services"
  | "Healthcare"
  | "Cloud / SaaS"
  | "E-commerce"
  | "AI / HPC"
  | "Government"
  | "General Enterprise";

export type AvailabilityRequirement = "standard" | "high" | "mission-critical";

export type PriorityAxis = "cost" | "availability" | "sustainability" | "speed";

/**
 * A place the user searched for. `query` is the raw typed text; `name`/
 * `country`/`lat`/`lng` are populated only once geocoding.ts resolves a
 * selection -- never fabricate them for unresolved text. This shape is
 * deliberately structured (not just a string) so Phase 2 can join it against
 * landing-points.json / cables.json for real nearest-cable analysis without
 * reshaping this type.
 */
export interface LocationRequirement {
  query: string;
  name?: string;
  country?: string;
  /** ISO 3166-1 alpha-2, lowercase. Joins this location to national indicators (water stress, grid carbon). */
  countryCode?: string;
  lat?: number;
  lng?: number;
}

export interface BusinessContext {
  industry: Industry | null;
  availabilityRequirement: AvailabilityRequirement | null;
  /**
   * First-class requirement field. Captured and carried through the whole
   * model even though calculateFacilityProfile()/recommendConfigurations()
   * don't yet consume it mathematically -- kept here so a later phase can
   * wire it into cooling sizing, power infrastructure, and cost without
   * reshaping this type.
   */
  capacityMW: number | null;
}

export interface LocationConnectivity {
  location: LocationRequirement;
  connectivityDestination: LocationRequirement;
}

export interface PriorityChoice {
  primary: PriorityAxis | null;
  secondary: PriorityAxis | null;
}

export interface DesignRequirement {
  businessContext: BusinessContext;
  locationConnectivity: LocationConnectivity;
  priorities: PriorityChoice;
}

export interface DesignResult {
  requirement: DesignRequirement;
  weights: PriorityWeights;
  /** The grid carbon intensity the CUE was computed with, kept so the figure is always shown beside its own basis. */
  gridCarbonGco2PerKwh: number | null;
  minTier: TierLevel;
  /** Top-ranked candidate after filtering the engine's output to the Tier floor. */
  top: RecommendedCandidate;
  /** Ranked shortlist (including top) for the "alternatives considered" table. */
  alternatives: RecommendedCandidate[];
}

export const PLANNING_STEPS = [
  "business-requirement",
  "site-connectivity",
  "routes",
  "review",
  "recommendation",
] as const;

export type PlanningStep = (typeof PLANNING_STEPS)[number];

/**
 * The full decision-support pipeline, shown as the rail across the top of the
 * planner:
 *   Business Requirement -> Proposed Site -> Existing Connectivity ->
 *   Landing Points -> Hypothetical Routes -> Environmental Analysis ->
 *   Data Centre Design -> Resilience -> Economics -> Recommendation
 *
 * Several stages share one wizard step (see STEP_STAGES in PlanningPanel).
 */
export type PipelineStageId =
  | "business-requirement"
  | "proposed-site"
  | "existing-connectivity"
  | "landing-points"
  | "hypothetical-routes"
  | "environmental-analysis"
  | "data-centre-design"
  | "resilience"
  | "economics"
  | "recommendation";

export interface PipelineStageMeta {
  id: PipelineStageId;
  label: string;
  shortLabel: string;
}

export const PIPELINE_STAGES: PipelineStageMeta[] = [
  { id: "business-requirement", label: "Business Requirement", shortLabel: "Requirement" },
  { id: "proposed-site", label: "Proposed Site", shortLabel: "Site" },
  { id: "existing-connectivity", label: "Existing Connectivity", shortLabel: "Connectivity" },
  { id: "landing-points", label: "Landing Points", shortLabel: "Landing Pts" },
  { id: "hypothetical-routes", label: "Hypothetical Routes", shortLabel: "Routes" },
  { id: "environmental-analysis", label: "Environmental Analysis", shortLabel: "Environment" },
  { id: "data-centre-design", label: "Data Centre Design", shortLabel: "DC Design" },
  { id: "resilience", label: "Resilience", shortLabel: "Resilience" },
  { id: "economics", label: "Economics", shortLabel: "Economics" },
  { id: "recommendation", label: "Recommendation", shortLabel: "Decision" },
];
