// Nearest-real-cable distance lookup, used to (a) let the "diverse-corridor"
// routing profile steer away from existing cable corridors and (b) compute
// the resilience/diversity metric for every candidate route.
//
// WHY THIS IS POINT-TO-SEGMENT AND NOT NEAREST-VERTEX: a previous version
// indexed only each cable's STORED PATH VERTICES and returned the distance
// to the nearest one. Stored vertex spacing in this dataset is wildly
// uneven -- 886 of 12,170 stored segments span more than 500km, the worst
// being 5,650km on Project Waterworth. A candidate route could therefore
// cross directly over an existing cable at the midpoint of a long segment
// and be scored as thousands of kilometres clear of it. That is not a
// rounding error in a diversity metric; it can invert the result outright.
//
// The index now holds SEGMENTS and measures true point-to-segment distance.
// Long real segments are subdivided at build time into sub-segments of at
// most SEGMENT_SPLIT_KM so that bucketing stays effective -- subdivision
// points are linear interpolations along the real stored segment, which is
// exactly the polyline the app already renders and hit-tests (three-globe
// interpolates path points linearly in lat/lng; see cableHitTest.ts). No
// cable geometry is invented or reshaped -- the same line is simply
// expressed with more vertices.
import type { CableFeature } from "../types";
import { mergeCablesById } from "../cableNetwork";

// Bucket edge in degrees. Larger buckets hold more segments each but require
// far fewer lookups to cover a given search radius, and in open ocean -- where
// long intercontinental routes spend most of their length -- almost every
// bucket is empty, so lookup count dominates segment-scan count. Measured on
// the nine-pair suite: 1-degree buckets need 289 lookups to reach the ~800km
// the diversity factor cares about, versus 81 at 2 degrees.
const BUCKET_DEG = 2;
/** Max sub-segment length. Bounded so a segment's bounding box stays small enough for bucketing to prune effectively. */
const SEGMENT_SPLIT_KM = 40;

interface CableSegment {
  aLat: number;
  aLng: number;
  bLat: number;
  bLng: number;
}

