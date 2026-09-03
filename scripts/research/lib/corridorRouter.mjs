// A* over the 460 m bathymetry, restricted to a corridor around a route's
// endpoints, with a cost surface whose weights are a parameter.
//
// WHY A SEPARATE ROUTER FROM THE APP'S. The application routes over a 0.5
// degree grid (56 km cells) because it has to run in a browser. That grid
// cannot resolve the features this study is about -- it is 120x coarser than
// the corpus's own route sampling. This one runs offline over the 460 m tiles,
// so a predicted route can actually be compared against an as-laid one.
//
// WHY A CORRIDOR. Searching the whole ocean for every one of 355 routes is
// both unnecessary and misleading. Unnecessary because a cable between two
// points does not wander thousands of km off course; misleading because the
// loaded bathymetry only extends 1 degree around the observed routes, so a
// search allowed to leave that region would be optimising against terrain we
// do not have. The corridor is stated, not hidden, and its width is a
// reported parameter of the experiment.
//
// COST SURFACE. cost(cell) = distance * (1 + w.depth*d~ + w.slope*s~ +
// w.rough*r~ + w.corridor*c~), where each ~ term is that cell's value
// normalised to roughly 0..1 by a fixed scale. Setting every weight to zero
// gives a pure shortest-path search, which is exactly the geodesic baseline --
// so the baselines and the fitted model differ ONLY in their weights, never in
// the search. That is what makes the comparison fair.
//
// THE CORRIDOR TERM AND WHY IT MUST BE FED CAREFULLY. c~ is how far a cell sits
// from the nearest EXISTING cable, so a positive weight makes the router prefer
// established corridors. The corridor-following study found that effect larger
// than terrain -- but a router told about the very route it is predicting would
// simply trace it and score perfectly, which measures nothing.
//
// So `corridorDistanceKm` is supplied by the caller, not computed here, and the
// caller is responsible for excluding the route under test. The router cannot
// enforce that, so it is stated at every level: this comment, the experiment
// that calls it, and the exclusion levels reported in the results.
import { haversineKm } from "./bathyGrid.mjs";

/** Normalisation scales. Fixed constants, chosen once from the corpus's own
 *  depth/slope/roughness distributions, so a weight of 1 means "this term
 *  contributes about as much as distance" for a typical cell rather than an
 *  arbitrary amount. */
export const DEPTH_SCALE_M = 4000;
export const SLOPE_SCALE = 0.05;
export const ROUGH_SCALE_M = 120;
/** Distance beyond which "far from an existing cable" stops getting worse.
 *  25 km is roughly where the corridor-following study's real routes and its
 *  displaced controls separate (7.1 km vs 22.2 km under the strictest test). */
export const CORRIDOR_SCALE_KM = 25;

export const ZERO_WEIGHTS = { depth: 0, slope: 0, rough: 0, corridor: 0 };

/**
 * Cells per degree comes from the GRID, not from a constant here.
 *
 * It was a module-level 240 while only the Phase 1 tiles existed. The
 * long-haul extension routes over a 60/deg composite, because at 240/deg a
 * 3,000 km corridor is 37 million cells against a 2 million expansion cap --
 * not slow, impossible. A hardcoded resolution would have silently indexed
 * that grid at 4x the true scale, producing paths that look plausible and are
 * wrong, which is the worst available failure. BathyGrid already carries
 * perDeg, so it is the single source of truth.
 */
const DEFAULT_PER_DEG = 240;

/**
 * Terrain lookup with a small memo, since A* revisits cells constantly and
 * each lookup otherwise re-reads three separate grid neighbourhoods.
 */
class TerrainCache {
  constructor(grid, cellDeg) {
    this.grid = grid;
    this.cellDeg = cellDeg;
    this.memo = new Map();
  }
  at(row, col) {
    // Safe as a single numeric key while |col| stays well under 1e6: at
    // 240/deg the extremes are row +/-21,600 and col +/-43,200.
    const key = row * 1000000 + col;
    let v = this.memo.get(key);
    if (v !== undefined) return v;
    const lat = row * this.cellDeg;
    const lng = col * this.cellDeg;
    const depth = this.grid.depth(lat, lng);
    if (depth === null) {
      v = null;
    } else {
      const slope = this.grid.slope(lat, lng);
      const rough = this.grid.roughness(lat, lng);
      v = {
        depth,
        slope: slope === null ? 0 : slope,
        rough: rough === null ? 0 : Math.abs(rough),
      };
    }
    this.memo.set(key, v);
    return v;
  }
}

