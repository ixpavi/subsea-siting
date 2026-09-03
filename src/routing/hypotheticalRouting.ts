// Orchestrates the hypothetical marine-cable routing engine end to end:
//   business location -> marine endpoint resolution -> candidate marine
//   routes (routeCandidates.ts) -> per-candidate analysis/environmental/
//   resilience/cost -> deterministic criterion-aware MCDA ranking ->
//   explained recommendation.
//
// Location-agnostic by construction: every step takes plain coordinates and
// the already-loaded real datasets.
import type { CableFeature, LandingPoint } from "../types";
import type { OceanGrid } from "./oceanGrid";
import { findNearestOceanCell } from "./oceanGrid";
import { generateRouteCandidates, getCableProximityIndex } from "./routeCandidates";
import { computeRouteAnalysis } from "./routeAnalysis";
import { computeRouteResilience } from "./routeResilience";
import { assessEnvironmental } from "./environmentalConstraints";
import type { ProtectedAreaGrid } from "./protectedAreas";
import { computeCost } from "./routeCostModel";
import type {
  CriterionOutcome,
  DegeneratePair,
  MarineEndpoint,
  RankedRouteCandidate,
  RouteCandidate,
  RouteEngineResult,
  RoutingCriterionId,
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

/** A business location resolves inland/at a city centroid, not on the coast. Generous but bounded. */
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

/**
 * Default weights, all equal.
 *
 * `environmental` is weighted like any other axis. Whether it actually counts
 * is decided per route by whether the protected-area grid covers it: a route
 * outside the European extract reports the criterion unavailable and it is
 * excluded from scoring rather than silently treated as "no constraints". This
 * comment previously said no environmental dataset was integrated, which
 * stopped being true when routing/protectedAreas.ts was added.
 */
export const DEFAULT_ROUTING_WEIGHTS: RoutingWeights = {
  length: 1,
  seabedDifficulty: 1,
  resilience: 1,
  environmental: 1,
};

function normalize(values: number[], higherIsBetter: boolean): number[] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return values.map(() => 1);
  return values.map((v) => (higherIsBetter ? (v - min) / (max - min) : (max - v) / (max - min)));
}

const CRITERION_LABELS: Record<RoutingCriterionId, string> = {
  length: "total connection distance",
  seabedDifficulty: "modeled seabed difficulty",
  resilience: "route diversity from existing cable corridors",
  environmental: "environmental exposure",
};

export interface CriterionState {
  id: RoutingCriterionId;
  weight: number;
  available: boolean;
  raw: number[];
  normalized: number[];
  higherIsBetter: boolean;
  discriminates: boolean;
  /** Index of the single best candidate, or null when the best value is tied. */
  uniqueWinner: number | null;
}

/**
 * Exported for testing. The uniqueness rule below cannot be exercised through
 * runHypotheticalRouting with real data, because live candidates never
 * produce exactly equal floating-point criterion values -- yet a tie is
 * precisely the case that caused every candidate to claim "lowest modeled
 * seabed difficulty" simultaneously. Ties have to be constructed deliberately.
 */
export function buildCriterion(
  id: RoutingCriterionId,
  raw: number[],
  higherIsBetter: boolean,
  weight: number,
  available: boolean
): CriterionState {
  const min = Math.min(...raw);
  const max = Math.max(...raw);
  // A criterion on which every candidate scores identically adds the same
  // constant to every score. Including it changes no ranking while diluting
  // the weights of criteria that DO discriminate, and -- worse -- it lets
  // every candidate simultaneously claim to "win" it in the rationale.
  const discriminates = available && weight > 0 && max !== min;
  const bestValue = higherIsBetter ? max : min;
  const bestIndices = raw.map((v, i) => (v === bestValue ? i : -1)).filter((i) => i >= 0);
  return {
    id,
    weight,
    available,
    raw,
    normalized: normalize(raw, higherIsBetter),
    higherIsBetter,
    discriminates,
    // Only a UNIQUE best genuinely differentiates a candidate. A shared best
    // does not distinguish the tied candidates from each other.
    uniqueWinner: discriminates && bestIndices.length === 1 ? bestIndices[0] : null,
  };
}

function buildWhyText(
  rank: number,
  shortName: string,
  winsOn: RoutingCriterionId[],
  topShortName: string,
  topRank: number,
  anyCriterionDiscriminates: boolean
): string {
  const name = `ROUTE ${rank} (${shortName})`;
  const wins = winsOn.map((id) => CRITERION_LABELS[id]);
  const isTop = rank === topRank;

  if (!anyCriterionDiscriminates) {
    return `${name}: all candidates scored identically on every available criterion, so no criterion distinguishes them. The ranking here is arbitrary and should not be read as a preference.`;
  }

  if (isTop) {
    if (wins.length === 0) {
      return `${name} is recommended on the weighted balance of criteria rather than by leading any single one -- it does not have the best value for any individual criterion, but scores highest overall under your current weighting.`;
    }
    return `${name} is recommended because it has the best ${wins.join(" and ")} of the candidates generated, under your current weighting.`;
  }

  if (wins.length === 0) {
    return `${name} ranked below ROUTE ${topRank} (${topShortName}) and does not lead on any criterion that differentiates these candidates.`;
  }
  return `${name} leads on ${wins.join(" and ")}, but ranked below ROUTE ${topRank} (${topShortName}) overall under your current weighting.`;
}

