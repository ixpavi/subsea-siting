// Environmental risk for a subsea DC's cable route to its nearest landing
// point.
//
// TWO SOURCES, AND THE CALLER GETS TOLD WHICH. Ecological sensitivity is
// measured against the shipped WDPA protected-area grid wherever that grid
// covers the route, and falls back to a geographic heuristic (depth + latitude
// band) only outside its extent -- which today is everything but the European
// one of the four known subsea sites.
//
// The fallback was previously the ONLY path, while the routing engine two
// modules away was already reading real protected-area data. A latitude rule
// standing in for a dataset the app ships is not a limitation, it is a
// duplicate answer to a question already answered better.
//
// Bathymetric hazard remains a heuristic in both cases: the app's depth data
// is a 0.5-degree band index, not a sounding, and no shipped dataset scores
// lay-difficulty.
import type { EnvironmentalAssessment } from "../routing/routingTypes";

export type RiskLevel = "low" | "medium" | "high";

export interface RouteRiskEstimate {
  ecologicalSensitivity: RiskLevel;
  bathymetricHazard: RiskLevel;
  overall: RiskLevel;
  rationale: string[];
  /**
   * Where ecologicalSensitivity came from. "measured" means the shipped WDPA
   * grid covered the route and was used; "heuristic" means it did not and the
   * depth/latitude rule stood in. The UI must say which -- they are not the
   * same kind of claim.
   */
  ecologicalBasis: "measured" | "heuristic";
}

const RISK_ORDER: RiskLevel[] = ["low", "medium", "high"];

export function estimateRouteRisk(params: {
  depthM: number;
  latitude: number;
  routeDistanceKm: number;
  /**
   * Measured exposure to marine protected areas along the route, from the
   * shipped WDPA grid. Omit, or pass one whose `available` is false, when the
   * route lies outside the grid's extent -- the heuristic then stands in.
   */
  protectedAreaExposure?: EnvironmentalAssessment | null;
}): RouteRiskEstimate {
  const { depthM, latitude, routeDistanceKm, protectedAreaExposure } = params;
  const rationale: string[] = [];

  // Ecological sensitivity, measured if the data reaches this route.
  let ecologicalSensitivity: RiskLevel = "low";
  let ecologicalBasis: RouteRiskEstimate["ecologicalBasis"] = "heuristic";

  if (protectedAreaExposure?.available) {
    ecologicalBasis = "measured";
    const km = protectedAreaExposure.constrainedDistanceKm ?? 0;
    const zones = protectedAreaExposure.affectedZoneCount ?? 0;
    const share = routeDistanceKm > 0 ? km / routeDistanceKm : 0;

    // Thresholds are a presentation choice over a measured quantity, not a
    // substitute for one: the kilometres are real, the three buckets are ours.
    if (share >= 0.25 || zones >= 3) ecologicalSensitivity = "high";
    else if (km > 0) ecologicalSensitivity = "medium";

    rationale.push(
      km > 0
        ? `Measured against the World Database on Protected Areas: ${km.toFixed(1)} km of the route (${Math.round(share * 100)}%) lies within ${zones} protected area${zones === 1 ? "" : "s"}.`
        : "Measured against the World Database on Protected Areas: no protected water on this route."
    );
  } else {
    // Fallback: shallow + tropical/subtropical waters are where coral reefs
    // and coastal marine protected areas concentrate.
    const isTropicalBand = Math.abs(latitude) <= 30;
    if (depthM <= 50 && isTropicalBand) {
      ecologicalSensitivity = "high";
      rationale.push("Shallow (<=50m) route within the tropical/subtropical band (|lat| <= 30 deg), where reef and MPA density is typically highest.");
    } else if (depthM <= 50 || isTropicalBand) {
      ecologicalSensitivity = "medium";
      rationale.push(
        depthM <= 50
          ? "Shallow (<=50m) route -- higher chance of crossing nearshore reef or protected habitat."
          : "Route falls within the tropical/subtropical latitude band associated with reef ecosystems."
      );
    } else {
      rationale.push("Deeper, higher-latitude route -- lower likelihood of reef/MPA overlap.");
    }
    rationale.push(
      protectedAreaExposure?.reason ??
        "No protected-area data covers this route, so ecological sensitivity is inferred from depth and latitude rather than measured."
    );
  }

  // Bathymetric hazard: very shallow landing approaches carry surf-zone/
  // anchor-strike risk; very deep routes carry steep-slope/turbidity-current
  // fault risk. Mid-depth continental-shelf routes are the relative sweet spot.
  let bathymetricHazard: RiskLevel = "low";
  if (depthM > 1000 || depthM < 5) {
    bathymetricHazard = "high";
    rationale.push(
      depthM > 1000
        ? "Deep route -- elevated risk of steep continental-slope terrain and turbidity-current cable faults."
        : "Very shallow landing approach -- elevated surf-zone, anchor-strike, and fishing-gear risk."
    );
  } else if (depthM > 200 || depthM < 20) {
    bathymetricHazard = "medium";
    rationale.push("Route depth sits in a moderate-hazard band for slope or shallow-approach exposure.");
  } else {
    rationale.push("Continental-shelf depth range -- comparatively benign seabed terrain.");
  }

  // Longer routes statistically cross more seafloor and more risk zones.
  let lengthBump = 0;
  if (routeDistanceKm > 50) {
    lengthBump = 1;
    rationale.push(`Route length (${Math.round(routeDistanceKm)} km) adds cumulative exposure.`);
  }

  const overallIndex = Math.min(
    2,
    Math.max(RISK_ORDER.indexOf(ecologicalSensitivity), RISK_ORDER.indexOf(bathymetricHazard)) +
      (lengthBump && RISK_ORDER.indexOf(ecologicalSensitivity) === RISK_ORDER.indexOf(bathymetricHazard) ? lengthBump - 1 : 0)
  );

  return {
    ecologicalSensitivity,
    bathymetricHazard,
    overall: RISK_ORDER[overallIndex],
    rationale,
    ecologicalBasis,
  };
}
