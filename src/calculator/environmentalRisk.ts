// Illustrative environmental risk heuristic for a subsea DC's cable route to
// its nearest landing point.
//
// IMPORTANT: this is a simplified geographic heuristic (depth + latitude band
// + route length), NOT a lookup against real WDPA (protected areas), Allen
// Coral Atlas (reef), or GEBCO (bathymetry) datasets -- this app does not
// currently integrate those sources. Always present this as a modeled
// estimate for planning-discussion purposes, never as a measured/sourced
// risk score.
export type RiskLevel = "low" | "medium" | "high";

export interface RouteRiskEstimate {
  ecologicalSensitivity: RiskLevel;
  bathymetricHazard: RiskLevel;
  overall: RiskLevel;
  rationale: string[];
}

const RISK_ORDER: RiskLevel[] = ["low", "medium", "high"];

export function estimateRouteRisk(params: {
  depthM: number;
  latitude: number;
  routeDistanceKm: number;
}): RouteRiskEstimate {
  const { depthM, latitude, routeDistanceKm } = params;
  const rationale: string[] = [];

  // Ecological sensitivity: shallow + tropical/subtropical waters are where
  // coral reefs and coastal marine protected areas concentrate.
  const isTropicalBand = Math.abs(latitude) <= 30;
  let ecologicalSensitivity: RiskLevel = "low";
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
  };
}
