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
  /** Screen point -> the lat/lng under it, or null when the point is off the
   *  globe entirely. Used to prune the scan; optional so existing callers and
   *  tests that supply a minimal projection stub keep working. */
  toGlobeCoords?: (x: number, y: number) => { lat: number; lng: number } | null;
}

/** Generous, screen-space, zoom-independent click tolerance around a cable's real geometry. */
export const CABLE_HIT_TOLERANCE_PX = 9;
/** three-globe's own default `pathPointAlt` -- paths render very slightly above the surface (to avoid z-fighting with the globe texture), so projecting at altitude 0 would be a small but real vertical mismatch versus the rendered curve. */
export const PATH_POINT_ALTITUDE = 0.001;
/** Two candidates within this margin of each other are "effectively identical" -- surface a chooser instead of guessing. */
export const CABLE_HIT_AMBIGUITY_MARGIN_PX = 4;
/** Multiplier applied to both tolerances when the pointer is coarse (a finger,
 *  not a cursor). 9px is tuned against a 1px hotspot; a fingertip contact patch
 *  on a typical phone covers roughly 40px, and the reported point sits somewhere
 *  inside it. 2.2 lands near 20px -- wide enough that a 1.6px cable is reachable,
 *  narrow enough that the ambiguity chooser still resolves distinct systems
 *  rather than opening on every tap over a busy corridor. */
export const TOUCH_TOLERANCE_SCALE = 2.2;
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
 * Per-path latitude/longitude bounds, cached against the cables array.
 *
 * WHY. The scan below densifies every stored segment and runs TWO matrix
 * projections per densified point. Across 724 cables / 1,933 paths / 14,103
 * stored points that is well over a hundred thousand projections per call --
 * and the hover handler was calling it 20 times a second, so simply moving the
 * pointer across the globe cost hundreds of thousands of projections per
 * second. That is the interaction stutter, not the rendering.
 *
 * A cable can only be near the cursor if its geometry is near the cursor, and
 * that can be decided from the STORED coordinates without projecting anything.
 * Bounds are computed once per cables array and reused.
 */
const boundsCache = new WeakMap<CableFeature[], PathBounds[][]>();

/**
 * Densified geometry, cached against the cables array.
 *
 * Densification reproduces three-globe's own linear lat/lng interpolation so
 * the hit-test follows the curve that is actually drawn. It is a pure function
 * of the stored coordinates -- it cannot change while the dataset is the same
 * object -- yet it was being recomputed from scratch on every call, which for
 * hover meant tens of times a second. Computing it once and reusing it removes
 * that entirely and leaves only the projections, which genuinely do depend on
 * the camera.
 */
const densifiedCache = new WeakMap<CableFeature[], [number, number][][][]>();

/**
 * Projected screen positions for every densified point, cached against the
 * CAMERA.
 *
 * Projection is the entire remaining cost: two matrix operations per densified
 * point, and the prefilter can only skip paths that are geographically far
 * from the cursor -- in a dense region like the North Atlantic most paths
 * survive it. Measured at roughly 100 ms per scan, which the hover handler
 * paid on every throttled pointer move.
 *
 * But projection depends only on the camera, not on where the pointer is. As
 * long as the camera has not moved, every pointer event over the same view
 * projects to exactly the same screen coordinates. So it is computed once per
 * camera position and reused, turning subsequent hit-tests into a pure 2D
 * distance search.
 *
 * The cache key is the camera position, so ANY camera movement invalidates it.
 * That matters: an earlier bug in this module was hover and click disagreeing
 * because they evaluated against different camera states. A stale projection
 * cache would reintroduce exactly that, so staleness is impossible by
 * construction rather than by timing.
 */
interface ProjectionCache {
  camX: number;
  camY: number;
  camZ: number;
  /** Per cable, per path: flat [x, y, ...] with NaN for back-facing points.
   *  undefined means "not projected yet at this camera position". */
  screen: (Float64Array | undefined)[][];
}
let projectionCache: ProjectionCache | null = null;
let projectionCacheCables: CableFeature[] | null = null;

