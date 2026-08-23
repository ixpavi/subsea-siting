// Shared types for the hypothetical marine-cable routing engine (src/routing/*).
// Everything here describes a MODELED / HYPOTHETICAL proposed route -- never
// real infrastructure. See hypotheticalRouting.ts for the orchestration that
// produces these, and design/RouteInspector.tsx for how they're presented
// (always under a MODELED / HYPOTHETICAL banner, never alongside real cable
// data without that label).

export type EndpointKind = "real-landing-point" | "modeled-access-point" | "unavailable";

/**
 * Where a candidate route actually starts/ends in the ocean, distinguished
 * from the business location itself. A data centre site is not on the
 * seabed -- see terrestrialAccessKm for the gap between the two.
 */
export interface MarineEndpoint {
  kind: EndpointKind;
  /** The original business location (data-centre site / destination city), as resolved by geocoding. */
  businessLat: number;
  businessLng: number;
  businessLabel: string;
  /** The marine start/end point. Present unless kind === "unavailable". */
  lat: number | null;
  lng: number | null;
  /** Name of the real landing point used, only when kind === "real-landing-point". */
  landingPointName: string | null;
  landingPointId: string | null;
  /** Straight-line distance from the business site to the marine access point -- a separate, disclosed terrestrial segment, not part of the marine route length. */
  terrestrialAccessKm: number | null;
  note: string;
}

export type SeabedDifficulty = "LOW" | "MEDIUM" | "HIGH";

export interface DepthProfileSample {
  distanceAlongRouteKm: number;
  /** Band lower-bound depth in metres -- see oceanGrid.ts. Always a conservative "at least this deep" estimate, never a fabricated precise sounding. */
  depthM: number;
  depthBandIndex: number;
}

export interface RouteAnalysis {
  marineDistanceKm: number;
  totalDistanceKm: number; // marine + both terrestrial access legs
  depthProfile: DepthProfileSample[];
  minDepthM: number;
  maxDepthM: number;
  meanDepthM: number;
  depthStdDevM: number;
  seabedDifficulty: SeabedDifficulty;
  /** Human-readable basis for the difficulty label -- always shown next to it. */
  seabedDifficultyBasis: string;
  /** The single depth band covering the largest share of the route's sampled length, e.g. "continental slope/plain (1,000-2,000m band)" -- a one-line summary of the depth profile's shape, not a new data source. */
  dominantDepthBandLabel: string;
}

export interface EnvironmentalAssessment {
  available: boolean;
  reason: string;
  /** Only populated when available is true (no dataset integrated yet -- always false today, see environmentalConstraints.ts). */
  constrainedDistanceKm?: number;
  affectedZoneCount?: number;
  penaltyScore?: number; // 0..1, higher = more exposure
}

export interface ResilienceAssessment {
  /** Fraction (0..1) of the route's sampled length within CORRIDOR_THRESHOLD_KM of an existing real cable. */
  corridorOverlapFraction: number;
  meanDistanceToNearestCableKm: number;
  minDistanceToNearestCableKm: number;
  /** 0..1, higher = more physically diverse from the existing real cable network. Derived deterministically from the overlap/distance figures above -- not a failure-probability estimate. */
  diversityScore: number;
  corridorThresholdKm: number;
  methodNote: string;
}

export interface CostAssumptions {
  baseCostPerKmUsd: number;
  installationFactor: number;
  depthDifficultyMultiplier: Record<SeabedDifficulty, number>;
  shoreEndCostUsd: number;
  environmentalPenaltyPerConstrainedKmUsd: number;
  contingencyPct: number;
}

export interface CostBreakdown {
  lengthCostUsd: number;
  installationCostUsd: number;
  terrainPenaltyUsd: number;
  environmentalPenaltyUsd: number;
  shoreEndCostUsd: number;
  subtotalUsd: number;
  contingencyUsd: number;
  totalUsd: number;
  assumptions: CostAssumptions;
}

export type RoutingProfileId = "shortest" | "shallow-favoring" | "diverse-corridor";

export interface RouteCandidate {
  id: RoutingProfileId;
  label: string;
  /** Compact all-caps display name -- e.g. "SHORTEST", "DEPTH-FAVORING", "DIVERSITY-SEEKING". */
  shortName: string;
  description: string;
  /** Full route geometry, source marine endpoint -> destination marine endpoint, as [lat,lng] pairs. Real computed geometry -- not densified for hit-testing (Globe.tsx/react-globe.gl densifies for rendering the same way it does real cables). */
  path: [number, number][];
  analysis: RouteAnalysis;
  environmental: EnvironmentalAssessment;
  resilience: ResilienceAssessment;
  cost: CostBreakdown;
}

export interface RankedRouteCandidate {
  candidate: RouteCandidate;
  score: number;
  normalized: { cost: number; length: number; seabedDifficulty: number; resilience: number; environmental: number };
  rank: number;
  isRecommended: boolean;
  whyText: string;
}

export interface RoutingWeights {
  cost: number;
  resilience: number;
  environmental: number;
  /** Route length / directness. */
  length: number;
}

export interface RouteEngineResult {
  sourceEndpoint: MarineEndpoint;
  destinationEndpoint: MarineEndpoint;
  candidates: RankedRouteCandidate[];
  weights: RoutingWeights;
  /** Set when marine routing could not be attempted at all (e.g. no ocean cell reachable near an endpoint). Candidates will be empty in that case. */
  unavailableReason: string | null;
  gridProvenance: string;
}
