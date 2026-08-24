// Distance from any point to the nearest existing cable, with exclusions.
//
// The corridor-following study found that cables sit far closer to other cables
// than displaced controls do -- a larger effect than seabed terrain. This turns
// that observation into something a router can use.
//
// THE EXCLUSION IS THE ENTIRE POINT. A router that can see the route it is
// being asked to predict will trace it and score perfectly, which measures
// nothing whatsoever. Every index built here therefore omits a stated set of
// routes, and the caller chooses how strict that is:
//
//   leave-one-out   omit only the route under test
//   same-cable      also omit other segments of the same named cable
//   same-agency     also omit every route from the same hydrographic office
//
// The strictest is the honest one for a prediction claim: it asks whether a
// route can be predicted from cables that a different country published.
import { haversineKm } from "./bathyGrid.mjs";

const BUCKET_DEG = 0.5;

/**
 * @param routes corpus routes, each with `coordinates` as [lng, lat] pairs.
 * @param systemKeys per-route cable-system identifier, or null where unknown.
 */
export function buildCorridorIndex(routes, systemKeys) {
  const buckets = new Map();
  for (let ri = 0; ri < routes.length; ri++) {
    for (const [lng, lat] of routes[ri].coordinates) {
      const key = `${Math.floor(lat / BUCKET_DEG)}:${Math.floor(lng / BUCKET_DEG)}`;
      let b = buckets.get(key);
      if (!b) { b = []; buckets.set(key, b); }
      b.push(lat, lng, ri);
    }
  }
  return { buckets, routes, systemKeys };
}

export const EXCLUSION = {
  leaveOneOut: "leave-one-out",
  sameCable: "same-cable",
  sameAgency: "same-agency",
};

/**
 * A distance function for one route under test.
 *
 * Memoised per query point, because A* revisits cells constantly and an
 * unmemoised version dominates the search cost.
 */
export function corridorDistanceFor(index, routeIndex, exclusionLevel) {
  const { buckets, routes, systemKeys } = index;
  const selfKey = systemKeys[routeIndex];
  const selfSource = routes[routeIndex].source;

  const excluded = (ri) => {
    if (ri === routeIndex) return true;
    if (exclusionLevel === EXCLUSION.leaveOneOut) return false;
    if (exclusionLevel === EXCLUSION.sameCable) {
      return selfKey !== null && systemKeys[ri] === selfKey;
    }
    // same-agency also implies same-cable, since a cable belongs to one source.
    return routes[ri].source === selfSource;
  };

  const memo = new Map();
  /** Quantised to ~1 km so nearby cells share an answer; the corridor term
   *  saturates at 25 km, so sub-kilometre precision changes nothing. */
  const qk = (lat, lng) => `${Math.round(lat * 100)}:${Math.round(lng * 100)}`;

  return (lat, lng) => {
    const key = qk(lat, lng);
    const hit = memo.get(key);
    if (hit !== undefined) return hit;

    let best = Infinity;
    const r0 = Math.floor(lat / BUCKET_DEG);
    const c0 = Math.floor(lng / BUCKET_DEG);
    for (let ring = 0; ring <= 3; ring++) {
      for (let dr = -ring; dr <= ring; dr++) {
        for (let dc = -ring; dc <= ring; dc++) {
          if (Math.max(Math.abs(dr), Math.abs(dc)) !== ring) continue;
          const b = buckets.get(`${r0 + dr}:${c0 + dc}`);
          if (!b) continue;
          for (let i = 0; i < b.length; i += 3) {
            if (excluded(b[i + 2])) continue;
            const d = haversineKm(lat, lng, b[i], b[i + 1]);
            if (d < best) best = d;
          }
        }
      }
      // A ring at n covers at least (n-1) buckets of clearance, so nothing
      // further out can beat a find already inside that.
      if (best < (ring - 1) * BUCKET_DEG * 111) break;
    }
    // Nothing found within the searched rings means "far", not zero -- the
    // caller saturates it anyway.
    const out = Number.isFinite(best) ? best : 999;
    memo.set(key, out);
    return out;
  };
}
