// Real-data connectivity analysis: given a source (and optionally a
// destination) coordinate, determines which REAL submarine cable systems and
// landing points from the TeleGeography-backed dataset (public/data/cables.json,
// public/data/landing-points.json) are geographically relevant.
//
// Methodology (see `dataProvenance` on the result, and scripts/README.md for
// where the underlying data comes from):
//   1. Landing points within `searchRadiusKm` of a query coordinate are
//      "nearby" that endpoint. The radius is generous (default 80km) because
//      a geocoded city centroid (e.g. "Chennai, Tamil Nadu, India") sits
//      inland/away from the actual coastal cable landing station.
//   2. A cable is "relevant" to an endpoint if one of its path segments
//      starts or ends within `endpointMatchToleranceKm` of a nearby landing
//      point. cables.json stores each cable as a MultiLineString with no
//      explicit landing-point references, but its segment endpoints coincide
//      with landing-point coordinates from the same TeleGeography source to
//      within ~1km (verified against Chennai/Singapore landing points during
//      development) -- so this is a geometric join over real geometry, not a
//      fabricated or curated relationship.
// This module never invents a cable, landing point, or relationship that
// isn't present in the underlying dataset -- an endpoint with no landing
// point in range simply produces an empty list, surfaced as "unavailable".
import type { CableFeature, LandingPoint } from "../types";
import { mergeCablesById } from "../cableNetwork";

export const DEFAULT_SEARCH_RADIUS_KM = 80;
export const DEFAULT_ENDPOINT_MATCH_TOLERANCE_KM = 2;

export const CONNECTIVITY_DATA_PROVENANCE =
  "TeleGeography submarine cable & landing-point geometry (submarinecablemap.com), " +
  "joined by proximity: cable path segment endpoints matched to landing points within " +
  `${DEFAULT_ENDPOINT_MATCH_TOLERANCE_KM}km, landing points matched to the queried location ` +
  `within ${DEFAULT_SEARCH_RADIUS_KM}km. No cable-to-landing-point relationship in this dataset is curated or fabricated.`;

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export interface RelevantLandingPoint {
  id: string;
  name: string;
  lat: number;
  lng: number;
  distanceFromQueryKm: number;
}

export type CableRelevance = "direct" | "source-side" | "destination-side";

export interface RelevantCable {
  id: string;
  name: string;
  color: string;
  paths: [number, number][][];
  sourceLandingPoints: RelevantLandingPoint[];
  destinationLandingPoints: RelevantLandingPoint[];
  relevance: CableRelevance;
}

export interface EndpointConnectivity {
  lat: number;
  lng: number;
  /** Real landing points found within the search radius. Empty means the dataset has none nearby -- not that none exist. */
  landingPoints: RelevantLandingPoint[];
  /**
   * The closest landing points in the dataset REGARDLESS of the search
   * radius, nearest first, capped at NEAREST_LANDING_POINT_COUNT. Empty only
   * if the dataset itself is empty.
   *
   * WHY: an empty `landingPoints` has two very different causes that the UI
   * was previously reporting identically. Either the dataset is missing
   * coverage here, or the site is simply inland and no cable lands near it --
   * which is not missing data, it is geography, and the distance to the
   * nearest landing point is the useful answer (it is the terrestrial
   * backhaul the site would need). Reporting both as "unavailable" told a
   * planner nothing and misrepresented a real, knowable number as a gap.
   *
   * Deliberately NOT a user-adjustable radius. The 80km figure is what every
   * "cables nearby" count in this app is scored against, and letting it be
   * dragged would make those counts incomparable between sites while looking
   * identical. This widens the *explanation* without widening the measurement.
   */
  nearestLandingPoints: RelevantLandingPoint[];
}

export interface ConnectivityAnalysis {
  source: EndpointConnectivity;
  /** null only when no destination was supplied -- distinct from an endpoint that resolved but found nothing. */
  destination: EndpointConnectivity | null;
  relevantCables: RelevantCable[];
  /** Count of distinct real cable systems relevant to either endpoint. */
  cableSystemDiversity: number;
  /** Count of distinct real cable systems that land at BOTH the source and destination search areas. */
  directCableSystemDiversity: number;
  sourceLandingPointDiversity: number;
  destinationLandingPointDiversity: number | null;
  searchRadiusKm: number;
  endpointMatchToleranceKm: number;
  dataProvenance: string;
}

/**
 * How many nearest landing points to report when nothing falls inside the
 * radius. Enough to show whether the coast is one option or several -- a site
 * with four landing points within 500km has real choice, one with a single
 * option at 900km does not -- without turning an explanation into a directory.
 */
export const NEAREST_LANDING_POINT_COUNT = 4;

