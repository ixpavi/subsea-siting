// Shared types for the hypothetical marine-cable routing engine (src/routing/*).
// Everything here describes a MODELED / HYPOTHETICAL proposed route -- never
// real infrastructure. See hypotheticalRouting.ts for the orchestration that
// produces these, provenance.ts for how each displayed value is classified,
// and design/RouteInspector.tsx for how they're presented.

export type EndpointKind = "real-landing-point" | "modeled-access-point" | "unavailable";

/**
 * Where a candidate route actually starts/ends in the ocean, distinguished
 * from the business location itself. A data centre is not on the seabed --
 * see terrestrialAccessKm for the gap between the two.
 */
export interface MarineEndpoint {
  kind: EndpointKind;
  businessLat: number;
  businessLng: number;
  businessLabel: string;
  lat: number | null;
  lng: number | null;
  landingPointName: string | null;
  landingPointId: string | null;
  /** Straight-line distance from the business site to the marine access point -- a separate, disclosed terrestrial segment, not part of the marine route length. */
  terrestrialAccessKm: number | null;
  note: string;
}

/**
 * One depth band from the derived grid, carrying BOTH bounds so the UI can
 * render a range ("1,000-2,000 m") instead of a bare lower bound. Reporting
 * only `minDepthM` was the defect that made every route display
 * "Minimum depth >= 0 m": for any route that touches the shelf -- i.e. every
 * route, since they all start at a coast -- the shallowest band's lower bound
 * is 0, which is true but carries no information and reads as a measurement.
 */
export interface DepthBandRange {
  index: number;
  minDepthM: number;
  /** null for the deepest band, which is open-ended. */
  maxDepthM: number | null;
  /** e.g. "1,000-2,000 m" or ">= 10,000 m". */
  label: string;
}

export interface DepthProfileSample {
  distanceAlongRouteKm: number;
  /** Band lower bound in metres. A bound, never a sounding -- see provenance.ts. */
  depthM: number;
  depthBandIndex: number;
}

export interface RouteAnalysis {
  marineDistanceKm: number;
  totalDistanceKm: number;
  depthProfile: DepthProfileSample[];
  /** null when no sample fell in a classified ocean cell (see unclassifiedSampleCount). */
  shallowestBand: DepthBandRange | null;
  deepestBand: DepthBandRange | null;
  dominantBand: DepthBandRange | null;
  /** Mean of band LOWER BOUNDS -- explicitly not a mean depth. Comparable across candidates; not meaningful in isolation. */
  meanDepthM: number | null;
  depthStdDevM: number;
  /** Samples that landed on a land/unclassified grid cell and were excluded from depth statistics rather than silently clamped to the shallowest ocean band. */
  unclassifiedSampleCount: number;
  classifiedSampleCount: number;
  /**
   * Continuous modeled seabed-difficulty index. Replaces the previous
   * LOW/MEDIUM/HIGH classification, which returned MEDIUM for every route
   * tested (measured index range across nine real pairs: 1.057-1.212, all
   * inside the single MEDIUM bin) and therefore contributed nothing to
   * ranking or explanation while appearing to. The underlying index does
   * vary and is now surfaced and ranked directly.
   */
  difficultyIndex: number;
  difficultyIndexBasis: string;
  dominantDepthBandLabel: string;
}

export interface EnvironmentalAssessment {
  available: boolean;
  reason: string;
  constrainedDistanceKm?: number;
  affectedZoneCount?: number;
  penaltyScore?: number;
}

export interface ResilienceAssessment {
  /** Fraction (0..1) of the route's sampled length within corridorThresholdKm of real cable geometry. */
  corridorOverlapFraction: number;
  meanDistanceToNearestCableKm: number;
  minDistanceToNearestCableKm: number;
  /** 0..1, higher = more physically diverse from the existing real cable network. Deterministic; NOT a failure-probability estimate. */
  diversityScore: number;
  corridorThresholdKm: number;
  methodNote: string;
}

export interface CostAssumptions {
  baseCostPerKmUsd: number;
  installationFactor: number;
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
  shortName: string;
  description: string;
  /** Full route geometry, source marine endpoint -> destination marine endpoint, as [lat,lng] pairs. */
  path: [number, number][];
  analysis: RouteAnalysis;
  environmental: EnvironmentalAssessment;
  resilience: ResilienceAssessment;
  cost: CostBreakdown;
}

/**
 * Ranking criteria. `cost` is deliberately absent: the cost model is a
 * deterministic function of route length and the difficulty index, both of
 * which are already criteria here, so including it made the score
 * double-count length. Measured before the fix: normalized cost and
 * normalized length were identical to three decimal places in 9/9 candidate
 * rows. Cost remains a displayed, derived estimate -- just not an
 * independent axis.
 */
export type RoutingCriterionId = "length" | "seabedDifficulty" | "resilience" | "environmental";

export interface RoutingWeights {
  length: number;
  seabedDifficulty: number;
  resilience: number;
  environmental: number;
}

export interface CriterionOutcome {
  id: RoutingCriterionId;
  label: string;
  /** False when every candidate scores identically -- such a criterion adds a constant to every score and is excluded from the weighted sum and from rationale text. */
  discriminates: boolean;
  /** False when no dataset backs this criterion at all (environmental today). */
  available: boolean;
  weight: number;
  /** Share of the final score this criterion actually accounted for, after excluding non-discriminating and unavailable criteria. */
  effectiveWeightShare: number;
}

export interface RankedRouteCandidate {
  candidate: RouteCandidate;
  score: number;
  normalized: Record<RoutingCriterionId, number>;
  /** Criterion ids this candidate is strictly best on AND that actually discriminate. Drives rationale text. */
  winsOn: RoutingCriterionId[];
  rank: number;
  isRecommended: boolean;
  whyText: string;
}

/**
 * Two candidates whose corridors are closer together than the resolution of
 * the data that produced them, and therefore cannot honestly be presented as
 * independent engineering alternatives.
 */
export interface DegeneratePair {
  a: RoutingProfileId;
  b: RoutingProfileId;
  meanSeparationKm: number;
  maxSeparationKm: number;
}

export interface RouteEngineResult {
  sourceEndpoint: MarineEndpoint;
  destinationEndpoint: MarineEndpoint;
  candidates: RankedRouteCandidate[];
  weights: RoutingWeights;
  criteria: CriterionOutcome[];
  /** Candidate pairs closer than separationThresholdKm. Never removed from the result -- surfaced so the user knows they are not independent options. */
  degeneratePairs: DegeneratePair[];
  /** One grid cell width. Derived from the grid, not chosen: corridors closer than one cell cannot be distinguished by the data that generated them. */
  separationThresholdKm: number;
  unavailableReason: string | null;
  gridProvenance: string;
}
