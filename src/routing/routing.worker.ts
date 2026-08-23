// Runs the hypothetical routing engine off the main thread -- A* over a
// ~147k-cell ocean graph plus per-candidate depth/resilience sampling is
// real work, and the app has no existing worker infrastructure to reuse
// (see the architecture inspection this feature was built from). The
// worker loads its own copies of the real datasets (same static JSON the
// main thread already fetches) so requests only need to carry
// coordinates/weights, not the whole cable/grid payload every time.
import { loadOceanGrid } from "./oceanGrid";
import { runHypotheticalRouting } from "./hypotheticalRouting";
import type { CableFeature, LandingPoint } from "../types";
import type { RouteEngineResult, RoutingWeights } from "./routingTypes";

export interface RoutingRequest {
  requestId: number;
  sourceLat: number;
  sourceLng: number;
  sourceLabel: string;
  destLat: number;
  destLng: number;
  destLabel: string;
  weights: RoutingWeights;
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

function getCables(): Promise<CableFeature[]> {
  if (!cablesPromise) cablesPromise = fetchJSON<CableFeature[]>("/data/cables.json");
  return cablesPromise;
}
function getLandingPoints(): Promise<LandingPoint[]> {
  if (!landingPointsPromise) landingPointsPromise = fetchJSON<LandingPoint[]>("/data/landing-points.json");
  return landingPointsPromise;
}

self.onmessage = async (e: MessageEvent<RoutingRequest>) => {
  const req = e.data;
  try {
    const [grid, cables, landingPoints] = await Promise.all([loadOceanGrid(), getCables(), getLandingPoints()]);
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
      weights: req.weights,
    });
    const response: RoutingResponse = { requestId: req.requestId, ok: true, result };
    (self as unknown as Worker).postMessage(response);
  } catch (err) {
    const response: RoutingResponse = { requestId: req.requestId, ok: false, error: String(err) };
    (self as unknown as Worker).postMessage(response);
  }
};
