// How far apart are two routes?
//
// The evaluation metric for the whole predictive experiment, so it has to
// measure the thing that matters: whether a predicted route goes WHERE the
// real one went. Mean separation along the route does that; total length does
// not (two routes can share a length and run through different seas).
//
// Symmetric, for the same reason the degeneracy check in the application is:
// measuring only predicted -> observed misses an excursion the observed route
// makes that the prediction does not follow.
import { haversineKm, resampleByLength } from "./bathyGrid.mjs";

/** Nearest distance from a point to any vertex of a densely resampled path. */
function nearest(lat, lng, pts) {
  let best = Infinity;
  for (const [pLat, pLng] of pts) {
    const d = haversineKm(lat, lng, pLat, pLng);
    if (d < best) best = d;
  }
  return best;
}

/**
 * @param n resample density. Both routes are resampled to the same number of
 *   evenly spaced points so neither's vertex density biases the comparison --
 *   corpus sources differ by 30x in sampling rate.
 */
export function routeDeviationKm(a, b, n = 120) {
  if (!a || !b || a.length < 2 || b.length < 2) return null;
  const A = resampleByLength(a.map(([lat, lng]) => [lng, lat]), n);
  const B = resampleByLength(b.map(([lat, lng]) => [lng, lat]), n);
  const fwd = A.map(([lat, lng]) => nearest(lat, lng, B));
  const bwd = B.map(([lat, lng]) => nearest(lat, lng, A));
  const all = fwd.concat(bwd);
  all.sort((x, y) => x - y);
  const sum = all.reduce((s, v) => s + v, 0);
  return {
    meanKm: sum / all.length,
    medianKm: all[Math.floor(all.length / 2)],
    maxKm: all[all.length - 1],
  };
}

/** Great-circle path between two points, as the zero-knowledge baseline. */
export function geodesicPath(a, b, n = 200) {
  return resampleByLength([[a[1], a[0]], [b[1], b[0]]], n);
}
