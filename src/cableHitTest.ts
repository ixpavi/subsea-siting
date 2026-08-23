// Custom screen-space hit-testing for submarine cable paths.
//
// Why the built-in raycasting can't be used: three-globe renders a path
// with a numeric `pathStroke` as a Three.js "fat line" (Line2/LineMaterial,
// worldUnits:false -- i.e. the line's width is defined in CSS pixels,
// constant on screen regardless of zoom). Its raycast implementation reads
// its hit-tolerance from `raycaster.params.Line2.threshold`, but
// react-globe.gl/three-render-objects only ever sets
// `raycaster.params.Line.threshold` (the THREE.Line param, for *thin*
// lines) -- `Line2` is never populated, so the effective click tolerance
// for every cable is exactly the rendered line width itself: 0.4-2.6 CSS
// pixels, sub-pixel precision.
//
// This module instead projects each cable's REAL stored lat/lng points to
// screen space ourselves (via the globe instance's own camera) and measures
// point-to-segment distance in screen pixels, with a generous,
// zoom-independent tolerance. Two things beyond that first pass turned out
// to matter for real-world reliability (found by comparing this hit-test's
// candidate distances against manual pointer testing, not just synthetic
// clicks -- see git history for the investigation):
//
//   1. DENSIFICATION MUST MATCH THREE-GLOBE'S *ACTUAL* INTERPOLATION, NOT
//      A GEOMETRICALLY "CORRECT" ONE. three-globe densifies a path's stored
//      points before rendering so the visible curve doesn't look like sparse
//      straight segments -- but its `calcPath`/`interpolateLine` (see
//      three-globe.js) does NAIVE LINEAR INTERPOLATION OF LATITUDE AND
//      LONGITUDE INDEPENDENTLY (`lat1 + (lat2-lat1)*t`, `lng1 + (lng2-lng1)*t`),
//      not a great-circle/spherical slerp. An earlier version of this module
//      densified via true great-circle slerp, which is geometrically "more
//      correct" but is a DIFFERENT CURVE from what's actually drawn --
//      diverging most for cables with long segments at high latitude (a
//      degree of longitude covers less real distance near the poles, so
//      linear lat/lng interpolation "cuts across" differently than a great
//      circle). That's exactly why the mismatch was cable-specific rather
//      than a uniform hitbox problem: e.g. FLAG Atlantic-1 sits at
//      40-50°N with 1000+km segments, right where the two curves diverge
//      most. This module now replicates three-globe's exact algorithm
//      (including its antimeridian-unwrapping step) so the hit-test
//      polyline is pixel-for-pixel the same curve that gets rendered.
//
//   1b. Measured against the real dataset: 886 of 12,170 stored segments
//      span more than 500km (worst case 5,650km, on Project Waterworth) --
//      more than enough angular distance for a straight 2D screen-space
//      line to diverge from the rendered curve by many pixels if left
//      un-densified at all.
//
//   2. STALE CAMERA ORIENTATION AND MATRICES -- the dominant real-world
//      cause. react-globe.gl's `pointOfView()`/camera-follow-on-selection
//      moves `camera.position` and `controls.target` by direct property
//      assignment; it does NOT call `camera.lookAt()` or
//      `camera.updateMatrixWorld()`. The camera's actual *rotation*
//      (quaternion) is only recomputed inside OrbitControls' own
//      `update()`, which normally runs once per rendered frame -- and the
//      render loop itself only keeps ticking while something is visibly
//      animating (auto-rotate, an active drag, a damping settle). The
//      instant nothing is animating (e.g. right after auto-rotate is
//      paused on pointerdown, or a moment after a `flyTo` finishes), the
//      loop goes idle and the camera's quaternion is left frozen at
//      whatever it was on the last ticked frame -- confirmed by
//      instrumentation: after a `pointOfView()` call with the render loop
//      idle, `camera.quaternion` stayed at its old value indefinitely
//      (not just for one frame), and `getScreenCoords` for the exact point
//      the camera claimed to be centered on projected hundreds of pixels
//      off-canvas as a result -- until `controls.update()` was called
//      manually, which fixed it immediately. This module now forces both
//      `controls.update()` (fixes orientation) and `updateMatrixWorld()`
//      (propagates it) before every hit-test, so projection is correct
//      regardless of whether the render loop happened to tick recently.
//
// No cable geometry is altered by any of this -- both fixes only change how
// a click is matched to the existing real data, never what's drawn.
import type { CableFeature } from "./types";

export interface CableHitCandidate {
  cableId: string;
  cableName: string;
  color: string;
  distancePx: number;
}

export interface GlobeProjection {
  getCoords: (lat: number, lng: number, altitude?: number) => { x: number; y: number; z: number };
  getScreenCoords: (lat: number, lng: number, altitude?: number) => { x: number; y: number };
  camera: () => { position: { x: number; y: number; z: number }; updateMatrixWorld: (force?: boolean) => void };
  controls: () => { update: () => void };
}

