// Computes depth/distance statistics for a candidate route by resampling
// its geometry at fixed intervals and looking up each sample's depth band
// from the real (rasterized) ocean grid -- see oceanGrid.ts for why every
// depth value here is a contour-band lower bound, not a precise sounding.
import type { OceanGrid } from "./oceanGrid";
import { bandAt, bandDepthM } from "./oceanGrid";
import { depthDifficultyMultiplier, classifySeabedDifficulty } from "./marineCostSurface";
import type { DepthProfileSample, RouteAnalysis } from "./routingTypes";

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Resamples a polyline at approximately `stepKm` intervals, returning [lat,lng,cumulativeDistanceKm]. */
function resamplePath(path: [number, number][], stepKm: number): { lat: number; lng: number; distanceKm: number }[] {
  if (path.length < 2) return path.map(([lat, lng]) => ({ lat, lng, distanceKm: 0 }));

  const segLengths: number[] = [];
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const d = haversineKm(path[i][0], path[i][1], path[i + 1][0], path[i + 1][1]);
    segLengths.push(d);
    total += d;
  }

  const samples: { lat: number; lng: number; distanceKm: number }[] = [];
  const numSamples = Math.max(2, Math.ceil(total / stepKm) + 1);
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
    const [lat1, lng1] = path[segIndex];
    const [lat2, lng2] = path[segIndex + 1];
    samples.push({ lat: lat1 + (lat2 - lat1) * t, lng: lng1 + (lng2 - lng1) * t, distanceKm: targetDist });
  }
  return samples;
}

const SAMPLE_STEP_KM = 50;

/** Loose geomorphological labels for each depth band -- descriptive shorthand for the UI, not a separate classification system (still keyed to the same band lower bounds as everywhere else). */
const BAND_DESCRIPTIONS: Record<number, string> = {
  1: "nearshore/shelf",
  2: "continental shelf edge",
  3: "continental slope",
  4: "continental slope",
  5: "abyssal plain",
  6: "abyssal plain",
  7: "deep abyssal plain",
  8: "deep abyssal plain",
  9: "trench-class depth",
  10: "trench-class depth",
  11: "trench-class depth",
  12: "trench-class depth",
};

function bandRangeLabel(grid: OceanGrid, bandIndex: number): string {
  const lower = bandDepthM(grid, bandIndex);
  const next = grid.depthBands.find((b) => b.index === bandIndex + 1);
  return next ? `${lower.toLocaleString()}-${next.minDepthM.toLocaleString()}m band` : `>= ${lower.toLocaleString()}m band`;
}

/** Which single depth band covers the largest share of the route's sampled length -- a one-line summary of the depth profile's overall shape. */
function computeDominantDepthBandLabel(grid: OceanGrid, depthProfile: DepthProfileSample[]): string {
  const counts = new Map<number, number>();
  for (const d of depthProfile) counts.set(d.depthBandIndex, (counts.get(d.depthBandIndex) ?? 0) + 1);
  let dominantBand = depthProfile[0]?.depthBandIndex ?? 1;
  let best = -1;
  for (const [band, count] of counts) {
    if (count > best) {
      best = count;
      dominantBand = band;
    }
  }
  const sharePct = Math.round((100 * best) / depthProfile.length);
  const desc = BAND_DESCRIPTIONS[dominantBand] ?? "ocean";
  return `Predominantly ${desc} (${bandRangeLabel(grid, dominantBand)}, ~${sharePct}% of sampled route length)`;
}

export function computeRouteAnalysis(
  grid: OceanGrid,
  marinePath: [number, number][],
  terrestrialAccessKmSource: number | null,
  terrestrialAccessKmDest: number | null
): RouteAnalysis {
  let marineDistanceKm = 0;
  for (let i = 0; i < marinePath.length - 1; i++) {
    marineDistanceKm += haversineKm(marinePath[i][0], marinePath[i][1], marinePath[i + 1][0], marinePath[i + 1][1]);
  }

  const samples = resamplePath(marinePath, SAMPLE_STEP_KM);
  const depthProfile: DepthProfileSample[] = samples.map((s) => {
    const band = Math.max(1, bandAt(grid, s.lat, s.lng)); // clamp: endpoints snapped exactly onto shore can land on a land cell by a fraction of a grid cell; treat as shallowest ocean band rather than crashing the stats.
    return { distanceAlongRouteKm: s.distanceKm, depthM: bandDepthM(grid, band), depthBandIndex: band };
  });

  const depths = depthProfile.map((d) => d.depthM);
  const minDepthM = Math.min(...depths);
  const maxDepthM = Math.max(...depths);
  const meanDepthM = depths.reduce((a, b) => a + b, 0) / depths.length;
  const variance = depths.reduce((a, b) => a + (b - meanDepthM) ** 2, 0) / depths.length;
  const depthStdDevM = Math.sqrt(variance);

  const meanMultiplier =
    depthProfile.reduce((a, d) => a + depthDifficultyMultiplier(d.depthBandIndex), 0) / depthProfile.length;
  const { difficulty, basis } = classifySeabedDifficulty(meanMultiplier, depthStdDevM);
  const dominantDepthBandLabel = computeDominantDepthBandLabel(grid, depthProfile);

  const totalDistanceKm = marineDistanceKm + (terrestrialAccessKmSource ?? 0) + (terrestrialAccessKmDest ?? 0);

  return {
    marineDistanceKm,
    totalDistanceKm,
    depthProfile,
    minDepthM,
    maxDepthM,
    meanDepthM,
    depthStdDevM,
    seabedDifficulty: difficulty,
    seabedDifficultyBasis: basis,
    dominantDepthBandLabel,
  };
}
