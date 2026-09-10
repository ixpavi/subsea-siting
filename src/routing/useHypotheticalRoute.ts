// React hook driving the routing Web Worker. Debounces/dedupes by input key
// so unrelated re-renders (or the same source/destination firing again) don't
// restart the A* search, and discards any response that arrives for a request
// that's no longer the latest one in flight.
import { useEffect, useMemo, useRef, useState } from "react";
import type { RoutingRequest, RoutingResponse } from "./routing.worker";
import type { RouteEngineResult, RoutingWeights } from "./routingTypes";
import { rerankRouteResult } from "./hypotheticalRouting";

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

/**
 * Shown when the worker script itself cannot be loaded. The usual cause is a
 * deploy: the worker's file name carries a content hash, so a page opened
 * before the site was updated asks for a file the new deployment no longer
 * has. Nothing the page can do fixes that, but a reload does -- and without
 * this the panel said "Computing candidate marine routes…" forever.
 */
const WORKER_LOAD_ERROR =
  "The routing engine could not be loaded. This usually means the site was updated after this page was " +
  "opened -- reload the page to continue.";

let worker: Worker | null = null;
function getWorker(): Worker {
  if (!worker) {
    const w = new Worker(new URL("./routing.worker.ts", import.meta.url), { type: "module" });
    // The request handler catches everything, so an error event means the
    // worker never loaded. Drop it, so the next request starts a fresh one
    // instead of posting into a dead worker and waiting forever.
    w.addEventListener("error", () => {
      if (worker === w) worker = null;
      w.terminate();
    });
    worker = w;
  }
  return worker;
}

let nextRequestId = 1;

/**
 * What the search depends on. Weights are deliberately NOT part of it: they
 * only rank the candidates, which is redone here on the main thread (see
 * rerankRouteResult). Keying on them restarted the whole search for every
 * weight click, and the routes disappeared from the globe while it ran.
 */
function inputKey(input: UseHypotheticalRouteInput): string | null {
  if (input.sourceLat == null || input.sourceLng == null || input.destLat == null || input.destLng == null) return null;
  return [
    input.sourceLat.toFixed(3),
    input.sourceLng.toFixed(3),
    input.destLat.toFixed(3),
    input.destLng.toFixed(3),
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
    // Fired when the worker script fails to load or throws outside the
    // request handler -- neither produces a message, so without this the
    // request would simply never finish.
    function handleError(e: Event) {
      e.preventDefault();
      setError(WORKER_LOAD_ERROR);
      setStatus("error");
    }
    w.addEventListener("message", handleMessage);
    w.addEventListener("error", handleError);

    if (key !== lastKey.current) {
      lastKey.current = key;
      const requestId = nextRequestId++;
      lastRequestId.current = requestId;
      setStatus("loading");
      setError(null);
      // Drop the previous route BEFORE the new search starts. Without this the
      // last result stays in state for the whole time the worker runs, so the
      // globe keeps drawing the route between the PREVIOUS pair of cities
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
      };
      w.postMessage(req);
    }

    return () => {
      w.removeEventListener("message", handleMessage);
      w.removeEventListener("error", handleError);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Ranked under the CURRENT weights. Cheap, so it simply runs whenever the
  // weights or the result change, and the routes stay on the globe throughout.
  const ranked = useMemo(() => (result ? rerankRouteResult(result, input.weights) : null), [result, input.weights]);

  return { status, result: ranked, error };
}
