// Camera framing for route/cable selection.
//
// Extracted from App.tsx so the geometry can be tested directly. The bug this
// exists to prevent is not subtle in effect but is completely invisible in
// code review: averaging longitudes looks obviously correct until a cable
// crosses the antimeridian, at which point the camera flies to the wrong
// hemisphere and the user sees an empty ocean where they clicked a cable.

/** Approximate great-circle angular distance in degrees -- used only to size
 *  the camera framing, not for any engineering calculation. */
export function angularDistanceDeg(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return (2 * Math.asin(Math.sqrt(a)) * 180) / Math.PI;
}

export interface CameraFraming {
  lat: number;
  lng: number;
  altitude: number;
}

export const MIN_ALTITUDE = 1.1;
export const MAX_ALTITUDE = 3.4;

export interface SphericalCentroid {
  lat: number;
  lng: number;
  /** True when the points are spread so symmetrically that no meaningful
   *  centre exists and `lat`/`lng` are a fallback rather than an average. */
  degenerate: boolean;
}

/**
 * Mean position of points on a sphere, computed by averaging them as 3D unit
 * vectors.
 *
 * This is the whole fix for the "clicking a cable spins the globe somewhere
 * else" bug, and it is worth being explicit about why the obvious version is
 * wrong. Longitude wraps at +/-180, so arithmetic on it is only valid when the
 * points do not straddle that seam. Telstra Endeavour spans +178 to -179 --
 * two points barely 3 degrees apart -- and their numeric mean is 0, the Gulf
 * of Guinea. Unit vectors have no seam, so no special-casing is needed.
 */
export function sphericalCentroid(
  points: readonly (readonly [number, number])[]
): SphericalCentroid | null {
  if (points.length === 0) return null;
  const toRad = (d: number) => (d * Math.PI) / 180;

  let x = 0;
  let y = 0;
  let z = 0;
  for (const [lat, lng] of points) {
    const cosLat = Math.cos(toRad(lat));
    x += cosLat * Math.cos(toRad(lng));
    y += cosLat * Math.sin(toRad(lng));
    z += Math.sin(toRad(lat));
  }
  x /= points.length;
  y /= points.length;
  z /= points.length;

  const hyp = Math.hypot(x, y);
  // Antipodal or evenly-encircling geometry averages to the origin, where
  // direction is undefined. Falling back to the first point keeps the camera
  // on the geometry rather than pointing wherever atan2 sends numerical noise.
  if (hyp < 1e-9 && Math.abs(z) < 1e-9) {
    return { lat: points[0][0], lng: points[0][1], degenerate: true };
  }
  return {
    lat: (Math.atan2(z, hyp) * 180) / Math.PI,
    lng: (Math.atan2(y, x) * 180) / Math.PI,
    degenerate: false,
  };
}

/**
 * Frames the camera on a set of [lat, lng] points.
 *
 * Centring averages the points as 3D unit vectors rather than averaging their
 * latitudes and longitudes. Longitude is cyclic, so a lat/lng midpoint is
 * meaningless the moment geometry crosses the antimeridian: Telstra Endeavour
 * spans +178 to -179, whose numeric mean is 0 -- the Gulf of Guinea, a quarter
 * of the planet from any part of the cable. Measured against the shipped
 * dataset, 32 of 724 cables framed more than 30 degrees off target and the
 * worst were a full 180 degrees out. Vector averaging has no wraparound to get
 * wrong.
 *
 * Returns null when there is nothing to frame.
 */
export function frameForPoints(points: readonly (readonly [number, number])[]): CameraFraming | null {
  const centre = sphericalCentroid(points);
  if (!centre) return null;
  if (centre.degenerate) {
    return { lat: centre.lat, lng: centre.lng, altitude: MAX_ALTITUDE };
  }
  const { lat, lng } = centre;

  // Size the framing by the true angular radius from that centre. The previous
  // bounding-box diagonal had the same wraparound flaw as the centre did, and
  // understated the span of anything crossing the antimeridian.
  let radius = 0;
  for (const [pLat, pLng] of points) {
    const d = angularDistanceDeg(lat, lng, pLat, pLng);
    if (d > radius) radius = d;
  }

  const altitude = Math.min(MAX_ALTITUDE, Math.max(MIN_ALTITUDE, (radius * 2) / 45));
  return { lat, lng, altitude };
}
