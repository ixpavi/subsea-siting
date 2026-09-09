// Small shared geometry helpers for the routing engine.
//
// WHY THIS EXISTS: every resampler in this engine used to interpolate
// longitude as plain `lng1 + (lng2 - lng1) * t`. That is correct everywhere
// except across the antimeridian, and the A* search wraps grid columns
// (routeCandidates.ts), so a Pacific route genuinely contains a consecutive
// pair like [lat, 179.75] -> [lat, -179.75]. Those two points are one 0.5deg
// cell apart in reality, but the naive interpolation reads the difference as
// -359.5deg and sweeps the sample the long way round the planet, through
// longitude 0. A Tokyo -> Los Angeles route was therefore sampling its seabed
// depth in the Atlantic.
//
// The fix is to interpolate along the SHORT way: unwrap the longitude
// difference into (-180, 180] before stepping along it, then renormalise.

/** Signed shortest longitude difference from `fromLng` to `toLng`, in (-180, 180]. */
export function shortestLngDelta(fromLng: number, toLng: number): number {
  let d = toLng - fromLng;
  while (d > 180) d -= 360;
  while (d <= -180) d += 360;
  return d;
}

/** Wraps any longitude into [-180, 180). */
export function normalizeLng(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

/**
 * Point a fraction `t` of the way from (lat1,lng1) to (lat2,lng2), taking the
 * short way around in longitude.
 *
 * Linear in lat/lng rather than a true great-circle slerp: that matches how
 * this engine's geometry is produced (0.5deg grid steps) and how the app
 * renders and hit-tests cable paths elsewhere, so the samples land on the same
 * line the user is shown. The antimeridian handling is the part that matters.
 */
export function interpolateLatLng(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
  t: number
): [number, number] {
  const lat = lat1 + (lat2 - lat1) * t;
  const lng = normalizeLng(lng1 + shortestLngDelta(lng1, lng2) * t);
  return [lat, lng];
}