export interface CableProximityIndex {
  buckets: Map<string, CableSegment[]>;
  /** Memoized query results -- A* asks about the same grid cells repeatedly across neighbour expansions. */
  queryCache: Map<string, number>;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function bucketKey(latBucket: number, lngBucket: number): string {
  return `${latBucket},${lngBucket}`;
}

function addSegment(buckets: Map<string, CableSegment[]>, seg: CableSegment) {
  // Insert into every bucket the segment's bounding box touches. Sub-segments
  // are short (<= SEGMENT_SPLIT_KM) so this is at most a handful of buckets.
  const minLat = Math.min(seg.aLat, seg.bLat);
  const maxLat = Math.max(seg.aLat, seg.bLat);
  const minLng = Math.min(seg.aLng, seg.bLng);
  const maxLng = Math.max(seg.aLng, seg.bLng);
  // A sub-segment straddling the antimeridian would have a bbox spanning the
  // globe; such a segment is short in reality, so index it at both ends
  // rather than filling every bucket between them.
  if (maxLng - minLng > 180) {
    for (const [lat, lng] of [
      [seg.aLat, seg.aLng],
      [seg.bLat, seg.bLng],
    ]) {
      const key = bucketKey(Math.floor(lat / BUCKET_DEG), Math.floor(lng / BUCKET_DEG));
      let arr = buckets.get(key);
      if (!arr) buckets.set(key, (arr = []));
      arr.push(seg);
    }
    return;
  }
  for (let lb = Math.floor(minLat / BUCKET_DEG); lb <= Math.floor(maxLat / BUCKET_DEG); lb++) {
    for (let gb = Math.floor(minLng / BUCKET_DEG); gb <= Math.floor(maxLng / BUCKET_DEG); gb++) {
      const key = bucketKey(lb, gb);
      let arr = buckets.get(key);
      if (!arr) buckets.set(key, (arr = []));
      arr.push(seg);
    }
  }
}

export function buildCableProximityIndex(cables: CableFeature[]): CableProximityIndex {
  const buckets = new Map<string, CableSegment[]>();
  // Merge first so branch features sharing a cable id contribute one
  // consistent geometry set (matches connectivityAnalysis.ts's treatment).
  for (const cable of mergeCablesById(cables)) {
    for (const path of cable.paths) {
      for (let i = 0; i < path.length - 1; i++) {
        const [aLat, aLng] = path[i];
        const [bLat, bLng] = path[i + 1];
        const len = haversineKm(aLat, aLng, bLat, bLng);
        const parts = Math.max(1, Math.ceil(len / SEGMENT_SPLIT_KM));
        for (let p = 0; p < parts; p++) {
          const t0 = p / parts;
          const t1 = (p + 1) / parts;
          addSegment(buckets, {
            aLat: aLat + (bLat - aLat) * t0,
            aLng: aLng + (bLng - aLng) * t0,
            bLat: aLat + (bLat - aLat) * t1,
            bLng: aLng + (bLng - aLng) * t1,
          });
        }
      }
    }
  }
  return { buckets, queryCache: new Map() };
}

/**
 * Point-to-segment distance in km, via a local equirectangular projection
 * centred on the query point. At the sub-100km scales this metric actually
 * cares about, the projection error is far below the 0.5-degree grid's own
 * resolution.
 */
function pointToSegmentKm(lat: number, lng: number, seg: CableSegment): number {
  const kmPerDegLat = 111.32;
  const kmPerDegLng = 111.32 * Math.cos((lat * Math.PI) / 180);
  const unwrap = (l: number) => {
    let d = l - lng;
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    return d;
  };
  const ax = unwrap(seg.aLng) * kmPerDegLng;
  const ay = (seg.aLat - lat) * kmPerDegLat;
  const bx = unwrap(seg.bLng) * kmPerDegLng;
  const by = (seg.bLat - lat) * kmPerDegLat;

  const abx = bx - ax;
  const aby = by - ay;
  const lenSq = abx * abx + aby * aby;
  if (lenSq === 0) return Math.hypot(ax, ay);
  let t = -(ax * abx + ay * aby) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(ax + t * abx, ay + t * aby);
}

/** Sentinel returned when nothing is found within the searched radius. */
export const NO_CABLE_NEARBY_KM = 20000;

export function nearestCableDistanceKm(
  index: CableProximityIndex,
  lat: number,
  lng: number,
  maxRingSteps = 6
): number {
  const cacheKey = `${lat.toFixed(2)},${lng.toFixed(2)},${maxRingSteps}`;
  const cached = index.queryCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const baseLat = Math.floor(lat / BUCKET_DEG);
  const baseLng = Math.floor(lng / BUCKET_DEG);
  let best = Infinity;

  // Conservative lower bound on how far away anything in ring r+1 must be.
  // Longitude degrees shrink with latitude, so use the narrower of the two
  // axes -- underestimating the ring distance only ever makes us search MORE
  // rings, never fewer, so this cannot cause a miss.
  const ringFloorKm = BUCKET_DEG * 111.32 * Math.max(0.1, Math.cos((lat * Math.PI) / 180));

  for (let ring = 0; ring <= maxRingSteps; ring++) {
    for (let dr = -ring; dr <= ring; dr++) {
      const onEdgeRow = Math.abs(dr) === ring;
      const colStep = ring === 0 ? 1 : onEdgeRow ? 1 : ring * 2;
      for (let dc = -ring; dc <= ring; dc += colStep) {
        const segs = index.buckets.get(bucketKey(baseLat + dr, baseLng + dc));
        if (!segs) continue;
        for (const seg of segs) {
          const d = pointToSegmentKm(lat, lng, seg);
          if (d < best) best = d;
        }
      }
    }
    // Nothing in a farther ring can beat `best` once `best` is already closer
    // than the nearest possible point of the next ring out. Replaces a
    // "stop one ring after the first hit" heuristic, which both over-searched
    // in dense water and could under-search near a bucket boundary.
    if (best <= ring * ringFloorKm) break;
  }

  const result = best === Infinity ? NO_CABLE_NEARBY_KM : best;
  index.queryCache.set(cacheKey, result);
  return result;
}