/**
 * How far the camera may drift before the cache is rebuilt, in world units.
 *
 * NOT an exact-match test, and that matters. OrbitControls runs with damping,
 * so `controls().update()` perturbs the camera by a minute amount on every
 * call -- an exact key therefore missed on literally every pointer event and
 * the cache never did anything.
 *
 * The globe has radius 1 and renders a few hundred pixels across, so one world
 * unit is on the order of a few hundred pixels. At 1e-4 units the largest
 * possible screen shift is far below half a pixel: too small to move any point
 * across the 9-pixel hit tolerance, so a cached projection cannot disagree
 * with a fresh one about what was clicked. Real camera movement is orders of
 * magnitude larger and misses immediately.
 */
const CAMERA_CACHE_TOLERANCE = 1e-4;

function cameraUnchanged(cache: ProjectionCache, p: { x: number; y: number; z: number }): boolean {
  return (
    Math.abs(cache.camX - p.x) < CAMERA_CACHE_TOLERANCE &&
    Math.abs(cache.camY - p.y) < CAMERA_CACHE_TOLERANCE &&
    Math.abs(cache.camZ - p.z) < CAMERA_CACHE_TOLERANCE
  );
}

/**
 * Projects ONE path, lazily.
 *
 * Projecting everything up front wasted almost all of it: the prefilter then
 * discarded the overwhelming majority of paths, so the first hit-test after
 * any camera movement paid ~250,000 projections to use a few thousand. Since
 * clicking a cable flies the camera, every cable click hit that cold path --
 * which is precisely the "lags for a split second when clicking a cable"
 * symptom. Projecting per path, on demand, means only the paths genuinely near
 * the pointer are ever computed.
 */
function projectPath(densified: [number, number][], globe: GlobeProjection): Float64Array {
  const camPos = globe.camera().position;
  const out = new Float64Array(densified.length * 2);
  for (let i = 0; i < densified.length; i++) {
    const [lat, lng] = densified[i];
    const world = globe.getCoords(lat, lng, PATH_POINT_ALTITUDE);
    if (!isFacingCamera(world, camPos)) {
      out[i * 2] = NaN;
      out[i * 2 + 1] = NaN;
      continue;
    }
    const screen = globe.getScreenCoords(lat, lng, PATH_POINT_ALTITUDE);
    out[i * 2] = screen.x;
    out[i * 2 + 1] = screen.y;
  }
  return out;
}

/** The lazily-filled projection table for the current camera position. */
function screenCacheFor(cables: CableFeature[], globe: GlobeProjection): (Float64Array | undefined)[][] {
  const p = globe.camera().position;
  if (projectionCache && projectionCacheCables === cables && cameraUnchanged(projectionCache, p)) {
    return projectionCache.screen;
  }
  projectionCache = {
    camX: p.x,
    camY: p.y,
    camZ: p.z,
    screen: cables.map((c) => new Array<Float64Array | undefined>(c.paths.length)),
  };
  projectionCacheCables = cables;
  return projectionCache.screen;
}

function densifiedFor(cables: CableFeature[]): [number, number][][][] {
  const cached = densifiedCache.get(cables);
  if (cached) return cached;
  const all = cables.map((cable) =>
    cable.paths.map((path) => {
      if (path.length < 2) return [] as [number, number][];
      const densified: [number, number][] = [path[0]];
      for (let i = 0; i < path.length - 1; i++) {
        const [lat1, lng1] = path[i];
        const [lat2, lng2] = path[i + 1];
        for (const pt of densifyRenderedSegment(lat1, lng1, lat2, lng2)) densified.push(pt);
      }
      return densified;
    })
  );
  densifiedCache.set(cables, all);
  return all;
}

interface PathBounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
  /** True when the path crosses the antimeridian, where a lat/lng box is
   *  meaningless. Such paths are never pruned -- being conservative costs a
   *  handful of extra projections; being wrong loses a clickable cable. */
  spansSeam: boolean;
}

