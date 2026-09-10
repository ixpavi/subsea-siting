// Runs the hypothetical routing engine off the main thread -- A* over a
// ~147k-cell ocean graph plus per-candidate depth/resilience sampling is
// real work, and the app has no existing worker infrastructure to reuse
// (see the architecture inspection this feature was built from). The
// worker loads its own copies of the real datasets (same static JSON the
// main thread already fetches) so requests only need to carry
// coordinates, not the whole cable/grid payload every time.
import { loadOceanGrid } from "./oceanGrid";
import { loadProtectedAreas } from "./protectedAreas";
import { runHypotheticalRouting } from "./hypotheticalRouting";
import type { CableFeature, LandingPoint } from "../types";
import type { RouteEngineResult } from "./routingTypes";
import { assetUrl } from "../assetUrl";

/**
 * No weights: they only rank the candidates, and the page re-ranks the result
 * itself whenever they change (see useHypotheticalRoute), so a weight change
 * never has to wait for a search.
 */
export interface RoutingRequest {
  requestId: number;
  sourceLat: number;
  sourceLng: number;
  sourceLabel: string;
  destLat: number;
  destLng: number;
  destLabel: string;
}

export type RoutingResponse =
  | { requestId: number; ok: true; result: RouteEngineResult }
  | { requestId: number; ok: false; error: string };

async function fetchJSON<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return res.json();
}

let cablesPromise: Promise<CableFeature[]> | null = null;
let landingPointsPromise: Promise<LandingPoint[]> | null = null;

// A failed download is forgotten rather than cached, so the next request
// retries it. The worker lives for the whole session; caching the failure
// would break routing until the page was reloaded.
function getCables(): Promise<CableFeature[]> {
  if (!cablesPromise) {
    cablesPromise = fetchJSON<CableFeature[]>(assetUrl("data/cables.json"));
    cablesPromise.catch(() => {
      cablesPromise = null;
    });
  }
  return cablesPromise;
}
function getLandingPoints(): Promise<LandingPoint[]> {
  if (!landingPointsPromise) {
    landingPointsPromise = fetchJSON<LandingPoint[]>(assetUrl("data/landing-points.json"));
    landingPointsPromise.catch(() => {
      landingPointsPromise = null;
    });
  }
  return landingPointsPromise;
}

self.onmessage = async (e: MessageEvent<RoutingRequest>) => {
  const req = e.data;
  try {
    // Protected areas are allowed to fail without taking the route with them:
    // a missing environmental dataset degrades that one criterion to
    // unavailable, which the engine already handles, rather than failing the
    // whole request.
    const [grid, cables, landingPoints, protectedAreas] = await Promise.all([
      loadOceanGrid(),
      getCables(),
      getLandingPoints(),
      loadProtectedAreas().catch(() => null),
    ]);
    const result = runHypotheticalRouting({
      sourceLat: req.sourceLat,
      sourceLng: req.sourceLng,
      sourceLabel: req.sourceLabel,
      destLat: req.destLat,
      destLng: req.destLng,
      destLabel: req.destLabel,
      cables,
      landingPoints,
      grid,
      protectedAreas,
    });
    const response: RoutingResponse = { requestId: req.requestId, ok: true, result };
    (self as unknown as Worker).postMessage(response);
  } catch (err) {
    const response: RoutingResponse = { requestId: req.requestId, ok: false, error: String(err) };
    (self as unknown as Worker).postMessage(response);
  }
};