/**
 * Resolve one endpoint against the landing-point dataset in a single pass:
 * everything inside the radius, plus the nearest few whether or not they are
 * inside it. Sorted once and read twice, so the two answers cannot disagree
 * about which point is closest.
 */
function resolveEndpoint(
  lat: number,
  lng: number,
  landingPoints: LandingPoint[],
  radiusKm: number
): EndpointConnectivity {
  const byDistance = landingPoints
    .map((lp) => ({ ...lp, distanceFromQueryKm: haversineKm(lat, lng, lp.lat, lp.lng) }))
    .sort((a, b) => a.distanceFromQueryKm - b.distanceFromQueryKm);

  return {
    lat,
    lng,
    landingPoints: byDistance.filter((lp) => lp.distanceFromQueryKm <= radiusKm),
    nearestLandingPoints: byDistance.slice(0, NEAREST_LANDING_POINT_COUNT),
  };
}

/** First and last point of every path segment -- where a MultiLineString cable's branches actually terminate. */
function cableEndpoints(cable: CableFeature): [number, number][] {
  const pts: [number, number][] = [];
  for (const path of cable.paths) {
    if (path.length === 0) continue;
    pts.push(path[0]);
    if (path.length > 1) pts.push(path[path.length - 1]);
  }
  return pts;
}

function cableLandsAt(cable: CableFeature, landingPoint: RelevantLandingPoint, toleranceKm: number): boolean {
  return cableEndpoints(cable).some(
    ([lat, lng]) => haversineKm(lat, lng, landingPoint.lat, landingPoint.lng) <= toleranceKm
  );
}

export interface ConnectivityAnalysisOptions {
  searchRadiusKm?: number;
  endpointMatchToleranceKm?: number;
}

/**
 * Reusable for any source/destination pair -- takes only coordinates plus
 * the already-loaded real datasets, no location-specific logic.
 */
export function analyzeConnectivity(
  source: { lat: number; lng: number },
  destination: { lat: number; lng: number } | null,
  cables: CableFeature[],
  landingPoints: LandingPoint[],
  opts: ConnectivityAnalysisOptions = {}
): ConnectivityAnalysis {
  const searchRadiusKm = opts.searchRadiusKm ?? DEFAULT_SEARCH_RADIUS_KM;
  const toleranceKm = opts.endpointMatchToleranceKm ?? DEFAULT_ENDPOINT_MATCH_TOLERANCE_KM;

  const sourceEndpoint = resolveEndpoint(source.lat, source.lng, landingPoints, searchRadiusKm);
  const destEndpoint = destination
    ? resolveEndpoint(destination.lat, destination.lng, landingPoints, searchRadiusKm)
    : null;
  const sourceLPs = sourceEndpoint.landingPoints;
  const destLPs = destEndpoint ? destEndpoint.landingPoints : null;

  const mergedCables = mergeCablesById(cables);

  const relevantCables: RelevantCable[] = [];
  for (const cable of mergedCables) {
    const srcMatches = sourceLPs.filter((lp) => cableLandsAt(cable, lp, toleranceKm));
    const dstMatches = destLPs ? destLPs.filter((lp) => cableLandsAt(cable, lp, toleranceKm)) : [];
    if (srcMatches.length === 0 && dstMatches.length === 0) continue;

    const relevance: CableRelevance =
      srcMatches.length > 0 && dstMatches.length > 0
        ? "direct"
        : srcMatches.length > 0
          ? "source-side"
          : "destination-side";

    relevantCables.push({
      id: cable.id,
      name: cable.name,
      color: cable.color,
      paths: cable.paths,
      sourceLandingPoints: srcMatches,
      destinationLandingPoints: dstMatches,
      relevance,
    });
  }

  const relevanceRank: Record<CableRelevance, number> = { direct: 0, "source-side": 1, "destination-side": 2 };
  relevantCables.sort((a, b) => {
    if (relevanceRank[a.relevance] !== relevanceRank[b.relevance]) {
      return relevanceRank[a.relevance] - relevanceRank[b.relevance];
    }
    return a.name.localeCompare(b.name);
  });

  return {
    source: sourceEndpoint,
    destination: destEndpoint,
    relevantCables,
    cableSystemDiversity: relevantCables.length,
    directCableSystemDiversity: relevantCables.filter((c) => c.relevance === "direct").length,
    sourceLandingPointDiversity: sourceLPs.length,
    destinationLandingPointDiversity: destLPs ? destLPs.length : null,
    searchRadiusKm,
    endpointMatchToleranceKm: toleranceKm,
    dataProvenance: CONNECTIVITY_DATA_PROVENANCE,
  };
}
