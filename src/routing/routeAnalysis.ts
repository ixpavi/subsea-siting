// Computes depth/distance statistics for a candidate route by resampling its
// geometry at fixed intervals and looking up each sample's depth band from
// the derived ocean grid -- see oceanGrid.ts and provenance.ts for why every
// depth value here is a contour-band bound, never a sounding.
import type { OceanGrid } from "./oceanGrid";
import { bandForDepth, depthAt } from "./oceanGrid";
import { bandRange, computeDifficultyIndex, depthDifficultyMultiplier } from "./marineCostSurface";
import { interpolateLatLng } from "./geo";
import type { DepthBandRange, DepthProfileSample, RouteAnalysis } from "./routingTypes";

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Resamples a polyline at approximately `stepKm` intervals. */
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
    // Short-way interpolation: the A* path wraps grid columns, so a Pacific
    // route contains a +179.75 -> -179.75 step. Interpolating that naively
    // swept the sample through longitude 0 and read its depth from the
    // Atlantic -- and since shallowestBand/deepestBand below are a min and a
    // max over these samples, one such sample corrupted both.
    const [lat, lng] = interpolateLatLng(lat1, lng1, lat2, lng2, t);
    samples.push({ lat, lng, distanceKm: targetDist });
  }
  return samples;
}

const SAMPLE_STEP_KM = 50;

/** Loose geomorphological shorthand per band -- descriptive labelling for the UI, keyed to the same band bounds used everywhere else, not a separate classification. */
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

  // A route's endpoints are snapped onto real landing points, which sit on
  // the coast and therefore routinely fall inside a "land" cell at this
  // grid's ~55km resolution. A previous version clamped those samples to
  // band 1 (`Math.max(1, ...)`), which silently injected a 0m lower bound
  // into the depth statistics -- that alone made "minimum depth" read
  // ">= 0 m" for every route ever generated, presented as a seabed finding.
  // Unclassified samples are now excluded and COUNTED instead, so the
  // shallowest band reported is one the route genuinely crosses.
  const depthProfile: DepthProfileSample[] = [];
  let unclassifiedSampleCount = 0;
  for (const s of samples) {
    // The grid now stores a modelled depth, so the profile carries what the
    // model says at each sample rather than the lower bound of the band it
    // fell into. The band index is still derived and kept, because the
    // difficulty multipliers and the dominant-band summary are band-shaped.
    const depth = depthAt(grid, s.lat, s.lng);
    if (depth === 0) {
      unclassifiedSampleCount++;
      continue;
    }
    depthProfile.push({
      distanceAlongRouteKm: s.distanceKm,
      depthM: depth,
      depthBandIndex: bandForDepth(grid, depth),
    });
  }

  const totalDistanceKm = marineDistanceKm + (terrestrialAccessKmSource ?? 0) + (terrestrialAccessKmDest ?? 0);
  const classifiedSampleCount = depthProfile.length;

  if (classifiedSampleCount === 0) {
    // Every sample landed on an unclassified cell -- report unavailable
    // rather than manufacturing depth statistics from nothing.
    return {
      marineDistanceKm,
      totalDistanceKm,
      depthProfile,
      shallowestBand: null,
      deepestBand: null,
      dominantBand: null,
      meanDepthM: null,
      depthStdDevM: 0,
      unclassifiedSampleCount,
      classifiedSampleCount,
      difficultyIndex: 1,
      difficultyIndexBasis: "no classified ocean samples along this route -- difficulty index unavailable, defaulted to 1.0 (no penalty)",
      dominantDepthBandLabel: "Depth band composition unavailable for this route.",
    };
  }

  const bandIndices = depthProfile.map((d) => d.depthBandIndex);
  const lowerBounds = depthProfile.map((d) => d.depthM);
  const meanDepthM = lowerBounds.reduce((a, b) => a + b, 0) / lowerBounds.length;
  const variance = lowerBounds.reduce((a, b) => a + (b - meanDepthM) ** 2, 0) / lowerBounds.length;
  const depthStdDevM = Math.sqrt(variance);

  const shallowestBand = bandRange(grid, Math.min(...bandIndices));
  const deepestBand = bandRange(grid, Math.max(...bandIndices));

  const counts = new Map<number, number>();
  for (const b of bandIndices) counts.set(b, (counts.get(b) ?? 0) + 1);
  let dominantIndex = bandIndices[0];
  let bestCount = -1;
  for (const [band, count] of counts) {
    if (count > bestCount) {
      bestCount = count;
      dominantIndex = band;
    }
  }
  const dominantBand: DepthBandRange = bandRange(grid, dominantIndex);
  const sharePct = Math.round((100 * bestCount) / classifiedSampleCount);
  const dominantDepthBandLabel =
    `Predominantly ${BAND_DESCRIPTIONS[dominantIndex] ?? "ocean"} (${dominantBand.label}, ` +
    `~${sharePct}% of classified route samples)`;

  const meanMultiplier =
    bandIndices.reduce((a, b) => a + depthDifficultyMultiplier(b), 0) / bandIndices.length;
  const { index: difficultyIndex, basis: difficultyIndexBasis } = computeDifficultyIndex(
    meanMultiplier,
    depthStdDevM
  );

  return {
    marineDistanceKm,
    totalDistanceKm,
    depthProfile,
    shallowestBand,
    deepestBand,
    dominantBand,
    meanDepthM,
    depthStdDevM,
    unclassifiedSampleCount,
    classifiedSampleCount,
    difficultyIndex,
    difficultyIndexBasis,
    dominantDepthBandLabel,
  };
}