/** Binary heap keyed on f-score. */
class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(node) {
    const a = this.a;
    a.push(node);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

const KM_PER_DEG = 111.32;

/**
 * Routes between two points over the bathymetry.
 *
 * @param corridorDeg how far outside the endpoints' bounding box the search
 *        may wander. Also bounds the work: a wider corridor is a genuinely
 *        larger search, not just a looser constraint.
 * @returns { path: [[lat,lng],...], cells, reachable } -- `reachable: false`
 *        when no water path exists inside the corridor, which must be
 *        reported rather than silently returning a straight line.
 */
export function routeBetween(grid, a, b, weights, corridorDeg = 1.0, maxExpansions = 2_000_000, corridorDistanceKm = null) {
  const PER_DEG = grid?.perDeg ?? DEFAULT_PER_DEG;
  const CELL_DEG = 1 / PER_DEG;
  const terrain = new TerrainCache(grid, CELL_DEG);

  const minLat = Math.min(a[0], b[0]) - corridorDeg;
  const maxLat = Math.max(a[0], b[0]) + corridorDeg;
  const minLng = Math.min(a[1], b[1]) - corridorDeg;
  const maxLng = Math.max(a[1], b[1]) + corridorDeg;

  const rowLo = Math.floor(minLat * PER_DEG);
  const rowHi = Math.ceil(maxLat * PER_DEG);
  const colLo = Math.floor(minLng * PER_DEG);
  const colHi = Math.ceil(maxLng * PER_DEG);

  const toCell = (p) => [Math.round(p[0] * PER_DEG), Math.round(p[1] * PER_DEG)];

  /** Endpoints sit at landfall, where the cell is often land. Snap to the
   *  nearest water cell so the search has somewhere to start; the snap
   *  distance is returned so a bad snap cannot pass unnoticed. */
  function snapToWater(cell) {
    for (let ring = 0; ring <= 40; ring++) {
      for (let dr = -ring; dr <= ring; dr++) {
        for (let dc = -ring; dc <= ring; dc++) {
          if (Math.max(Math.abs(dr), Math.abs(dc)) !== ring) continue;
          const r = cell[0] + dr, c = cell[1] + dc;
          if (r < rowLo || r > rowHi || c < colLo || c > colHi) continue;
          if (terrain.at(r, c)) return [r, c];
        }
      }
    }
    return null;
  }

  const start = snapToWater(toCell(a));
  const goal = snapToWater(toCell(b));
  if (!start || !goal) return { path: null, reachable: false, reason: "no water cell near an endpoint" };

  const width = colHi - colLo + 1;
  const key = (r, c) => (r - rowLo) * width + (c - colLo);

  const gScore = new Map();
  const cameFrom = new Map();
  const open = new Heap();

  const cellLat = (r) => r * CELL_DEG;
  const cellLng = (c) => c * CELL_DEG;

  // Admissible heuristic: straight-line distance at the minimum possible cost
  // multiplier (1, when all terrain terms are zero). Never overestimates, so
  // A* stays optimal for the given cost surface.
  const h = (r, c) => haversineKm(cellLat(r), cellLng(c), cellLat(goal[0]), cellLng(goal[1]));

  gScore.set(key(start[0], start[1]), 0);
  open.push({ r: start[0], c: start[1], f: h(start[0], start[1]) });

  let expansions = 0;
  let found = false;

  while (open.size > 0) {
    const cur = open.pop();
    const ck = key(cur.r, cur.c);
    if (cur.r === goal[0] && cur.c === goal[1]) { found = true; break; }
    if (++expansions > maxExpansions) break;

    const g = gScore.get(ck);
    if (g === undefined) continue;

    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const nr = cur.r + dr, nc = cur.c + dc;
        if (nr < rowLo || nr > rowHi || nc < colLo || nc > colHi) continue;
        const t = terrain.at(nr, nc);
        if (!t) continue; // land or no data

        const lat = cellLat(nr);
        const stepKm =
          Math.hypot(dr * KM_PER_DEG * CELL_DEG, dc * KM_PER_DEG * CELL_DEG * Math.cos((lat * Math.PI) / 180));

        let multiplier =
          1 +
          weights.depth * (t.depth / DEPTH_SCALE_M) +
          weights.slope * (t.slope / SLOPE_SCALE) +
          weights.rough * (t.rough / ROUGH_SCALE_M);

        if (weights.corridor && corridorDistanceKm) {
          // Zero at an existing cable, saturating at CORRIDOR_SCALE_KM away, so
          // the term expresses "prefer established corridors" without letting a
          // remote cell cost unboundedly more than a merely distant one.
          const dKm = corridorDistanceKm(cellLat(nr), cellLng(nc));
          multiplier += weights.corridor * Math.min(1, dKm / CORRIDOR_SCALE_KM);
        }

        const tentative = g + stepKm * multiplier;
        const nk = key(nr, nc);
        const prev = gScore.get(nk);
        if (prev !== undefined && prev <= tentative) continue;
        gScore.set(nk, tentative);
        cameFrom.set(nk, ck);
        open.push({ r: nr, c: nc, f: tentative + h(nr, nc) });
      }
    }
  }

  if (!found) return { path: null, reachable: false, reason: `no path within corridor (${expansions} expansions)` };

  const path = [];
  let k = key(goal[0], goal[1]);
  const unkeyRow = (kk) => Math.floor(kk / width) + rowLo;
  const unkeyCol = (kk) => (kk % width) + colLo;
  for (;;) {
    path.push([cellLat(unkeyRow(k)), cellLng(unkeyCol(k))]);
    const prev = cameFrom.get(k);
    if (prev === undefined) break;
    k = prev;
  }
  path.reverse();
  return { path, reachable: true, expansions };
}