function boundsFor(cables: CableFeature[]): PathBounds[][] {
  const cached = boundsCache.get(cables);
  if (cached) return cached;
  const all = cables.map((cable) =>
    cable.paths.map((path) => {
      let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180, spansSeam = false;
      for (let i = 0; i < path.length; i++) {
        const [lat, lng] = path[i];
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
        if (i > 0 && Math.abs(lng - path[i - 1][1]) > 180) spansSeam = true;
      }
      return { minLat, maxLat, minLng, maxLng, spansSeam };
    })
  );
  boundsCache.set(cables, all);
  return all;
}

/**
 * Angular margin, in degrees, within which a path must fall to be worth
 * projecting.
 *
 * Deliberately far larger than the pixel tolerance converts to at any zoom
 * this globe supports. The failure mode of a margin that is too small is a
 * cable that cannot be clicked, which is the behaviour this whole module
 * exists to provide -- so the margin is sized to make that impossible rather
 * than to squeeze out the last few projections. Even at 25 degrees the
 * prefilter discards the overwhelming majority of paths.
 */
const PREFILTER_MARGIN_DEG = 25;

function nearCursor(b: PathBounds, lat: number, lng: number): boolean {
  if (b.spansSeam) return true;
  if (lat < b.minLat - PREFILTER_MARGIN_DEG || lat > b.maxLat + PREFILTER_MARGIN_DEG) return false;
  // Longitude separation must be measured the short way round.
  const lo = b.minLng - PREFILTER_MARGIN_DEG;
  const hi = b.maxLng + PREFILTER_MARGIN_DEG;
  if (lng >= lo && lng <= hi) return true;
  const dLo = Math.min(Math.abs(lng - lo), 360 - Math.abs(lng - lo));
  const dHi = Math.min(Math.abs(lng - hi), 360 - Math.abs(lng - hi));
  return Math.min(dLo, dHi) <= PREFILTER_MARGIN_DEG;
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
  const best = new Map<string, CableHitCandidate>();

  // Prune to paths whose stored geometry is plausibly near the cursor before
  // projecting anything. When the cursor is off the globe there is nothing to
  // prune against, so the full scan still runs -- correctness first; callers
  // that only need advisory feedback can skip the call entirely.
  const cursor = globe.toGlobeCoords?.(clickX, clickY) ?? null;
  const bounds = cursor ? boundsFor(cables) : null;
  const densifiedAll = densifiedFor(cables);
  // Lazily-filled per camera position: a path is projected the first time it
  // survives the prefilter, and reused by every later event at the same camera.
  const screenAll = screenCacheFor(cables, globe);

  for (let ci = 0; ci < cables.length; ci++) {
    const cable = cables[ci];
    for (let pi = 0; pi < cable.paths.length; pi++) {
      const path = cable.paths[pi];
      if (path.length < 2) continue;
      if (cursor && bounds && !nearCursor(bounds[ci][pi], cursor.lat, cursor.lng)) continue;

      let screen = screenAll[ci][pi];
      if (!screen) {
        screen = projectPath(densifiedAll[ci][pi], globe);
        screenAll[ci][pi] = screen;
      }
      const n = screen.length / 2;
      let prevX = NaN;
      let prevY = NaN;
      for (let i = 0; i < n; i++) {
        const x = screen[i * 2];
        const y = screen[i * 2 + 1];
        // NaN marks a back-facing point: it breaks the polyline exactly as the
        // previous per-point visibility check did.
        if (Number.isNaN(x)) {
          prevX = NaN;
          continue;
        }
        if (!Number.isNaN(prevX)) {
          const d = pointToSegmentDistance(clickX, clickY, prevX, prevY, x, y);
          if (d <= toleranceOx) {
            const existing = best.get(cable.id);
            if (!existing || d < existing.distancePx) {
              best.set(cable.id, { cableId: cable.id, cableName: cable.name, color: cable.color, distancePx: d });
            }
          }
        }
        prevX = x;
        prevY = y;
      }
    }
  }

  return [...best.values()].sort((a, b) => a.distancePx - b.distancePx);
}
