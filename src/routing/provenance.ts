// Structural provenance model for every routing value the UI displays.
//
// WHY THIS IS A TYPE AND NOT A BADGE: the honesty problem this solves is not
// "some numbers lack a label" -- it is that a number's epistemic status was
// previously carried in prose, next to the number, by convention. Prose
// drifts: a metric gets added, the disclaimer doesn't, and the UI silently
// starts asserting more than the data supports. Here the classification is a
// compile-time-checked registry keyed by a closed union of metric ids, so a
// metric that isn't classified cannot be rendered through the provenance-aware
// UI path at all.
//
// The five classes are deliberately distinguished by TRANSFORMATION, not by
// origin. Data that came from a real dataset but has been classified,
// rasterized, simplified or interpolated is DERIVED, never REAL -- "it came
// from GEBCO" does not make a 0.5-degree band index a measurement.

export type ProvenanceClass =
  /** Verbatim from a real external dataset, unmodified. */
  | "REAL"
  /** Computed from real data by a transformation that loses information (classification, rasterization, simplification, interpolation, geometric search). Truthful about the world, but not a measurement of it. */
  | "DERIVED"
  /** Produced by a model whose structure we chose. The inputs may be real; the output is an opinion expressed as arithmetic. */
  | "MODELED"
  /** A coefficient or threshold with no external source, held fixed so results are reproducible. Should be user-editable and is never a fact about the world. */
  | "USER_ASSUMPTION"
  /** No dataset backing this exists in the app. Explicitly NOT "no constraints found". */
  | "UNAVAILABLE";

export interface ProvenanceDescriptor {
  provenance: ProvenanceClass;
  /** One line stating exactly what was done to the source data to produce this value. Rendered to the user, so it must be specific enough to audit. */
  basis: string;
}

/** Closed set of routing metrics the UI is allowed to display with provenance. Adding a displayed metric requires adding it here first -- that is the point. */
export type RouteMetricId =
  | "routeGeometry"
  | "marineDistanceKm"
  | "totalDistanceKm"
  | "terrestrialAccessKm"
  | "marineEndpointReal"
  | "marineEndpointModeled"
  | "depthBand"
  | "meanDepth"
  | "dominantDepthBand"
  | "difficultyIndex"
  | "corridorOverlap"
  | "diversityScore"
  | "costEstimate"
  | "costCoefficient"
  // Environmental exposure has TWO provenances, not one, and which applies is
  // decided per route at runtime. A single entry cannot express that: it was
  // pinned to UNAVAILABLE from before any environmental dataset existed, and
  // once the protected-area layer was added the chip went on asserting that
  // nothing was integrated -- directly beside a completed assessment citing the
  // World Database on Protected Areas. That is precisely the drift this module
  // was built to prevent, occurring inside the module itself.
  | "environmentalAssessed"
  | "environmentalUnavailable"
  | "overallScore"
  | "candidateSeparation";

export const ROUTE_METRIC_PROVENANCE: Record<RouteMetricId, ProvenanceDescriptor> = {
  routeGeometry: {
    provenance: "DERIVED",
    basis:
      "A* shortest-path over a rasterized 0.5-degree ocean grid, then simplified. Follows real land/water geometry but is quantized to ~55km cells and 45-degree headings.",
  },
  marineDistanceKm: {
    provenance: "DERIVED",
    basis:
      "Haversine length of the derived grid path. An 8-connected grid quantizes headings to 45 degrees, so this can overstate a true geodesic route by up to roughly 8%.",
  },
  totalDistanceKm: {
    provenance: "DERIVED",
    basis: "Marine distance plus straight-line terrestrial access at each end. Not a routed terrestrial path.",
  },
  terrestrialAccessKm: {
    provenance: "DERIVED",
    basis: "Straight-line (great-circle) distance from the business location to the marine access point. Not a routed backhaul path.",
  },
  marineEndpointReal: {
    provenance: "REAL",
    basis: "Coordinates of an existing cable landing point from the TeleGeography-derived dataset, used unmodified.",
  },
  marineEndpointModeled: {
    provenance: "MODELED",
    basis:
      "Nearest routable ocean cell in the 0.5-degree grid. A proposed access point, not a surveyed or verified landing site.",
  },
  depthBand: {
    provenance: "DERIVED",
    basis:
      "Band classification derived from the modelled depth at this cell, using the same 12 thresholds the grid has always used. The depth itself is NOAA NCEI's global DEM mosaic resampled to 0.5 degrees; the band is a summary of it, and neither is a sounding.",
  },
  meanDepth: {
    provenance: "DERIVED",
    basis:
      "Arithmetic mean of the modelled depth at each sampled point along the route. A real mean of modelled depths -- it was previously a mean of band lower bounds, which was not a depth at all.",
  },
  dominantDepthBand: {
    provenance: "DERIVED",
    basis: "The single band covering the largest share of sampled route length.",
  },
  difficultyIndex: {
    provenance: "MODELED",
    basis:
      "Mean of per-band difficulty multipliers plus a depth-variability term. The multipliers are chosen engineering assumptions, not measured lay-difficulty data.",
  },
  corridorOverlap: {
    provenance: "DERIVED",
    basis:
      "Share of sampled route length within the corridor threshold of real TeleGeography cable geometry, measured by point-to-segment distance.",
  },
  diversityScore: {
    provenance: "MODELED",
    basis:
      "Chosen combination of corridor overlap and mean separation. A physical-diversity indicator, NOT a failure probability.",
  },
  costEstimate: {
    provenance: "MODELED",
    basis:
      "Derived deterministically from route length and the modeled difficulty index using unsourced coefficients. Not a quotation and not an independent ranking criterion.",
  },
  costCoefficient: {
    provenance: "USER_ASSUMPTION",
    basis: "Fixed, unsourced coefficient held constant for reproducibility. Not a market price.",
  },
  environmentalAssessed: {
    provenance: "DERIVED",
    basis:
      "Share of sampled route length crossing marine protected areas, measured against the World Database on " +
      "Protected Areas (European extract via EMODnet Human Activities) rasterised to ~11 km cells. Indicates " +
      "PROXIMITY to protected water, not a legal boundary.",
  },
  environmentalUnavailable: {
    provenance: "UNAVAILABLE",
    basis:
      "No protected-area data covers this route -- it lies outside the European extract's extent, or the grid " +
      "could not be loaded. Reported as unavailable, NOT as an absence of constraints: the uncovered part could " +
      "contain protected water, and scoring it as clear would misrepresent missing data as environmental safety.",
  },
  overallScore: {
    provenance: "MODELED",
    basis:
      "Weighted sum of normalized criteria that actually discriminate between candidates, using user-set priority weights.",
  },
  candidateSeparation: {
    provenance: "DERIVED",
    basis: "Mean point-to-path separation between two candidate corridors, sampled along their derived geometry.",
  },
};

export const PROVENANCE_LABEL: Record<ProvenanceClass, string> = {
  REAL: "REAL DATA",
  DERIVED: "DERIVED",
  MODELED: "MODELED",
  USER_ASSUMPTION: "USER ASSUMPTION",
  UNAVAILABLE: "UNAVAILABLE",
};