/** Resamples a polyline at ~stepKm for separation measurement. */
function resample(path: [number, number][], stepKm: number): [number, number][] {
  if (path.length < 2) return path;
  const segs: number[] = [];
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const d = haversineKm(path[i][0], path[i][1], path[i + 1][0], path[i + 1][1]);
    segs.push(d);
    total += d;
  }
  const n = Math.max(2, Math.ceil(total / stepKm));
  const out: [number, number][] = [];
  for (let s = 0; s <= n; s++) {
    const target = (s / n) * total;
    let cum = 0;
    let si = 0;
    while (si < segs.length - 1 && cum + segs[si] < target) {
      cum += segs[si];
      si++;
    }
    const t = Math.max(0, Math.min(1, (target - cum) / (segs[si] || 1e-9)));
    out.push([path[si][0] + (path[si + 1][0] - path[si][0]) * t, path[si][1] + (path[si + 1][1] - path[si][1]) * t]);
  }
  return out;
}

function minDistanceToSampledPath(lat: number, lng: number, other: [number, number][]): number {
  let best = Infinity;
  for (const [plat, plng] of other) {
    const d = haversineKm(lat, lng, plat, plng);
    if (d < best) best = d;
  }
  return best;
}

/**
 * Candidates whose corridors are closer together than one grid cell cannot be
 * distinguished by the data that produced them, so presenting them as
 * independent engineering alternatives is not defensible. The threshold is
 * DERIVED from the grid rather than chosen: it is the resolution limit of the
 * bathymetry driving the search. (Measured example before this check existed:
 * Chennai->Singapore's "shortest" and "depth-favorable" candidates were a mean
 * of 13km apart -- roughly a quarter of one cell -- yet were shown as two
 * options with distinct scores.)
 *
 * SEPARATION IS THE MAXIMUM, NOT THE MEAN. The first version tested the mean
 * and produced a false positive that matters: a pair sharing most of their
 * length but diverging by 2,533 km at the widest point averaged below the
 * threshold and was reported as indistinguishable. Those are emphatically
 * different routes -- different waters, different landfall approaches,
 * different failure modes -- and suppressing one of them would have hidden a
 * real alternative from the user. Two routes are only interchangeable if they
 * stay together for their WHOLE length, which is what the maximum measures.
 * The mean is still reported, because it is informative, but it does not
 * decide anything.
 *
 * SEPARATION IS ALSO SYMMETRIC. Measuring only from A's samples to B's path
 * misses an excursion that B makes and A does not: every one of A's points can
 * sit on B while B swings hundreds of km away in between. This computes both
 * directions and takes the larger -- the Hausdorff distance -- so a detour by
 * either route counts.
 */
/** Exported for testing: the false-positive this guards against needs
 *  hand-built geometry to reproduce, which real routing results rarely give. */
export function findDegeneratePairs(
  candidates: RouteCandidate[],
  thresholdKm: number
): DegeneratePair[] {
  const sampled = candidates.map((c) => resample(c.path, 10));
  const pairs: DegeneratePair[] = [];
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const forward = sampled[i].map(([la, ln]) => minDistanceToSampledPath(la, ln, sampled[j]));
      const backward = sampled[j].map(([la, ln]) => minDistanceToSampledPath(la, ln, sampled[i]));
      if (forward.length === 0 || backward.length === 0) continue;
      const all = forward.concat(backward);
      const meanSeparationKm = all.reduce((a, b) => a + b, 0) / all.length;
      const maxSeparationKm = Math.max(...all);
      if (maxSeparationKm < thresholdKm) {
        pairs.push({ a: candidates[i].id, b: candidates[j].id, meanSeparationKm, maxSeparationKm });
      }
    }
  }
  return pairs;
}

