// Shared real-data cable/landing-point network index -- the foundation for
// the interactive cable explorer (click a cable, click a landing point,
// search, directory). Built once from the same TeleGeography-backed
// datasets used everywhere else in the app (public/data/cables.json,
// public/data/landing-points.json); never fetches, scrapes, or embeds
// anything from submarinecablemap.com itself.
//
// A cable-to-landing-point "connection" here is the same geometric join
// documented in design/connectivityAnalysis.ts: a cable's path-segment
// endpoint coincides (within `toleranceKm`) with a landing point's
// coordinates. If no landing point is in range, the relationship is simply
// absent -- never inferred or fabricated.
import type { CableFeature, LandingPoint } from "./types";

/**
 * The source dataset splits some real cable systems across multiple
 * GeoJSON features that share the same `id` (e.g. separately-modeled
 * branches) -- without merging these first, the same real system would be
 * counted, listed, and highlighted as two systems. Merging by id is a
 * data-hygiene step over the join key, not a fabrication: paths are
 * concatenated as-is, nothing new is added or inferred.
 */
export function mergeCablesById(cables: CableFeature[]): CableFeature[] {
  const byId = new Map<string, CableFeature>();
  for (const cable of cables) {
    const existing = byId.get(cable.id);
    if (existing) {
      existing.paths = [...existing.paths, ...cable.paths];
    } else {
      byId.set(cable.id, { ...cable, paths: [...cable.paths] });
    }
  }
  return [...byId.values()];
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
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

export const DEFAULT_LINK_TOLERANCE_KM = 2;

export interface CableNetworkIndex {
  cablesById: Map<string, CableFeature>;
  landingPointsById: Map<string, LandingPoint>;
  /** Real landing points a cable system touches, in path order, deduplicated. */
  cableToLandingPoints: Map<string, LandingPoint[]>;
  /** Real cable systems that touch a landing point, sorted by name. */
  landingPointToCables: Map<string, CableFeature[]>;
}

/**
 * Built once from the loaded datasets (see App.tsx's useMemo) -- this is the
 * single source of truth for "what's connected to what" that the cable
 * explorer's highlighting, detail panels, and search all read from.
 */
export function buildCableNetworkIndex(
  rawCables: CableFeature[],
  landingPoints: LandingPoint[],
  toleranceKm: number = DEFAULT_LINK_TOLERANCE_KM
): CableNetworkIndex {
  const mergedCables = mergeCablesById(rawCables);
  const cablesById = new Map(mergedCables.map((c) => [c.id, c]));
  const landingPointsById = new Map(landingPoints.map((lp) => [lp.id, lp]));

  // Coarse 1-degree grid bucket (~111km cells, far larger than any sane
  // toleranceKm) so proximity lookups don't require scanning every landing
  // point for every cable endpoint.
  const grid = new Map<string, LandingPoint[]>();
  const bucketKey = (lat: number, lng: number) => `${Math.floor(lat)}:${Math.floor(lng)}`;
  for (const lp of landingPoints) {
    const key = bucketKey(lp.lat, lp.lng);
    const arr = grid.get(key);
    if (arr) arr.push(lp);
    else grid.set(key, [lp]);
  }
  function nearbyLandingPoints(lat: number, lng: number): LandingPoint[] {
    const latB = Math.floor(lat);
    const lngB = Math.floor(lng);
    const out: LandingPoint[] = [];
    for (let dLat = -1; dLat <= 1; dLat++) {
      for (let dLng = -1; dLng <= 1; dLng++) {
        const arr = grid.get(`${latB + dLat}:${lngB + dLng}`);
        if (arr) out.push(...arr);
      }
    }
    return out;
  }

  const cableToLandingPoints = new Map<string, LandingPoint[]>();
  const landingPointToCables = new Map<string, CableFeature[]>();

  for (const cable of mergedCables) {
    const seen = new Set<string>();
    const matched: LandingPoint[] = [];
    for (const [lat, lng] of cableEndpoints(cable)) {
      for (const lp of nearbyLandingPoints(lat, lng)) {
        if (seen.has(lp.id)) continue;
        if (haversineKm(lat, lng, lp.lat, lp.lng) <= toleranceKm) {
          seen.add(lp.id);
          matched.push(lp);
          const arr = landingPointToCables.get(lp.id);
          if (arr) arr.push(cable);
          else landingPointToCables.set(lp.id, [cable]);
        }
      }
    }
    cableToLandingPoints.set(cable.id, matched);
  }

  for (const arr of landingPointToCables.values()) {
    arr.sort((a, b) => a.name.localeCompare(b.name));
  }

  return { cablesById, landingPointsById, cableToLandingPoints, landingPointToCables };
}

/** Best-effort country parse from a "City, Country" style landing-point name -- real data, not fabricated; unavailable when the name has no comma to split on. */
export function landingPointCountry(name: string): string | null {
  const idx = name.lastIndexOf(",");
  if (idx === -1) return null;
  const country = name.slice(idx + 1).trim();
  return country.length > 0 ? country : null;
}

export interface CableDetail {
  id: string;
  name: string;
  color: string;
  paths: [number, number][][];
  landingPoints: LandingPoint[];
  countries: string[];
  pathSegmentCount: number;
  totalVertexCount: number;
}

export function getCableDetail(cableId: string, index: CableNetworkIndex): CableDetail | null {
  const cable = index.cablesById.get(cableId);
  if (!cable) return null;
  const landingPoints = index.cableToLandingPoints.get(cableId) ?? [];
  const countries = [
    ...new Set(landingPoints.map((lp) => landingPointCountry(lp.name)).filter((c): c is string => c != null)),
  ];
  const totalVertexCount = cable.paths.reduce((sum, p) => sum + p.length, 0);
  return {
    id: cable.id,
    name: cable.name,
    color: cable.color,
    paths: cable.paths,
    landingPoints,
    countries,
    pathSegmentCount: cable.paths.length,
    totalVertexCount,
  };
}

export interface LandingPointDetail {
  id: string;
  name: string;
  lat: number;
  lng: number;
  country: string | null;
  connectedCables: CableFeature[];
}

export function getLandingPointDetail(landingPointId: string, index: CableNetworkIndex): LandingPointDetail | null {
  const lp = index.landingPointsById.get(landingPointId);
  if (!lp) return null;
  return {
    id: lp.id,
    name: lp.name,
    lat: lp.lat,
    lng: lp.lng,
    country: landingPointCountry(lp.name),
    connectedCables: index.landingPointToCables.get(landingPointId) ?? [],
  };
}

export type NetworkSelection =
  | { kind: "cable"; cableId: string }
  | { kind: "landingPoint"; landingPointId: string };

export interface NetworkSearchResults {
  cables: CableFeature[];
  landingPoints: LandingPoint[];
}

/** Plain substring match on name/id, case-insensitive -- deliberately no fuzzy matching, so results never suggest something the user didn't type. */
export function searchNetwork(query: string, index: CableNetworkIndex, limit = 8): NetworkSearchResults {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return { cables: [], landingPoints: [] };
  const cables = [...index.cablesById.values()]
    .filter((c) => c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q))
    .slice(0, limit);
  const landingPoints = [...index.landingPointsById.values()]
    .filter((lp) => lp.name.toLowerCase().includes(q))
    .slice(0, limit);
  return { cables, landingPoints };
}
