// React hook driving the routing Web Worker. Debounces/dedupes by input key
// so unrelated re-renders (or the same source/destination/weights firing
// again) don't restart the A* search, and discards any response that
// arrives for a request that's no longer the latest one in flight.
import { useEffect, useRef, useState } from "react";
import type { RoutingRequest, RoutingResponse } from "./routing.worker";
import type { RouteEngineResult, RoutingWeights } from "./routingTypes";

export interface UseHypotheticalRouteInput {
  sourceLat: number | null;
  sourceLng: number | null;
  sourceLabel: string;
  destLat: number | null;
  destLng: number | null;
  destLabel: string;
  weights: RoutingWeights;
}

export type RoutingStatus = "idle" | "loading" | "ready" | "error";

let worker: Worker | null = null;
function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./routing.worker.ts", import.meta.url), { type: "module" });
  }
  return worker;
}

let nextRequestId = 1;

function inputKey(input: UseHypotheticalRouteInput): string | null {
  if (input.sourceLat == null || input.sourceLng == null || input.destLat == null || input.destLng == null) return null;
  return [
    input.sourceLat.toFixed(3),
    input.sourceLng.toFixed(3),
    input.destLat.toFixed(3),
    input.destLng.toFixed(3),
    input.weights.length,
    input.weights.seabedDifficulty,
    input.weights.resilience,
    input.weights.environmental,
  ].join("|");
}

export function useHypotheticalRoute(input: UseHypotheticalRouteInput): { status: RoutingStatus; result: RouteEngineResult | null; error: string | null } {
  const [status, setStatus] = useState<RoutingStatus>("idle");
  const [result, setResult] = useState<RouteEngineResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastRequestId = useRef<number>(-1);
  const lastKey = useRef<string | null>(null);

  const key = inputKey(input);

  useEffect(() => {
    if (!key) {
      setStatus("idle");
      setResult(null);
      setError(null);
      lastKey.current = null;
      return;
    }

    // The message listener is attached on EVERY effect invocation,
    // independent of whether a new request is actually sent below -- under
    // React 19 StrictMode's dev-only mount->cleanup->mount double-invoke,
    // the first invocation's cleanup removes its listener before the second
    // invocation runs; if listener attachment were skipped whenever the key
    // already matched (the normal, correct dedup case), the second
    // invocation would never re-attach one, permanently orphaning the
    // in-flight request's response -- confirmed via a real posted request
    // that resolved fine when tested directly against the worker but never
    // reached this hook's state. Sending vs. not-sending is decided
    // separately below; listening is unconditional.
    const w = getWorker();
    function handleMessage(e: MessageEvent<RoutingResponse>) {
      if (e.data.requestId !== lastRequestId.current) return; // stale response, superseded by a newer request
      if (e.data.ok) {
        setResult(e.data.result);
        setStatus("ready");
      } else {
        setError(e.data.error);
        setStatus("error");
      }
    }
    w.addEventListener("message", handleMessage);

    if (key !== lastKey.current) {
      lastKey.current = key;
      const requestId = nextRequestId++;
      lastRequestId.current = requestId;
      setStatus("loading");
      setError(null);
      // Drop the previous route BEFORE the new search starts. Without this the
      // last result stays in state for the whole 15-25 s the worker runs, so
      // the globe keeps drawing the route between the PREVIOUS pair of cities
      // while the panel says it is routing the new one -- geometry presented as
      // current that belongs to somewhere else entirely. Showing nothing is
      // correct here; showing stale geometry is a false claim about where a
      // cable would go.
      setResult(null);

      const req: RoutingRequest = {
        requestId,
        sourceLat: input.sourceLat!,
        sourceLng: input.sourceLng!,
        sourceLabel: input.sourceLabel,
        destLat: input.destLat!,
        destLng: input.destLng!,
        destLabel: input.destLabel,
        weights: input.weights,
      };
      w.postMessage(req);
    }

    return () => {
      w.removeEventListener("message", handleMessage);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { status, result, error };
}