/** Generous, screen-space, zoom-independent click tolerance around a cable's real geometry. */
export const CABLE_HIT_TOLERANCE_PX = 9;
/** three-globe's own default `pathPointAlt` -- paths render very slightly above the surface (to avoid z-fighting with the globe texture), so projecting at altitude 0 would be a small but real vertical mismatch versus the rendered curve. */
export const PATH_POINT_ALTITUDE = 0.001;
/** Two candidates within this margin of each other are "effectively identical" -- surface a chooser instead of guessing. */
export const CABLE_HIT_AMBIGUITY_MARGIN_PX = 4;
/** three-globe's own default `pathResolution` (degrees) -- see module doc, point 1. Must match exactly, not just approximately, since it's a threshold on the SAME distance metric (Euclidean in lat/lng-degree space) as the source. */
const PATH_RESOLUTION_DEG = 2;

export function pointToSegmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const abx = bx - ax;
  const aby = by - ay;
  const abLenSq = abx * abx + aby * aby;
  let t = abLenSq > 0 ? ((px - ax) * abx + (py - ay) * aby) / abLenSq : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * abx;
  const cy = ay + t * aby;
  const dx = px - cx;
  const dy = py - cy;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Points between (lat1,lng1) and (lat2,lng2), replicating three-globe's own
 * `calcPath`/`interpolateLine` (three-globe.js) exactly: naive linear
 * interpolation of latitude and longitude independently, gated by Euclidean
 * distance in degree-space (not geodesic distance), with the same
 * antimeridian-unwrapping step. This is deliberately NOT a great-circle
 * slerp -- see module doc, point 1, for why matching the source's actual
 * (geometrically naive) algorithm is what makes the hit-test line coincide
 * with the rendered one. Returns the interpolated points followed by
 * (lat2,lng2); the caller supplies (lat1,lng1) as the preceding anchor.
 */
export function densifyRenderedSegment(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
  maxDegDistance: number = PATH_RESOLUTION_DEG
): [number, number][] {
  let adjLng1 = lng1;
  while (Math.abs(adjLng1 - lng2) > 180) adjLng1 += 360 * (adjLng1 < lng2 ? 1 : -1);

  const dist = Math.sqrt((lat2 - lat1) ** 2 + (lng2 - adjLng1) ** 2);
  const points: [number, number][] = [];
  if (dist > maxDegDistance) {
    const numAdditionalPnts = Math.floor(dist / maxDegDistance);
    for (let i = 1; i <= numAdditionalPnts; i++) {
      const t = i / (numAdditionalPnts + 1);
      const lat = lat1 + (lat2 - lat1) * t;
      let lng = adjLng1 + (lng2 - adjLng1) * t;
      lng = ((((lng + 180) % 360) + 360) % 360) - 180; // normalize back into (-180, 180]
      points.push([lat, lng]);
    }
  }
  points.push([lat2, lng2]);
  return points;
}

/** True if a point on the globe's surface faces the camera (not occluded by the sphere itself). */
export function isFacingCamera(world: { x: number; y: number; z: number }, camPos: { x: number; y: number; z: number }): boolean {
  return world.x * camPos.x + world.y * camPos.y + world.z * camPos.z > 0;
}

/**
 * Finds real cables whose stored path geometry passes within `toleranceOx`
 * screen pixels of (clickX, clickY), sorted closest-first. Multiple raw
 * cables.json entries sharing a cable id (see cableNetwork.ts's merge) are
 * naturally combined here too, since we key candidates by cableId.
 */
export function findCablesNearScreenPoint(
  cables: CableFeature[],
  globe: GlobeProjection,
  clickX: number,
  clickY: number,
  toleranceOx: number = CABLE_HIT_TOLERANCE_PX
): CableHitCandidate[] {
  // Force fresh camera orientation and matrices -- see module doc, point 2.
  globe.controls().update();
  globe.camera().updateMatrixWorld(true);
  const camPos = globe.camera().position;
  const best = new Map<string, CableHitCandidate>();

  for (const cable of cables) {
    for (const path of cable.paths) {
      if (path.length < 2) continue;

      // Densify every real segment exactly as three-globe renders it -- see module doc, point 1.
      const densified: [number, number][] = [path[0]];
      for (let i = 0; i < path.length - 1; i++) {
        const [lat1, lng1] = path[i];
        const [lat2, lng2] = path[i + 1];
        for (const pt of densifyRenderedSegment(lat1, lng1, lat2, lng2)) densified.push(pt);
      }

      let prevVisible: { x: number; y: number } | null = null;
      for (const [lat, lng] of densified) {
        const world = globe.getCoords(lat, lng, PATH_POINT_ALTITUDE);
        if (!isFacingCamera(world, camPos)) {
          prevVisible = null;
          continue;
        }
        const screen = globe.getScreenCoords(lat, lng, PATH_POINT_ALTITUDE);
        if (prevVisible) {
          const d = pointToSegmentDistance(clickX, clickY, prevVisible.x, prevVisible.y, screen.x, screen.y);
          if (d <= toleranceOx) {
            const existing = best.get(cable.id);
            if (!existing || d < existing.distancePx) {
              best.set(cable.id, { cableId: cable.id, cableName: cable.name, color: cable.color, distancePx: d });
            }
          }
        }
        prevVisible = screen;
      }
    }
  }

  return [...best.values()].sort((a, b) => a.distancePx - b.distancePx);
}
