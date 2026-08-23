// Orchestrates the hypothetical marine-cable routing engine end to end:
//   business location -> marine endpoint resolution -> candidate marine
//   routes (routeCandidates.ts) -> per-candidate analysis/environmental/
//   resilience/cost -> deterministic MCDA ranking (same normalize -> weight
//   -> rank shape as calculator/recommend.ts) -> explained recommendation.
//
// Location-agnostic by construction: every step takes plain coordinates and
// the already-loaded real datasets, nothing here is specific to any city
// pair.
import type { CableFeature, LandingPoint } from "../types";
import type { OceanGrid } from "./oceanGrid";
import { findNearestOceanCell } from "./oceanGrid";
import { generateRouteCandidates } from "./routeCandidates";
import { computeRouteAnalysis } from "./routeAnalysis";
import { computeRouteResilience } from "./routeResilience";
import { assessEnvironmental } from "./environmentalConstraints";
import { computeCost } from "./routeCostModel";
import { buildCableProximityIndex } from "./cableProximityIndex";
import type {
  MarineEndpoint,
  RankedRouteCandidate,
  RouteCandidate,
  RouteEngineResult,
  RoutingWeights,
} from "./routingTypes";

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** A business location resolves inland/at a city centroid, not on the coast -- a data centre is never magically sitting on the seabed. This is generous but bounded (a much larger radius than connectivityAnalysis.ts's 80km, since a modeled NEW cable's landing site doesn't need to reuse an existing one within a tight radius the way "is this real cable relevant" does). */
const REAL_LANDING_POINT_SEARCH_RADIUS_KM = 120;

export function resolveMarineEndpoint(
  businessLat: number,
  businessLng: number,
  businessLabel: string,
  landingPoints: LandingPoint[],
  grid: OceanGrid
): MarineEndpoint {
  let nearestLP: LandingPoint | null = null;
  let nearestLPDist = Infinity;
  for (const lp of landingPoints) {
    const d = haversineKm(businessLat, businessLng, lp.lat, lp.lng);
    if (d < nearestLPDist) {
      nearestLPDist = d;
      nearestLP = lp;
    }
  }

  if (nearestLP && nearestLPDist <= REAL_LANDING_POINT_SEARCH_RADIUS_KM) {
    return {
      kind: "real-landing-point",
      businessLat,
      businessLng,
      businessLabel,
      lat: nearestLP.lat,
      lng: nearestLP.lng,
      landingPointName: nearestLP.name,
      landingPointId: nearestLP.id,
      terrestrialAccessKm: nearestLPDist,
      note: `Nearest real cable landing point (${nearestLP.name}, ${nearestLPDist.toFixed(0)} km away) used as the marine access point. This does not mean this landing point would actually host a new cable -- it is the closest real, verified coastal cable infrastructure to the proposed site, used here as a plausible marine start point.`,
    };
  }

  const nearestOcean = findNearestOceanCell(grid, businessLat, businessLng);
  if (nearestOcean) {
    return {
      kind: "modeled-access-point",
      businessLat,
      businessLng,
      businessLabel,
      lat: nearestOcean.lat,
      lng: nearestOcean.lng,
      landingPointName: null,
      landingPointId: null,
      terrestrialAccessKm: nearestOcean.distanceKm,
      note: `No real cable landing point found within ${REAL_LANDING_POINT_SEARCH_RADIUS_KM} km. A MODELED coastal access point was derived from the nearest routable ocean cell in this engine's ${grid.resolutionDeg}° grid (${nearestOcean.distanceKm.toFixed(0)} km away) -- this is a proposed access point, not a surveyed or verified cable landing site.`,
    };
  }

  return {
    kind: "unavailable",
    businessLat,
    businessLng,
    businessLabel,
    lat: null,
    lng: null,
    landingPointName: null,
    landingPointId: null,
    terrestrialAccessKm: null,
    note: "No real landing point and no reachable ocean cell were found near this location -- a marine access point could not be established, so hypothetical routing cannot proceed from this endpoint.",
  };
}

export const DEFAULT_ROUTING_WEIGHTS: RoutingWeights = { cost: 1, resilience: 1, environmental: 1, length: 1 };

function normalize(values: number[], higherIsBetter: boolean): number[] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return values.map(() => 1);
  return values.map((v) => (higherIsBetter ? (v - min) / (max - min) : (max - v) / (max - min)));
}

