// Screen-space hit-testing for hypothetical route candidates, mirroring
// cableHitTest.ts's proven approach (same rendering pipeline -- hypothetical
// routes are fed into the same react-globe.gl `pathsData` layer as real
// cables, via the same Line2/three-globe path densification, so the same
// exact-match technique applies). Deliberately a SEPARATE module rather than
// a modification of cableHitTest.ts's real-cable path, per this feature's
// explicit constraint not to touch the already-verified cable interaction
// code -- this only imports its already-exported pure geometry helpers.
import {
  densifyRenderedSegment,
  isFacingCamera,
  pointToSegmentDistance,
  PATH_POINT_ALTITUDE,
  CABLE_HIT_TOLERANCE_PX,
  type GlobeProjection,
} from "../cableHitTest";
import type { RoutingProfileId } from "./routingTypes";

export interface RouteHitCandidate {
  routeId: RoutingProfileId;
  distancePx: number;
}

export interface RouteHitTestInput {
  routeId: RoutingProfileId;
  points: [number, number][];
}

export function findRoutesNearScreenPoint(
  routes: RouteHitTestInput[],
  globe: GlobeProjection,
  clickX: number,
  clickY: number,
  toleranceOx: number = CABLE_HIT_TOLERANCE_PX
): RouteHitCandidate[] {
  globe.controls().update();
  globe.camera().updateMatrixWorld(true);
  const camPos = globe.camera().position;
  const best = new Map<RoutingProfileId, RouteHitCandidate>();

  for (const route of routes) {
    if (route.points.length < 2) continue;
    const densified: [number, number][] = [route.points[0]];
    for (let i = 0; i < route.points.length - 1; i++) {
      const [lat1, lng1] = route.points[i];
      const [lat2, lng2] = route.points[i + 1];
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
          const existing = best.get(route.routeId);
          if (!existing || d < existing.distancePx) {
            best.set(route.routeId, { routeId: route.routeId, distancePx: d });
          }
        }
      }
      prevVisible = screen;
    }
  }

  return [...best.values()].sort((a, b) => a.distancePx - b.distancePx);
}