function rankCandidates(
  candidates: RouteCandidate[],
  weights: RoutingWeights
): { ranked: RankedRouteCandidate[]; criteria: CriterionOutcome[] } {
  const environmentalAvailable = candidates.some((c) => c.environmental.available);

  const criteria: CriterionState[] = [
    buildCriterion("length", candidates.map((c) => c.analysis.totalDistanceKm), false, weights.length, true),
    buildCriterion(
      "seabedDifficulty",
      candidates.map((c) => c.analysis.difficultyIndex),
      false,
      weights.seabedDifficulty,
      true
    ),
    buildCriterion(
      "resilience",
      candidates.map((c) => c.resilience.diversityScore),
      true,
      weights.resilience,
      true
    ),
    buildCriterion(
      "environmental",
      candidates.map((c) => 1 - (c.environmental.penaltyScore ?? 0)),
      true,
      weights.environmental,
      environmentalAvailable
    ),
  ];

  const active = criteria.filter((c) => c.discriminates);
  const totalActiveWeight = active.reduce((a, c) => a + c.weight, 0);

  const scored = candidates.map((candidate, i) => {
    const score =
      totalActiveWeight > 0
        ? active.reduce((acc, c) => acc + c.weight * c.normalized[i], 0) / totalActiveWeight
        : 1; // nothing discriminates -- every candidate is genuinely equivalent
    const normalized = Object.fromEntries(criteria.map((c) => [c.id, c.normalized[i]])) as Record<
      RoutingCriterionId,
      number
    >;
    const winsOn = criteria.filter((c) => c.uniqueWinner === i).map((c) => c.id);
    return { candidate, score, normalized, winsOn };
  });

  scored.sort((a, b) => b.score - a.score);

  const topShortName = scored[0].candidate.shortName;
  const ranked: RankedRouteCandidate[] = scored.map((s, i) => ({
    ...s,
    rank: i + 1,
    isRecommended: i === 0,
    whyText: buildWhyText(i + 1, s.candidate.shortName, s.winsOn, topShortName, 1, active.length > 0),
  }));

  const outcomes: CriterionOutcome[] = criteria.map((c) => ({
    id: c.id,
    label: CRITERION_LABELS[c.id],
    discriminates: c.discriminates,
    available: c.available,
    weight: c.weight,
    effectiveWeightShare: c.discriminates && totalActiveWeight > 0 ? c.weight / totalActiveWeight : 0,
  }));

  return { ranked, criteria: outcomes };
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
  /** Marine protected areas. Optional: when absent the environmental criterion
   *  reports unavailable, exactly as it did before any dataset existed. */
  protectedAreas?: ProtectedAreaGrid | null;
  weights?: RoutingWeights;
}

export function runHypotheticalRouting(inputs: HypotheticalRoutingInputs): RouteEngineResult {
  const weights = inputs.weights ?? DEFAULT_ROUTING_WEIGHTS;
  const gridProvenance = inputs.grid.provenance;
  // One grid cell at the equator -- the resolution limit of the data driving the search.
  const separationThresholdKm = inputs.grid.resolutionDeg * 111.32;

  const sourceEndpoint = resolveMarineEndpoint(inputs.sourceLat, inputs.sourceLng, inputs.sourceLabel, inputs.landingPoints, inputs.grid);
  const destinationEndpoint = resolveMarineEndpoint(inputs.destLat, inputs.destLng, inputs.destLabel, inputs.landingPoints, inputs.grid);

  const emptyResult = (unavailableReason: string): RouteEngineResult => ({
    sourceEndpoint,
    destinationEndpoint,
    candidates: [],
    weights,
    criteria: [],
    degeneratePairs: [],
    separationThresholdKm,
    unavailableReason,
    gridProvenance,
  });

  if (sourceEndpoint.kind === "unavailable" || destinationEndpoint.kind === "unavailable") {
    return emptyResult(
      "A marine access point could not be established for " +
        [
          sourceEndpoint.kind === "unavailable" ? sourceEndpoint.businessLabel : null,
          destinationEndpoint.kind === "unavailable" ? destinationEndpoint.businessLabel : null,
        ]
          .filter(Boolean)
          .join(" and ") +
        ". New-cable route analysis cannot proceed without a feasible marine start and end point, but this does not mean planning is impossible in general -- it means this specific location pair couldn't be resolved against the current ocean grid."
    );
  }

  const geometries = generateRouteCandidates(
    inputs.grid,
    inputs.cables,
    { lat: sourceEndpoint.lat!, lng: sourceEndpoint.lng! },
    { lat: destinationEndpoint.lat!, lng: destinationEndpoint.lng! }
  );

  // Same instance generateRouteCandidates just used -- see getCableProximityIndex.
  const cableIndex = getCableProximityIndex(inputs.cables);

  const candidates: RouteCandidate[] = [];
  for (const geo of geometries) {
    if (!geo.found || geo.path.length < 2) continue;
    const analysis = computeRouteAnalysis(inputs.grid, geo.path, sourceEndpoint.terrestrialAccessKm, destinationEndpoint.terrestrialAccessKm);
    const environmental = assessEnvironmental(geo.path, inputs.protectedAreas ?? null);
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
    return emptyResult("No marine path could be found between the resolved endpoints within this engine's ocean grid.");
  }

  const { ranked, criteria } = rankCandidates(candidates, weights);
  const degeneratePairs = findDegeneratePairs(candidates, separationThresholdKm);

  return {
    sourceEndpoint,
    destinationEndpoint,
    candidates: ranked,
    weights,
    criteria,
    degeneratePairs,
    separationThresholdKm,
    unavailableReason: null,
    gridProvenance,
  };
}
