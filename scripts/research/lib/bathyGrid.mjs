// Tile-backed access to the Phase 1 bathymetry, with the terrain features the
// route study needs.
//
// The tiles are stored as one Int16 .bin per degree square. Neighbour lookups
// for slope and roughness routinely cross tile edges, so every access goes
// through elevation() by absolute lat/lng rather than by tile-local index.
// That costs a little speed and removes a whole class of edge bug -- a slope
// computed from a clamped or wrapped neighbour is wrong in a way that would
// never announce itself.
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const NODATA = -32768;

export class BathyGrid {
  constructor(tilesDir, perDeg = 240) {
    this.dir = tilesDir;
    this.perDeg = perDeg;
    this.cellDeg = 1 / perDeg;
    this.tiles = new Map();
    // Metres per cell of latitude is constant; per cell of longitude it
    // shrinks with cos(lat). Ignoring that would understate east-west slope
    // by a factor of two at 60N, which is where much of this corpus sits.
    this.cellMetresLat = 111320 / perDeg;
  }

  #tile(tLat, tLng) {
    const key = `${tLat}_${tLng}`;
    let t = this.tiles.get(key);
    if (t === undefined) {
      const p = join(this.dir, `${key}.bin`);
      if (existsSync(p)) {
        const b = readFileSync(p);
        t = new Int16Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
      } else {
        t = null;
      }
      this.tiles.set(key, t);
    }
    return t;
  }

  /** Elevation in metres (negative below sea level), or null where unknown. */
  elevation(lat, lng) {
    const tLat = Math.floor(lat);
    const tLng = Math.floor(lng);
    const t = this.#tile(tLat, tLng);
    if (!t) return null;
    let row = Math.floor((tLat + 1 - lat) * this.perDeg);
    let col = Math.floor((lng - tLng) * this.perDeg);
    if (row < 0) row = 0; else if (row >= this.perDeg) row = this.perDeg - 1;
    if (col < 0) col = 0; else if (col >= this.perDeg) col = this.perDeg - 1;
    const v = t[row * this.perDeg + col];
    return v === NODATA ? null : v;
  }

  /** Depth in metres, positive down. Null on land or where unknown. */
  depth(lat, lng) {
    const e = this.elevation(lat, lng);
    if (e === null) return null;
    return e < 0 ? -e : null;
  }

  isLand(lat, lng) {
    const e = this.elevation(lat, lng);
    return e === null ? null : e >= 0;
  }

  /** Seabed gradient magnitude (m per m) by central differences. */
  slope(lat, lng) {
    const d = this.cellDeg;
    const n = this.elevation(lat + d, lng);
    const s = this.elevation(lat - d, lng);
    const e = this.elevation(lat, lng + d);
    const w = this.elevation(lat, lng - d);
    if (n === null || s === null || e === null || w === null) return null;
    const mLng = this.cellMetresLat * Math.cos((lat * Math.PI) / 180);
    if (mLng < 1) return null; // degenerate near the poles
    const dzdy = (n - s) / (2 * this.cellMetresLat);
    const dzdx = (e - w) / (2 * mLng);
    return Math.sqrt(dzdx * dzdx + dzdy * dzdy);
  }

  /** Local relief: max minus min elevation over the 3x3 neighbourhood, metres.
   *  Captures rugged ground that a mean gradient smooths away. */
  roughness(lat, lng) {
    const d = this.cellDeg;
    let lo = Infinity, hi = -Infinity;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const v = this.elevation(lat + dy * d, lng + dx * d);
        if (v === null) return null;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    return hi - lo;
  }
}

// --- Spherical geometry -----------------------------------------------------
// The app's globe renderer interpolates paths linearly in lat/lng, which is not
// a great circle. That is fine for drawing but wrong for measurement, so this
// module does its own spherical maths rather than borrowing the app's.

export const R_EARTH_KM = 6371;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

export function haversineKm(lat1, lng1, lat2, lng2) {
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH_KM * Math.asin(Math.sqrt(a));
}

export function initialBearing(lat1, lng1, lat2, lng2) {
  const y = Math.sin(rad(lng2 - lng1)) * Math.cos(rad(lat2));
  const x =
    Math.cos(rad(lat1)) * Math.sin(rad(lat2)) -
    Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lng2 - lng1));
  return Math.atan2(y, x);
}

/** Signed perpendicular distance in km from point 3 to the great circle
 *  through points 1 and 2. This is the honest measure of "how far off the
 *  straight line did the cable go" -- along-track position is irrelevant. */
export function crossTrackKm(lat1, lng1, lat2, lng2, lat3, lng3) {
  const d13 = haversineKm(lat1, lng1, lat3, lng3) / R_EARTH_KM;
  const b13 = initialBearing(lat1, lng1, lat3, lng3);
  const b12 = initialBearing(lat1, lng1, lat2, lng2);
  return Math.asin(Math.sin(d13) * Math.sin(b13 - b12)) * R_EARTH_KM;
}

/** Point at fraction f along the great circle from 1 to 2 (spherical slerp). */
export function interpolateGreatCircle(lat1, lng1, lat2, lng2, f) {
  const d = haversineKm(lat1, lng1, lat2, lng2) / R_EARTH_KM;
  if (d < 1e-12) return [lat1, lng1];
  const a = Math.sin((1 - f) * d) / Math.sin(d);
  const b = Math.sin(f * d) / Math.sin(d);
  const x = a * Math.cos(rad(lat1)) * Math.cos(rad(lng1)) + b * Math.cos(rad(lat2)) * Math.cos(rad(lng2));
  const y = a * Math.cos(rad(lat1)) * Math.sin(rad(lng1)) + b * Math.cos(rad(lat2)) * Math.sin(rad(lng2));
  const z = a * Math.sin(rad(lat1)) + b * Math.sin(rad(lat2));
  return [deg(Math.atan2(z, Math.sqrt(x * x + y * y))), deg(Math.atan2(y, x))];
}

/** Resample a polyline of [lng,lat] to n points evenly spaced by arc length.
 *  Observed routes have wildly uneven vertex spacing (6 m to 2.5 km medians
 *  across sources); comparing them to anything requires a common footing, or
 *  densely-sampled stretches would dominate every statistic. */
export function resampleByLength(coords, n) {
  const cum = [0];
  for (let i = 1; i < coords.length; i++) {
    cum.push(cum[i - 1] + haversineKm(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]));
  }
  const total = cum[cum.length - 1];
  if (total === 0) return Array.from({ length: n }, () => [coords[0][1], coords[0][0]]);
  const out = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const target = (total * k) / (n - 1);
    while (j < cum.length - 2 && cum[j + 1] < target) j++;
    const span = cum[j + 1] - cum[j];
    const f = span > 0 ? (target - cum[j]) / span : 0;
    out.push(interpolateGreatCircle(coords[j][1], coords[j][0], coords[j + 1][1], coords[j + 1][0], f));
  }
  return out;
}
