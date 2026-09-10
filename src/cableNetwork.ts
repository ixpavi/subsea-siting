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

/** Lowercase with punctuation and spaces removed: "SeaMeWe-5" and "sea-me-we 5" both become "seamewe5". */
function compact(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

/** True when `q` occurs in `text` at the start of a word (both already lowercase). */
function startsAWord(text: string, q: string): boolean {
  for (let i = text.indexOf(q); i >= 0; i = text.indexOf(q, i + 1)) {
    if (i === 0 || !/[\p{L}\p{N}]/u.test(text[i - 1])) return true;
  }
  return false;
}

/**
 * How well `text` matches `q`, lower is better, null for no match:
 * 0 starts with it, 1 a word in it starts with it, 2 contains it anywhere,
 * 3 contains it once punctuation and spacing are ignored.
 */
function matchRank(text: string, q: string, qCompact: string): number | null {
  const t = text.toLowerCase();
  if (t.startsWith(q)) return 0;
  if (startsAWord(t, q)) return 1;
  if (t.includes(q)) return 2;
  if (qCompact.length > 0 && compact(text).includes(qCompact)) return 3;
  return null;
}

/** Best rank first, then the more important item (`weight`, higher first), then alphabetical, keeping `limit`. */
function topMatches<T extends { name: string }>(
  scored: { item: T; rank: number; weight: number }[],
  limit: number
): T[] {
  return scored
    .sort((a, b) => a.rank - b.rank || b.weight - a.weight || a.item.name.localeCompare(b.item.name))
    .slice(0, limit)
    .map((s) => s.item);
}

/**
 * Search over cable and landing-point names.
 *
 * Still only literal matches -- nothing fuzzy, so a result is always there
 * because the typed text is in it -- but RANKED. It used to return the first
 * matches in file order, and with room for eight that hid what people type
 * for: "sing" filled the list with RISING 8 and the "...Crossing" cables
 * before any Singapore system, and "mar" found Markgrafenheide and Maruyama
 * but not Marseille, one of the busiest landing sites in Europe. Punctuation
 * is also ignored as a last resort, so "sea-me-we" finds SeaMeWe-5.
 *
 * A landing point is "City, Country": a match at the start of the city counts
 * before a match on the country, so "sing" lists Singapore's landing points
 * ahead of Mersing and Helsingborg. Among equally good matches, busier landing
 * points come first -- alphabetical order alone still hid Marseille behind
 * eight smaller "Mar..." places.
 */
export function searchNetwork(query: string, index: CableNetworkIndex, limit = 8): NetworkSearchResults {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return { cables: [], landingPoints: [] };
  const qCompact = compact(q);

  const cables: { item: CableFeature; rank: number; weight: number }[] = [];
  for (const c of index.cablesById.values()) {
    const byName = matchRank(c.name, q, qCompact);
    const byId = matchRank(c.id, q, qCompact);
    // The id is a slug of the name, so it only ever adds a weaker match.
    const rank = byName ?? (byId == null ? null : Math.max(byId, 2));
    if (rank != null) cables.push({ item: c, rank, weight: 0 });
  }

  const landingPoints: { item: LandingPoint; rank: number; weight: number }[] = [];
  for (const lp of index.landingPointsById.values()) {
    const comma = lp.name.lastIndexOf(",");
    const place = comma >= 0 ? lp.name.slice(0, comma) : lp.name;
    const country = comma >= 0 ? lp.name.slice(comma + 1).trim() : "";
    const byPlace = matchRank(place, q, qCompact);
    let rank: number | null;
    if (byPlace === 0 || byPlace === 1) rank = byPlace;
    else if (country && (matchRank(country, q, qCompact) ?? 9) <= 1) rank = 2;
    else {
      const anywhere = matchRank(lp.name, q, qCompact);
      rank = anywhere == null ? null : 3 + (anywhere === 3 ? 1 : 0);
    }
    if (rank != null) {
      landingPoints.push({ item: lp, rank, weight: index.landingPointToCables.get(lp.id)?.length ?? 0 });
    }
  }

  return { cables: topMatches(cables, limit), landingPoints: topMatches(landingPoints, limit) };
}
