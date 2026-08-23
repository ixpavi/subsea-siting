// Physical route-diversity analysis against the REAL existing TeleGeography
// cable network -- not a fabricated failure-probability estimate. Samples a
// candidate route and, for each sample, measures distance to the nearest
// real cable vertex (see cableProximityIndex.ts for the approximation this
// relies on). A route that stays far from every existing corridor gets a
// higher diversity score; one that closely tracks existing cables for most
// of its length gets a lower one. This says nothing about any cable's
// actual failure rate.
import { nearestCableDistanceKm, type CableProximityIndex } from "./cableProximityIndex";
import type { ResilienceAssessment } from "./routingTypes";

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const CORRIDOR_THRESHOLD_KM = 100;
const SAMPLE_STEP_KM = 50;

export function computeRouteResilience(cableIndex: CableProximityIndex, marinePath: [number, number][]): ResilienceAssessment {
  if (marinePath.length < 2) {
    return {
      corridorOverlapFraction: 0,
      meanDistanceToNearestCableKm: 0,
      minDistanceToNearestCableKm: 0,
      diversityScore: 0,
      corridorThresholdKm: CORRIDOR_THRESHOLD_KM,
      methodNote: "Route geometry unavailable.",
    };
  }

  const segLengths: number[] = [];
  let total = 0;
  for (let i = 0; i < marinePath.length - 1; i++) {
    const d = haversineKm(marinePath[i][0], marinePath[i][1], marinePath[i + 1][0], marinePath[i + 1][1]);
    segLengths.push(d);
    total += d;
  }
  const numSamples = Math.max(2, Math.ceil(total / SAMPLE_STEP_KM));

  const distances: number[] = [];
  for (let s = 0; s <= numSamples; s++) {
    const targetDist = (s / numSamples) * total;
    let cum = 0;
    let segIndex = 0;
    while (segIndex < segLengths.length - 1 && cum + segLengths[segIndex] < targetDist) {
      cum += segLengths[segIndex];
      segIndex++;
    }
    const segLen = segLengths[segIndex] || 1e-9;
    const t = Math.max(0, Math.min(1, (targetDist - cum) / segLen));
    const [lat1, lng1] = marinePath[segIndex];
    const [lat2, lng2] = marinePath[segIndex + 1];
    const lat = lat1 + (lat2 - lat1) * t;
    const lng = lng1 + (lng2 - lng1) * t;
    // 6 rings at the index's 2-degree buckets covers ~1,330km. diversityScore
    // saturates its distance term at 1,000km, so this bounds the search
    // without truncating any distance the score can actually distinguish.
    distances.push(nearestCableDistanceKm(cableIndex, lat, lng, 6));
  }

  const meanDistanceToNearestCableKm = distances.reduce((a, b) => a + b, 0) / distances.length;
  const minDistanceToNearestCableKm = Math.min(...distances);
  const withinCorridor = distances.filter((d) => d <= CORRIDOR_THRESHOLD_KM).length;
  const corridorOverlapFraction = withinCorridor / distances.length;

  // Deterministic diversity score: 1 - overlap fraction, softened by mean
  // distance so a route that grazes corridors briefly isn't scored
  // identically to one that shadows them for its whole length. Explicitly a
  // MODELED combination, not a physical/statistical quantity.
  const distanceComponent = Math.min(1, meanDistanceToNearestCableKm / 1000);
  const diversityScore = Math.max(0, Math.min(1, 0.6 * (1 - corridorOverlapFraction) + 0.4 * distanceComponent));

  return {
    corridorOverlapFraction,
    meanDistanceToNearestCableKm,
    minDistanceToNearestCableKm,
    diversityScore,
    corridorThresholdKm: CORRIDOR_THRESHOLD_KM,
    methodNote:
      "Sampled every ~50km along the route; distance measured by true point-to-segment distance against real TeleGeography-derived cable geometry. Indicates physical corridor diversity only -- it is not a failure-probability estimate, and it does not account for the anthropogenic hazards (fishing gear, anchoring) that dominate real cable faults.",
  };
}