const DIFFICULTY_NUMERIC: Record<string, number> = { LOW: 0, MEDIUM: 0.5, HIGH: 1 };

function rankCandidates(candidates: RouteCandidate[], weights: RoutingWeights): RankedRouteCandidate[] {
  const anyEnvironmentalAvailable = candidates.some((c) => c.environmental.available);

  const nCost = normalize(candidates.map((c) => c.cost.totalUsd), false);
  const nLength = normalize(candidates.map((c) => c.analysis.totalDistanceKm), false);
  const nDifficulty = normalize(candidates.map((c) => DIFFICULTY_NUMERIC[c.analysis.seabedDifficulty]), false);
  const nResilience = normalize(candidates.map((c) => c.resilience.diversityScore), true);
  const nEnvironmental = anyEnvironmentalAvailable
    ? normalize(candidates.map((c) => 1 - (c.environmental.penaltyScore ?? 0)), true)
    : candidates.map(() => 1); // no data -> contributes nothing differentiating, not a fabricated "clean" score used to justify ranking

  const activeWeights = {
    cost: weights.cost,
    length: weights.length,
    resilience: weights.resilience,
    environmental: anyEnvironmentalAvailable ? weights.environmental : 0,
  };
  // Seabed difficulty is always folded in at a fixed, modest share alongside the user-configurable axes -- it isn't exposed as a separate user weight since it's already priced into cost via the terrain penalty; this second inclusion is for route selection distinctiveness on its own axis.
  const difficultyWeight = 0.5;
  const totalWeight =
    activeWeights.cost + activeWeights.length + activeWeights.resilience + activeWeights.environmental + difficultyWeight || 1;

  const scored = candidates.map((candidate, i) => {
    const score =
      (activeWeights.cost * nCost[i] +
        activeWeights.length * nLength[i] +
        activeWeights.resilience * nResilience[i] +
        activeWeights.environmental * nEnvironmental[i] +
        difficultyWeight * nDifficulty[i]) /
      totalWeight;
    return {
      candidate,
      score,
      normalized: { cost: nCost[i], length: nLength[i], seabedDifficulty: nDifficulty[i], resilience: nResilience[i], environmental: nEnvironmental[i] },
    };
  });

  scored.sort((a, b) => b.score - a.score);

  return scored.map((s, i) => ({
    ...s,
    rank: i + 1,
    isRecommended: i === 0,
    whyText: buildWhyText(s.candidate, s.normalized, scored[0].candidate === s.candidate, candidates),
  }));
}

function buildWhyText(
  candidate: RouteCandidate,
  normalized: { cost: number; length: number; seabedDifficulty: number; resilience: number; environmental: number },
  isTop: boolean,
  allCandidates: RouteCandidate[]
): string {
  const reasons: string[] = [];
  const isBestOf = (metric: (c: RouteCandidate) => number, lowerIsBetter: boolean) => {
    const values = allCandidates.map(metric);
    const best = lowerIsBetter ? Math.min(...values) : Math.max(...values);
    return metric(candidate) === best;
  };

  if (isBestOf((c) => c.cost.totalUsd, true)) reasons.push("lowest estimated modeled cost");
  if (isBestOf((c) => c.analysis.totalDistanceKm, true)) reasons.push("shortest total connection distance");
  if (isBestOf((c) => DIFFICULTY_NUMERIC[c.analysis.seabedDifficulty], true)) reasons.push("lowest modeled seabed difficulty");
  if (isBestOf((c) => c.resilience.diversityScore, false)) reasons.push("highest route diversity from existing cable corridors");

  if (reasons.length === 0) {
    reasons.push(
      `a balanced combination across cost (${(normalized.cost * 100).toFixed(0)}/100), distance (${(normalized.length * 100).toFixed(0)}/100), seabed difficulty (${(normalized.seabedDifficulty * 100).toFixed(0)}/100) and route diversity (${(normalized.resilience * 100).toFixed(0)}/100), normalized against the other candidates`
    );
  }

  const prefix = isTop ? `${candidate.label} is recommended because it has the ` : `${candidate.label} was not selected as top-ranked; it has the `;
  return `${prefix}${reasons.join(" and ")}, under your current priority weighting.`;
}

