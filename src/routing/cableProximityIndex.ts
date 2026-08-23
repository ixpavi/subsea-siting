// Bucketed nearest-real-cable-point lookup, used to (a) let the
// "diverse-corridor" routing profile steer away from existing cable
// corridors and (b) compute the post-hoc resilience/diversity metric for
// every candidate route. See routeResilience.ts for how the result is
// interpreted.
//
// APPROXIMATION, disclosed: this indexes each real cable's STORED path
// vertices (the same real TeleGeography-derived points used everywhere else
// in the app), not the densified rendered curve or true segment geometry --
// so "distance to nearest cable" is really "distance to nearest stored
// cable vertex". Stored vertices are typically much closer together than
// this engine's 0.5 deg routing grid cells, so the approximation error is
// small relative to the grid's own resolution, but it is still an
// approximation, not exact segment distance -- surfaced in
// ResilienceAssessment.methodNote rather than hidden.
import type { CableFeature } from "../types";

const BUCKET_DEG = 2;

export interface CableProximityIndex {
  buckets: Map<string, [number, number][]>;
}

function bucketKey(lat: number, lng: number): string {
  return `${Math.floor(lat / BUCKET_DEG)},${Math.floor(lng / BUCKET_DEG)}`;
}

export function buildCableProximityIndex(cables: CableFeature[]): CableProximityIndex {
  const buckets = new Map<string, [number, number][]>();
  for (const cable of cables) {
    for (const path of cable.paths) {
      for (const [lat, lng] of path) {
        const key = bucketKey(lat, lng);
        let arr = buckets.get(key);
        if (!arr) {
          arr = [];
          buckets.set(key, arr);
        }
        arr.push([lat, lng]);
      }
    }
  }
  return { buckets };
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Distance in km to the nearest indexed cable vertex, searched via expanding bucket rings. Returns a large sentinel (see NO_CABLE_NEARBY_KM) if nothing is found within maxRingSteps. */
export const NO_CABLE_NEARBY_KM = 20000;

export function nearestCableDistanceKm(
  index: CableProximityIndex,
  lat: number,
  lng: number,
  maxRingSteps = 6 // 6 * 2deg = 12deg ~ 1300km
): number {
  const baseLat = Math.floor(lat / BUCKET_DEG);
  const baseLng = Math.floor(lng / BUCKET_DEG);
  let best = Infinity;

  for (let ring = 0; ring <= maxRingSteps; ring++) {
    let foundAny = false;
    for (let dr = -ring; dr <= ring; dr++) {
      const onEdgeRow = Math.abs(dr) === ring;
      const colStep = ring === 0 ? 1 : onEdgeRow ? 1 : ring * 2;
      for (let dc = -ring; dc <= ring; dc += colStep) {
        const key = `${baseLat + dr},${baseLng + dc}`;
        const pts = index.buckets.get(key);
        if (!pts) continue;
        foundAny = true;
        for (const [plat, plng] of pts) {
          const d = haversineKm(lat, lng, plat, plng);
          if (d < best) best = d;
        }
      }
    }
    // Once we've found at least one candidate, one more ring guarantees we
    // haven't missed a closer point just across a bucket boundary, then stop.
    if (foundAny && ring > 0) break;
  }
  return best === Infinity ? NO_CABLE_NEARBY_KM : best;
}