export interface HypotheticalRoutingInputs {
  sourceLat: number;
  sourceLng: number;
  sourceLabel: string;
  destLat: number;
  destLng: number;
  destLabel: string;
  cables: CableFeature[];
  landingPoints: LandingPoint[];
  grid: OceanGrid;
  weights?: RoutingWeights;
}

export function runHypotheticalRouting(inputs: HypotheticalRoutingInputs): RouteEngineResult {
  const weights = inputs.weights ?? DEFAULT_ROUTING_WEIGHTS;

  const sourceEndpoint = resolveMarineEndpoint(inputs.sourceLat, inputs.sourceLng, inputs.sourceLabel, inputs.landingPoints, inputs.grid);
  const destinationEndpoint = resolveMarineEndpoint(inputs.destLat, inputs.destLng, inputs.destLabel, inputs.landingPoints, inputs.grid);

  const gridProvenance = inputs.grid.provenance;

  if (sourceEndpoint.kind === "unavailable" || destinationEndpoint.kind === "unavailable") {
    return {
      sourceEndpoint,
      destinationEndpoint,
      candidates: [],
      weights,
      unavailableReason:
        "A marine access point could not be established for " +
        [sourceEndpoint.kind === "unavailable" ? sourceEndpoint.businessLabel : null, destinationEndpoint.kind === "unavailable" ? destinationEndpoint.businessLabel : null]
          .filter(Boolean)
          .join(" and ") +
        ". New-cable route analysis cannot proceed without a feasible marine start and end point, but this does not mean planning is impossible in general -- it means this specific location pair couldn't be resolved against the current ocean grid.",
      gridProvenance,
    };
  }

  const geometries = generateRouteCandidates(
    inputs.grid,
    inputs.cables,
    { lat: sourceEndpoint.lat!, lng: sourceEndpoint.lng! },
    { lat: destinationEndpoint.lat!, lng: destinationEndpoint.lng! }
  );

  const cableIndex = buildCableProximityIndex(inputs.cables);

  const candidates: RouteCandidate[] = [];
  for (const geo of geometries) {
    if (!geo.found || geo.path.length < 2) continue;
    const analysis = computeRouteAnalysis(inputs.grid, geo.path, sourceEndpoint.terrestrialAccessKm, destinationEndpoint.terrestrialAccessKm);
    const environmental = assessEnvironmental(geo.path);
    const resilience = computeRouteResilience(cableIndex, geo.path);
    const cost = computeCost(analysis, environmental);
    candidates.push({
      id: geo.profile.id,
      label: geo.profile.label,
      shortName: geo.profile.shortName,
      description: geo.profile.description,
      path: geo.path,
      analysis,
      environmental,
      resilience,
      cost,
    });
  }

  if (candidates.length === 0) {
    return {
      sourceEndpoint,
      destinationEndpoint,
      candidates: [],
      weights,
      unavailableReason: "No marine path could be found between the resolved endpoints within this engine's ocean grid.",
      gridProvenance,
    };
  }

  const ranked = rankCandidates(candidates, weights);

  return { sourceEndpoint, destinationEndpoint, candidates: ranked, weights, unavailableReason: null, gridProvenance };
}
