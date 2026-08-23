import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import GlobeGL from "react-globe.gl";
import type { GlobeMethods } from "react-globe.gl";
import type { CableFeature, LandDC, SubseaDC, LandingPoint, LayerToggles, Selection } from "./types";
import type { ConnectivityAnalysis, RelevantCable, RelevantLandingPoint } from "./design/connectivityAnalysis";
import type { CableNetworkIndex, NetworkSelection } from "./cableNetwork";
import { findCablesNearScreenPoint, CABLE_HIT_TOLERANCE_PX, CABLE_HIT_AMBIGUITY_MARGIN_PX } from "./cableHitTest";
import type { CableHitCandidate } from "./cableHitTest";
import { findRoutesNearScreenPoint } from "./routing/routeHitTest";
import type { RouteEngineResult, RoutingProfileId } from "./routing/routingTypes";

const LAND_DC_COLOR = "#5eead4";
const SUBSEA_DC_COLOR = "#fb923c";
const CONNECTOR_COLOR = "#fbbf24";
const PLANNING_LINE_COLOR = "#e2e8f0";
// Match the source/destination planning-marker glyph colors (design.css
// .planning-marker-location / .planning-marker-destination) so a landing
// point rendered on the real-data side reads as "same endpoint" as its
// hypothetical marker, not an unrelated new color.
const SOURCE_LANDING_POINT_COLOR = "#38bdf8";
const DESTINATION_LANDING_POINT_COLOR = "#f472b6";

interface CableFlatPath {
  kind: "cable";
  cableId: string;
  cableName: string;
  color: string;
  points: [number, number][];
}

interface RouteFlatPath {
  kind: "route";
  routeId: RoutingProfileId;
  label: string;
  selected: boolean;
  points: [number, number][];
}

/** A wide, low-alpha, non-dashed duplicate of the selected route's geometry, rendered as its own pathsData entry immediately before the real one so it draws underneath -- a cheap WebGL halo/glow technique (two overlapping Line2 strokes at the same 3D position) that needs no extra rendering pipeline. */
interface RouteHaloPath {
  kind: "route-halo";
  routeId: RoutingProfileId;
  points: [number, number][];
}

type FlatPath = CableFlatPath | RouteFlatPath | RouteHaloPath;

const ROUTE_COLORS: Record<RoutingProfileId, string> = {
  shortest: "#facc15",
  "shallow-favoring": "#a78bfa",
  "diverse-corridor": "#34d399",
};

/** Bright, high-contrast override for whichever candidate is currently selected -- distinct from every ROUTE_COLORS entry and from every real-cable color in the dataset, so "the proposed route" reads as a completely different kind of object, not just another colored line among hundreds. */
const SELECTED_ROUTE_COLOR = "#ffffff";

type ArcDatum =
  | { kind: "connector"; startLat: number; startLng: number; endLat: number; endLng: number; label: string }
  | { kind: "planning"; startLat: number; startLng: number; endLat: number; endLng: number; label: string };

export interface PlanningMarker {
  id: string;
  kind: "location" | "destination" | "proposed";
  lat: number;
  lng: number;
  label: string;
  sublabel?: string;
}

/** Where a candidate route actually starts/ends in the ocean -- distinct from the business-location PlanningMarker above, which sits at the city itself. See routing/routingTypes.ts's MarineEndpoint. */
export interface RouteEndpointMarker {
  id: string;
  kind: "route-endpoint";
  role: "source" | "destination";
  lat: number;
  lng: number;
  label: "SOURCE MARINE ACCESS" | "DESTINATION MARINE ACCESS";
  sublabel: string;
  real: boolean;
}

/** Small tag anchored to the selected candidate's own geometry, not the endpoints -- "which one of these lines is the proposal" at a glance without hunting for the panel. */
export interface RouteLabelMarker {
  id: string;
  kind: "route-label";
  lat: number;
  lng: number;
  label: string;
}

type GlobeHtmlMarker = PlanningMarker | RouteEndpointMarker | RouteLabelMarker;

export interface PlanningConnectivity {
  lat1: number;
  lng1: number;
  lat2: number;
  lng2: number;
}

/** A landing point surfaced by real-data connectivity analysis, tagged with which endpoint it's near. */
export type ConnectivityLandingPointDatum = RelevantLandingPoint & { role: "source" | "destination" };

export type ConnectivitySelection =
  | { kind: "cable"; data: RelevantCable }
  | { kind: "landingPoint"; data: ConnectivityLandingPointDatum };

/** Imperative handle exposed to App.tsx -- the smallest addition needed for camera control without reworking Globe's rendering. */
export interface GlobeApi {
  flyTo: (lat: number, lng: number, altitude?: number) => void;
}

interface Props {
  cables: CableFeature[];
  landDCs: LandDC[];
  subseaDCs: SubseaDC[];
  toggles: LayerToggles;
  rotating: boolean;
  onUserInteracted: () => void;
  onSelect: (sel: Selection | null) => void;
  /** When true, de-emphasizes real infrastructure so planning overlays stand out. Explore mode is unaffected (defaults false). */
  planningMode?: boolean;
  planningMarkers?: PlanningMarker[];
  planningConnectivity?: PlanningConnectivity | null;
  onDismissProposedSite?: () => void;
  /** Real-data connectivity analysis result, when the "Existing Connectivity" stage has resolved coordinates. Drives cable/landing-point emphasis. */
  connectivityAnalysis?: ConnectivityAnalysis | null;
  onSelectConnectivityItem?: (sel: ConnectivitySelection) => void;
  /** All real landing points -- only rendered as a clickable layer in explore mode (planningMode false); planning mode shows just the connectivity-analysis subset above. */
  landingPoints?: LandingPoint[];
  /** Cable<->landing-point join built once in App.tsx; drives the explore-mode cable explorer's highlighting and click routing. */
  cableNetworkIndex?: CableNetworkIndex | null;
  /** The single cable or landing point currently selected in the explore-mode cable explorer (independent of planning mode's connectivity selection). */
  networkSelection?: NetworkSelection | null;
  onSelectNetworkItem?: (sel: NetworkSelection) => void;
  /** Cable ids emphasized after handing off from a planning-mode connectivity analysis via "Explore existing cables" -- ignored once the user makes an explicit explore-mode selection. */
  explorerScope?: Set<string> | null;
  /** Fired instead of a direct selection when a click's tolerance zone genuinely contains multiple distinct real cables -- see cableHitTest.ts. */
  onAmbiguousCableClick?: (candidates: CableHitCandidate[]) => void;
  /** Structured hypothetical-routing result (src/routing/*) for the current planning source/destination, if any. */
  routeEngineResult?: RouteEngineResult | null;
  selectedRouteCandidateId?: RoutingProfileId | null;
  onSelectRouteCandidate?: (id: RoutingProfileId | null) => void;
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = Number.parseInt(full.slice(0, 2), 16);
  const g = Number.parseInt(full.slice(2, 4), 16);
  const b = Number.parseInt(full.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const Globe = forwardRef<GlobeApi, Props>(function Globe(
  {
    cables,
    landDCs,
    subseaDCs,
    toggles,
    rotating,
    onUserInteracted,
    onSelect,
    planningMode = false,
    planningMarkers = [],
    planningConnectivity = null,
    onDismissProposedSite,
    connectivityAnalysis = null,
    onSelectConnectivityItem,
    landingPoints = [],
    cableNetworkIndex = null,
    networkSelection = null,
    onSelectNetworkItem,
    explorerScope = null,
    onAmbiguousCableClick,
    routeEngineResult = null,
    selectedRouteCandidateId = null,
    onSelectRouteCandidate,
  },
  ref
) {
  const globeRef = useRef<GlobeMethods | undefined>(undefined);

  // react-globe.gl/three-render-objects defaults its internal projection
  // width/height (used by getScreenCoords/getCoords for all hit-testing) to
  // `window.innerWidth/innerHeight` read ONCE at mount, with no resize
  // listener of its own -- so after a browser resize, its internal
  // projection size silently drifts from the canvas's actual rendered size,
  // while our click handler's canvas-relative coordinates (from
  // getBoundingClientRect, always live) do not. Passing explicit width/height
  // props kept fresh here closes that gap.
  const [dims, setDims] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  useEffect(() => {
    const handleResize = () => setDims({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      flyTo: (lat: number, lng: number, altitude = 1.5) => {
        globeRef.current?.pointOfView({ lat, lng, altitude }, 1300);
      },
    }),
    []
  );

  // Initial camera + controls setup (runs once)
  useEffect(() => {
    const g = globeRef.current;
    if (!g) return;
    g.pointOfView({ lat: 20, lng: 10, altitude: 2.2 }, 0);
    const controls = g.controls();
    controls.autoRotateSpeed = 0.35;
    controls.enableDamping = true;
    // Any manual drag/zoom pauses auto-rotation so the user keeps control of the view
    const handleStart = () => onUserInteracted();
    controls.addEventListener("start", handleStart);
    return () => controls.removeEventListener("start", handleStart);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep controls.autoRotate in sync with the rotating prop
  useEffect(() => {
    const g = globeRef.current;
    if (!g) return;
    g.controls().autoRotate = rotating;
  }, [rotating]);

  // Cables/landing points the real-data connectivity analysis found relevant
  // -- used purely to emphasize/de-emphasize existing rendering, never to
  // draw new geometry (the cable paths themselves are still `cables` as-is).
  const relevantCableIds = useMemo(
    () => new Set((connectivityAnalysis?.relevantCables ?? []).map((c) => c.id)),
    [connectivityAnalysis]
  );
  const relevantCablesById = useMemo(() => {
    const m = new Map<string, RelevantCable>();
    for (const c of connectivityAnalysis?.relevantCables ?? []) m.set(c.id, c);
    return m;
  }, [connectivityAnalysis]);
  const connectivityLandingPoints: ConnectivityLandingPointDatum[] = useMemo(() => {
    if (!connectivityAnalysis) return [];
    const src = connectivityAnalysis.source.landingPoints.map((lp) => ({ ...lp, role: "source" as const }));
    const dst = (connectivityAnalysis.destination?.landingPoints ?? []).map((lp) => ({
      ...lp,
      role: "destination" as const,
    }));
    return [...src, ...dst];
  }, [connectivityAnalysis]);

  // Explore-mode cable explorer selection derivations. Independent of the
  // planning-mode connectivity emphasis above -- explore mode is only active
  // when planningMode is false, so these two schemes never overlap.
  const exploreSelectedCableId =
    !planningMode && networkSelection?.kind === "cable" ? networkSelection.cableId : null;
  const exploreSelectedLandingPointId =
    !planningMode && networkSelection?.kind === "landingPoint" ? networkSelection.landingPointId : null;

  const exploreRelatedCableIds = useMemo(() => {
    if (!exploreSelectedLandingPointId || !cableNetworkIndex) return null;
    const cables = cableNetworkIndex.landingPointToCables.get(exploreSelectedLandingPointId) ?? [];
    return new Set(cables.map((c) => c.id));
  }, [exploreSelectedLandingPointId, cableNetworkIndex]);

  const exploreSelectedCableLandingPointIds = useMemo(() => {
    if (!exploreSelectedCableId || !cableNetworkIndex) return null;
    const lps = cableNetworkIndex.cableToLandingPoints.get(exploreSelectedCableId) ?? [];
    return new Set(lps.map((lp) => lp.id));
  }, [exploreSelectedCableId, cableNetworkIndex]);

  const flatCablePaths: CableFlatPath[] = useMemo(
    () =>
      cables.flatMap((c) =>
        c.paths.map((points) => ({
          kind: "cable" as const,
          cableId: c.id,
          cableName: c.name,
          color: c.color,
          points,
        }))
      ),
    [cables]
  );

  // Hypothetical route candidates (src/routing/*) -- fed into the SAME
  // pathsData layer as real cables so they get the identical rendering
  // pipeline (and the identical densification hit-testing relies on, see
  // routing/routeHitTest.ts), distinguished purely by the `kind` tag below.
  const routeFlatPaths: RouteFlatPath[] = useMemo(() => {
    if (!planningMode || !routeEngineResult) return [];
    return routeEngineResult.candidates.map((rc) => ({
      kind: "route" as const,
      routeId: rc.candidate.id,
      label: rc.candidate.label,
      selected: rc.candidate.id === selectedRouteCandidateId,
      points: rc.candidate.path,
    }));
  }, [planningMode, routeEngineResult, selectedRouteCandidateId]);

  // True once real hypothetical-route candidates exist to show -- drives
  // both the halo/glow on the selected one and the substantial fade-out of
  // real cables below, so the proposed route reads as the dominant object
  // on the globe rather than one more colored line among hundreds.
  const hypotheticalRoutesActive = routeFlatPaths.length > 0;

  const routeHaloPaths: RouteHaloPath[] = useMemo(() => {
    const selected = routeFlatPaths.find((r) => r.selected);
    return selected ? [{ kind: "route-halo" as const, routeId: selected.routeId, points: selected.points }] : [];
  }, [routeFlatPaths]);

  const combinedPaths: FlatPath[] = useMemo(
    // Halo entries are ordered BEFORE the route itself so they paint first
    // (underneath); real cables are ordered first of all so every
    // hypothetical-route element paints on top of them regardless of draw
    // order ties.
    () => [...(toggles.cables ? flatCablePaths : []), ...routeHaloPaths, ...routeFlatPaths],
    [toggles.cables, flatCablePaths, routeHaloPaths, routeFlatPaths]
  );

  const arcsData: ArcDatum[] = useMemo(() => {
    const connectorArcs: ArcDatum[] =
      toggles.connectors && toggles.subseaDCs
        ? subseaDCs
            .filter((dc) => dc.nearestLandingPoint)
            .map((dc) => ({
              kind: "connector" as const,
              startLat: dc.lat,
              startLng: dc.lng,
              endLat: dc.nearestLandingPoint!.lat,
              endLng: dc.nearestLandingPoint!.lng,
              label: `${dc.name} → ${dc.nearestLandingPoint!.name} (${dc.nearestLandingPointDistanceKm} km)`,
            }))
        : [];

    const planningArc: ArcDatum[] = planningConnectivity
      ? [
          {
            kind: "planning" as const,
            startLat: planningConnectivity.lat1,
            startLng: planningConnectivity.lng1,
            endLat: planningConnectivity.lat2,
            endLng: planningConnectivity.lng2,
            label: "Geodesic baseline -- not a proposed cable route",
          },
        ]
      : [];

    return [...connectorArcs, ...planningArc];
  }, [subseaDCs, toggles.connectors, toggles.subseaDCs, planningConnectivity]);

  // Every real landing point, clickable in explore mode only -- planning
  // mode keeps its own smaller connectivityLandingPoints subset above.
  const explorePointsData = useMemo(() => {
    if (planningMode || !toggles.landingPoints) return [];
    return landingPoints.map((lp) => ({ kind: "exploreLandingPoint" as const, data: lp }));
  }, [planningMode, toggles.landingPoints, landingPoints]);

  const pointsData = useMemo(
    () => [
      ...(toggles.landDCs && !connectivityAnalysis
        ? landDCs.map((d) => ({ kind: "land" as const, data: d }))
        : []),
      ...(toggles.subseaDCs && !connectivityAnalysis
        ? subseaDCs.map((d) => ({ kind: "subsea" as const, data: d }))
        : []),
      ...connectivityLandingPoints.map((lp) => ({ kind: "landingPoint" as const, data: lp })),
      ...explorePointsData,
    ],
    [toggles.landDCs, toggles.subseaDCs, connectivityAnalysis, landDCs, subseaDCs, connectivityLandingPoints, explorePointsData]
  );

  // Custom cable click/hover hit-testing -- see cableHitTest.ts for why
  // three-globe's built-in path raycasting can't be trusted (effective
  // click tolerance is sub-pixel, independent of any `pathStroke` value).
  // The native listener below is attached once; it always reads the latest
  // props through this ref so it never needs to be torn down and re-bound
  // as selection/mode state changes.
  const interactionStateRef = useRef({
    cables,
    planningMode,
    relevantCablesById,
    onSelectConnectivityItem,
    onSelectNetworkItem,
    onAmbiguousCableClick,
    onUserInteracted,
    routeFlatPaths,
    onSelectRouteCandidate,
  });
  interactionStateRef.current = {
    cables,
    planningMode,
    relevantCablesById,
    onSelectConnectivityItem,
    onSelectNetworkItem,
    onAmbiguousCableClick,
    onUserInteracted,
    routeFlatPaths,
    onSelectRouteCandidate,
  };

  useEffect(() => {
    const g = globeRef.current;
    if (!g) return;
    const canvas = g.renderer().domElement;

    let downPos: { x: number; y: number } | null = null;
    let lastHoverAt = 0;

    function canvasPos(e: PointerEvent): { x: number; y: number } {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    function resolveCandidates(x: number, y: number): CableHitCandidate[] {
      const s = interactionStateRef.current;
      const globeInstance = globeRef.current;
      if (!globeInstance) return [];
      const candidates = findCablesNearScreenPoint(s.cables, globeInstance, x, y, CABLE_HIT_TOLERANCE_PX);
      return s.planningMode ? candidates.filter((c) => s.relevantCablesById.has(c.cableId)) : candidates;
    }

    function handlePointerDown(e: PointerEvent) {
      downPos = canvasPos(e);
      // Stop auto-rotation the INSTANT a pointer touches the canvas, before
      // any click-vs-drag decision or hit-testing runs. Previously this
      // only happened via OrbitControls' own 'start' event round-tripping
      // through React state (onUserInteracted -> setRotating(false) -> a
      // separate effect setting controls.autoRotate) -- a real gap during
      // which the camera keeps rotating. At high zoom, a few milliseconds
      // of continued rotation is enough screen-space drift to move a cable
      // out from under a pointer that was, at the moment the user looked,
      // sitting exactly on it. Setting autoRotate here directly guarantees
      // the camera is frozen for the whole duration of pointerdown ->
      // pointerup, so the projection computed at click time matches what
      // was actually on screen when the user clicked.
      const g = globeRef.current;
      if (g) g.controls().autoRotate = false;
      interactionStateRef.current.onUserInteracted();
    }

    function handlePointerUp(e: PointerEvent) {
      const start = downPos;
      downPos = null;
      if (!start) return;
      const up = canvasPos(e);
      // A real drag/rotate, not a click -- OrbitControls already handled it.
      if (Math.hypot(up.x - start.x, up.y - start.y) > 5) return;

      const filtered = resolveCandidates(up.x, up.y);
      const s = interactionStateRef.current;

      if (filtered.length === 0) {
        // No real cable at this point -- in planning mode, a hypothetical
        // route candidate may be there instead (same click, same tolerance,
        // same custom hit-test technique; see routing/routeHitTest.ts).
        if (s.planningMode && s.routeFlatPaths.length > 0) {
          const globeInstance = globeRef.current;
          if (globeInstance) {
            const routeHits = findRoutesNearScreenPoint(s.routeFlatPaths, globeInstance, up.x, up.y, CABLE_HIT_TOLERANCE_PX);
            if (routeHits.length > 0) s.onSelectRouteCandidate?.(routeHits[0].routeId);
          }
        }
        return;
      }

      const [closest, second] = filtered;
      const ambiguous = second != null && second.distancePx - closest.distancePx < CABLE_HIT_AMBIGUITY_MARGIN_PX;

      if (ambiguous) {
        const tied = filtered.filter((c) => c.distancePx - closest.distancePx < CABLE_HIT_AMBIGUITY_MARGIN_PX);
        s.onAmbiguousCableClick?.(tied);
        return;
      }

      if (s.planningMode) {
        const rel = s.relevantCablesById.get(closest.cableId);
        if (rel) s.onSelectConnectivityItem?.({ kind: "cable", data: rel });
      } else {
        s.onSelectNetworkItem?.({ kind: "cable", cableId: closest.cableId });
      }
    }

    // Cursor feedback -- throttled by time only (a full scan projects every
    // stored cable point and doesn't need to run at full pointer-move rate),
    // but evaluated SYNCHRONOUSLY: position and camera state must be read at
    // the same instant, or the cursor can reflect a different moment than
    // what a click at that same position would see. A prior version deferred
    // the actual hit-test to the next requestAnimationFrame while only
    // capturing the pointer position up front -- if the camera moved at all
    // between the event and that later frame (e.g. residual OrbitControls
    // damping momentum still decaying after a drag), the cursor would show
    // "pointer" for a position/camera pairing that no longer matched what a
    // click moments later would resolve against, which is exactly the
    // "hover says yes, click says no" symptom this was causing.
    function handlePointerMove(e: PointerEvent) {
      const now = performance.now();
      if (now - lastHoverAt < 50) return;
      lastHoverAt = now;
      const pos = canvasPos(e);
      if (resolveCandidates(pos.x, pos.y).length > 0) {
        canvas.style.cursor = "pointer";
        return;
      }
      const s = interactionStateRef.current;
      if (s.planningMode && s.routeFlatPaths.length > 0) {
        const globeInstance = globeRef.current;
        const routeHits = globeInstance
          ? findRoutesNearScreenPoint(s.routeFlatPaths, globeInstance, pos.x, pos.y, CABLE_HIT_TOLERANCE_PX)
          : [];
        canvas.style.cursor = routeHits.length > 0 ? "pointer" : "default";
        return;
      }
      canvas.style.cursor = "default";
    }

    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointerup", handlePointerUp);
    canvas.addEventListener("pointermove", handlePointerMove);
    return () => {
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointerup", handlePointerUp);
      canvas.removeEventListener("pointermove", handlePointerMove);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // SOURCE/DESTINATION MARINE ACCESS markers -- the resolved marine
  // endpoint, which is NOT the same point as the business-location
  // PlanningMarker above (a landing point can be several/tens of km from
  // the city itself; see routing/hypotheticalRouting.ts's
  // resolveMarineEndpoint). Rendered only while routes are actually shown.
  const routeEndpointMarkers: RouteEndpointMarker[] = useMemo(() => {
    if (!hypotheticalRoutesActive || !routeEngineResult) return [];
    const markers: RouteEndpointMarker[] = [];
    const { sourceEndpoint, destinationEndpoint } = routeEngineResult;
    if (sourceEndpoint.lat != null && sourceEndpoint.lng != null) {
      markers.push({
        id: "route-endpoint-source",
        kind: "route-endpoint",
        role: "source",
        lat: sourceEndpoint.lat,
        lng: sourceEndpoint.lng,
        label: "SOURCE MARINE ACCESS",
        sublabel: sourceEndpoint.kind === "real-landing-point" ? sourceEndpoint.landingPointName! : "Modeled access point",
        real: sourceEndpoint.kind === "real-landing-point",
      });
    }
    if (destinationEndpoint.lat != null && destinationEndpoint.lng != null) {
      markers.push({
        id: "route-endpoint-destination",
        kind: "route-endpoint",
        role: "destination",
        lat: destinationEndpoint.lat,
        lng: destinationEndpoint.lng,
        label: "DESTINATION MARINE ACCESS",
        sublabel:
          destinationEndpoint.kind === "real-landing-point" ? destinationEndpoint.landingPointName! : "Modeled access point",
        real: destinationEndpoint.kind === "real-landing-point",
      });
    }
    return markers;
  }, [hypotheticalRoutesActive, routeEngineResult]);

  // Small tag near the middle of the selected candidate's own path --
  // "which line is the proposal" readable without opening the panel. The
  // path's middle INDEX (not a true distance-weighted midpoint) is a
  // deliberate simplification: these are already-simplified A* polylines
  // (see routeCandidates.ts), so vertex spacing is reasonably even and the
  // index midpoint sits close enough to the visual middle for a label
  // anchor, without needing another distance-resampling pass just for this.
  const routeLabelMarker: RouteLabelMarker | null = useMemo(() => {
    if (!hypotheticalRoutesActive || !routeEngineResult) return null;
    const rc = routeEngineResult.candidates.find((c) => c.candidate.id === selectedRouteCandidateId);
    if (!rc || rc.candidate.path.length === 0) return null;
    const [lat, lng] = rc.candidate.path[Math.floor(rc.candidate.path.length / 2)];
    return {
      id: "route-label",
      kind: "route-label",
      lat,
      lng,
      label: `PROPOSED ROUTE — ROUTE ${rc.rank} (${rc.candidate.shortName})`,
    };
  }, [hypotheticalRoutesActive, routeEngineResult, selectedRouteCandidateId]);

  const htmlMarkers: GlobeHtmlMarker[] = useMemo(
    () => [...planningMarkers, ...routeEndpointMarkers, ...(routeLabelMarker ? [routeLabelMarker] : [])],
    [planningMarkers, routeEndpointMarkers, routeLabelMarker]
  );

  // Stable function identity is required here: react-globe.gl's html-elements
  // layer treats a changed `htmlElement` prop as "the DOM template changed"
  // and wipes+rebuilds every marker on that render. An inline arrow function
  // is a new reference every render, so markers were being destroyed before
  // their DOM node ever got appended -- this is what caused markers to not
  // appear at all. useCallback keeps the reference stable across renders.
  //
  // The returned element is exactly the glyph (fixed 16x16/28x28 box, no
  // label inside it) -- three.js's CSS2DObject centers the WHOLE element's
  // bounding box on the projected geo coordinate via translate(-50%,-50%),
  // so if the label text were inside that box, the box would grow with the
  // label and the glyph (not the text) would drift off the true coordinate.
  // The label is a separate, absolutely-positioned child anchored to the
  // glyph, which doesn't affect the glyph's own bounding box. This same
  // anchoring contract is why route-endpoint/route-label markers stay
  // correctly attached to their lat/lng through rotation and zoom -- they
  // go through the identical CSS2DObject mechanism as every other marker
  // here, nothing route-specific was needed for that to hold.
  const buildPlanningMarkerElement = useCallback(
    (d: unknown) => {
      const m = d as GlobeHtmlMarker;

      if (m.kind === "route-endpoint") {
        const el = document.createElement("div");
        el.className = `route-endpoint-marker route-endpoint-marker-${m.role}`;
        el.innerHTML = `
          <div class="route-endpoint-marker-glyph"></div>
          <div class="route-endpoint-marker-label">
            <div class="route-endpoint-marker-tag">${m.label}</div>
            <div class="route-endpoint-marker-name">${escapeHtml(m.sublabel)}</div>
            <div class="route-endpoint-marker-badge ${m.real ? "real" : "modeled"}">${m.real ? "REAL LANDING POINT" : "MODELED ACCESS POINT"}</div>
          </div>
        `;
        return el;
      }

      if (m.kind === "route-label") {
        const el = document.createElement("div");
        el.className = "route-path-label";
        el.innerHTML = `<div class="route-path-label-chip">${escapeHtml(m.label)}</div>`;
        return el;
      }

      const el = document.createElement("div");
      el.className = `planning-marker planning-marker-${m.kind}`;
      el.innerHTML = `
        <div class="planning-marker-glyph"></div>
        <div class="planning-marker-label">
          <div class="planning-marker-label-text">
            ${
              m.kind === "proposed"
                ? '<div class="planning-marker-tags"><span class="planning-marker-tag">PROPOSED SITE</span><span class="planning-marker-tag planning-marker-tag-modeled">MODELED / HYPOTHETICAL</span></div>'
                : ""
            }
            <div class="planning-marker-name">${escapeHtml(m.label)}</div>
            ${m.sublabel ? `<div class="planning-marker-sub">${escapeHtml(m.sublabel)}</div>` : ""}
          </div>
          ${m.kind === "proposed" ? '<button class="planning-marker-dismiss" title="Dismiss">×</button>' : ""}
        </div>
      `;
      if (m.kind === "proposed" && onDismissProposedSite) {
        el.querySelector(".planning-marker-dismiss")?.addEventListener("click", (ev) => {
          ev.stopPropagation();
          onDismissProposedSite();
        });
      }
      return el;
    },
    [onDismissProposedSite]
  );

  return (
    <GlobeGL
      ref={globeRef}
      width={dims.width}
      height={dims.height}
      globeImageUrl="//unpkg.com/three-globe/example/img/earth-blue-marble.jpg"
      bumpImageUrl="//unpkg.com/three-globe/example/img/earth-topology.png"
      backgroundImageUrl="//unpkg.com/three-globe/example/img/night-sky.png"
      showAtmosphere
      atmosphereColor="#4fd1ff"
      atmosphereAltitude={0.22}
      // --- Submarine cable routes + hypothetical route candidates (same
      // layer, same rendering/densification pipeline -- see combinedPaths) ---
      pathsData={combinedPaths}
      pathPoints="points"
      pathPointLat={(p: unknown) => (p as [number, number])[0]}
      pathPointLng={(p: unknown) => (p as [number, number])[1]}
      pathColor={(d: unknown) => {
        const p = d as FlatPath;
        if (p.kind === "route-halo") return hexToRgba(SELECTED_ROUTE_COLOR, 0.16);
        if (p.kind === "route") {
          // The selected candidate always renders in one fixed, unmistakable
          // color (not its own candidate color) -- if it used ROUTE_COLORS
          // like the others, selecting the yellow candidate would leave it
          // looking like just another cable of the many yellow real cables
          // already on the globe. Unselected candidates keep their distinct
          // ROUTE_COLORS, muted, so they're still identifiable from the
          // panel's color-coded list without competing with the selection.
          if (p.selected) return SELECTED_ROUTE_COLOR;
          return hexToRgba(ROUTE_COLORS[p.routeId], 0.22);
        }
        if (planningMode) {
          // While hypothetical routes are on screen, real cables fade hard
          // regardless of "relevant" status -- the proposed route must never
          // have to compete with them for attention (see hypotheticalRoutesActive).
          if (hypotheticalRoutesActive) {
            return relevantCableIds.has(p.cableId) ? hexToRgba(p.color, 0.12) : hexToRgba(p.color, 0.012);
          }
          if (relevantCableIds.size > 0) {
            return relevantCableIds.has(p.cableId) ? p.color : hexToRgba(p.color, 0.025);
          }
          return hexToRgba(p.color, 0.05);
        }
        // Explore mode: an explicit selection always wins; otherwise a
        // planning-handoff scope (see explorerScope) provides a base emphasis.
        // Fades are aggressive on purpose -- the selected route must read as
        // unmistakably "the one" against 700+ other real cables.
        if (exploreSelectedCableId) {
          return p.cableId === exploreSelectedCableId ? p.color : hexToRgba(p.color, 0.045);
        }
        if (exploreRelatedCableIds) {
          return exploreRelatedCableIds.has(p.cableId) ? p.color : hexToRgba(p.color, 0.045);
        }
        if (explorerScope && explorerScope.size > 0) {
          return explorerScope.has(p.cableId) ? p.color : hexToRgba(p.color, 0.1);
        }
        return p.color;
      }}
      pathLabel={(d: unknown) => {
        const p = d as FlatPath;
        if (p.kind === "route-halo") return ""; // purely decorative, never the hover target
        if (p.kind === "route") {
          const borderColor = p.selected ? SELECTED_ROUTE_COLOR : ROUTE_COLORS[p.routeId];
          return `<div class="globe-tooltip" style="border-color:${borderColor}">
            <div class="detail-section-label" style="margin-bottom:4px">MODELED / HYPOTHETICAL -- NOT A REAL CABLE ROUTE</div>
            <div style="font-weight:600">${p.label}${p.selected ? " (selected)" : ""}</div>
            <div class="globe-tooltip-hint">click to inspect this candidate route</div>
          </div>`;
        }
        const rel = relevantCablesById.get(p.cableId);
        if (rel) {
          return `<div class="globe-tooltip" style="border-color:${p.color}">
            <div style="font-weight:600">${p.cableName}</div>
            <div class="detail-section-label" style="margin:4px 0">REAL CABLE -- ${rel.relevance.replace("-", " ").toUpperCase()}</div>
            <div class="globe-tooltip-hint">click for connectivity details</div>
          </div>`;
        }
        return `<div class="globe-tooltip"><strong>${p.cableName}</strong><br/>Submarine cable route${
          planningMode ? "" : '<div class="globe-tooltip-hint">click to inspect this cable</div>'
        }</div>`;
      }}
      pathStroke={(d: unknown) => {
        const p = d as FlatPath;
        // Halo first, then the sharp selected line drawn 2-3x thicker than
        // any real cable ever gets (max real-cable stroke elsewhere in this
        // function is 2.6, for an explicitly explore-mode-selected cable) --
        // "substantially thicker" per the visual-hierarchy requirement, not
        // just "a bit more".
        if (p.kind === "route-halo") return 7;
        if (p.kind === "route") return p.selected ? 4.2 : 0.9;
        const cableId = p.cableId;
        if (planningMode) {
          if (hypotheticalRoutesActive) return relevantCableIds.has(cableId) ? 0.5 : 0.3;
          return relevantCableIds.has(cableId) ? 1.6 : 0.6;
        }
        if (exploreSelectedCableId) return cableId === exploreSelectedCableId ? 2.6 : 0.4;
        if (exploreRelatedCableIds) return exploreRelatedCableIds.has(cableId) ? 1.8 : 0.4;
        return 0.6;
      }}
      pathDashLength={(d: unknown) => {
        const p = d as FlatPath;
        if (p.kind === "route-halo") return 1; // solid -- a halo has no direction to indicate
        if (p.kind === "route") return p.selected ? 0.05 : 0.03;
        return 0.1;
      }}
      pathDashGap={(d: unknown) => {
        const p = d as FlatPath;
        if (p.kind === "route-halo") return 0;
        if (p.kind === "route") return p.selected ? 0.025 : 0.02;
        return 0.008;
      }}
      pathDashAnimateTime={(d: unknown) => {
        const p = d as FlatPath;
        if (p.kind === "route-halo") return 0;
        if (p.kind === "route") return p.selected ? 2600 : 9000; // faster = reads as "the active one, flowing toward its destination"
        return 12000;
      }}
      pathTransitionDuration={0}
      // Route click/hover, like real-cable click/hover, is handled by our
      // own native listener below -- NOT onPathClick/built-in raycasting,
      // for the same reason cables aren't: both layers render as Line2 fat
      // lines, whose raycast hit-tolerance three-globe/three-render-objects
      // never actually configures (see cableHitTest.ts's module doc).
      // Cable click/hover is handled by our own native listener (see the
      // useEffect above) -- three-globe's built-in path raycasting has an
      // effective click tolerance of a fraction of a pixel (see
      // cableHitTest.ts) and is not wired up here at all.
      // --- Land-based DC facilities (PeeringDB) + subsea DC sites, plus real
      // cable landing points (connectivity-analysis subset in planning mode,
      // every landing point in explore mode) ---
      pointsData={pointsData}
      pointLat={(p: unknown) => (p as { data: { lat: number } }).data.lat}
      pointLng={(p: unknown) => (p as { data: { lng: number } }).data.lng}
      pointColor={(p: unknown) => {
        const item = p as { kind: string; data?: { id?: string; role?: "source" | "destination" } };
        if (item.kind === "landingPoint") {
          return item.data?.role === "destination" ? DESTINATION_LANDING_POINT_COLOR : SOURCE_LANDING_POINT_COLOR;
        }
        if (item.kind === "exploreLandingPoint") {
          const id = item.data?.id;
          if (id && exploreSelectedLandingPointId === id) return "#facc15";
          if (id && exploreSelectedCableLandingPointIds?.has(id)) return "#67e8f9";
          return hexToRgba("#94a3b8", 0.45);
        }
        const base = item.kind === "subsea" ? SUBSEA_DC_COLOR : LAND_DC_COLOR;
        return planningMode ? hexToRgba(base, 0.08) : base;
      }}
      pointAltitude={(p: unknown) => {
        const item = p as { kind: string; data?: { id?: string } };
        if (item.kind === "landingPoint") return 0.012;
        if (item.kind === "exploreLandingPoint") {
          const id = item.data?.id;
          const emphasized =
            (id && exploreSelectedLandingPointId === id) || (id && exploreSelectedCableLandingPointIds?.has(id));
          return emphasized ? 0.014 : 0.006;
        }
        return item.kind === "subsea" ? 0.018 : 0.006;
      }}
      pointRadius={(p: unknown) => {
        const item = p as { kind: string; data?: { id?: string } };
        if (item.kind === "landingPoint") return 0.55;
        if (item.kind === "exploreLandingPoint") {
          const id = item.data?.id;
          if (id && exploreSelectedLandingPointId === id) return 0.7;
          if (id && exploreSelectedCableLandingPointIds?.has(id)) return 0.48;
          return 0.28;
        }
        return item.kind === "subsea" ? 0.85 : 0.42;
      }}
      pointResolution={8}
      pointLabel={(p: unknown) => {
        const point = p as
          | Selection
          | { kind: "landingPoint"; data: ConnectivityLandingPointDatum }
          | { kind: "exploreLandingPoint"; data: LandingPoint };
        if (point.kind === "exploreLandingPoint") {
          const lp = point.data;
          return `<div class="globe-tooltip">
            <div style="font-weight:600">${lp.name}</div>
            <div class="detail-section-label" style="margin:4px 0">REAL LANDING POINT</div>
            <div class="globe-tooltip-hint">click for connected cable systems</div>
          </div>`;
        }
        if (point.kind === "landingPoint") {
          const lp = point.data;
          const color = lp.role === "destination" ? DESTINATION_LANDING_POINT_COLOR : SOURCE_LANDING_POINT_COLOR;
          return `<div class="globe-tooltip" style="border-color:${color}">
            <div style="font-weight:600;color:${color}">${lp.name}</div>
            <div class="detail-section-label" style="margin:4px 0">REAL LANDING POINT</div>
            <div>${lp.distanceFromQueryKm.toFixed(1)} km from ${lp.role === "destination" ? "destination" : "proposed site"}</div>
            <div class="globe-tooltip-hint">click for connectivity details</div>
          </div>`;
        }
        if (point.kind === "subsea") {
          const dc = point.data as SubseaDC;
          return `
            <div class="globe-tooltip" style="border-color:${SUBSEA_DC_COLOR}">
              <div style="font-weight:600;color:${SUBSEA_DC_COLOR}">\u{1F30A} ${dc.name}</div>
              <div>${dc.operator}</div>
              <div>Depth: ${dc.depth_m} m &middot; Status: ${dc.status}</div>
              ${dc.capacity_mw ? `<div>Capacity: ${dc.capacity_mw} MW</div>` : ""}
              ${
                dc.nearestLandingPoint
                  ? `<div>Nearest landing: ${dc.nearestLandingPoint.name} (${dc.nearestLandingPointDistanceKm} km)</div>`
                  : ""
              }
              ${
                dc.coordinate_precision !== "exact"
                  ? `<div style="color:#f59e0b;font-style:italic;margin-top:4px">⚠ coordinates approximate</div>`
                  : ""
              }
              <div class="globe-tooltip-hint">click for full details</div>
            </div>`;
        }
        const dc = point.data as LandDC;
        return `
          <div class="globe-tooltip" style="border-color:${LAND_DC_COLOR}">
            <div style="font-weight:600;color:${LAND_DC_COLOR}">${dc.name}</div>
            <div>${dc.org}</div>
            <div>${dc.city}, ${dc.country}</div>
            <div class="globe-tooltip-hint">click for full details</div>
          </div>`;
      }}
      onPointClick={(p: unknown) => {
        const item = p as { kind: string; data: unknown };
        if (item.kind === "landingPoint") {
          onSelectConnectivityItem?.({ kind: "landingPoint", data: item.data as ConnectivityLandingPointDatum });
          return;
        }
        if (item.kind === "exploreLandingPoint") {
          onSelectNetworkItem?.({ kind: "landingPoint", landingPointId: (item.data as LandingPoint).id });
          return;
        }
        onSelect(p as Selection);
      }}
      onPointHover={(p: unknown) => {
        const canvas = globeRef.current?.renderer().domElement;
        if (canvas) canvas.style.cursor = p ? "pointer" : "default";
      }}
      // --- Connector lines: subsea DC -> nearest cable landing point, plus the
      // planning-mode "connectivity requirement" line (never a real cable) ---
      arcsData={arcsData}
      arcsTransitionDuration={0}
      arcStartLat="startLat"
      arcStartLng="startLng"
      arcEndLat="endLat"
      arcEndLng="endLng"
      arcColor={(d: unknown) => {
        const a = d as ArcDatum;
        if (a.kind === "planning") return hexToRgba(PLANNING_LINE_COLOR, 0.35);
        return planningMode ? hexToRgba(CONNECTOR_COLOR, 0.06) : CONNECTOR_COLOR;
      }}
      // The planning line spans whatever the user's two cities happen to be
      // -- anywhere from a few hundred to over ten thousand km. A fixed
      // altitude (the old 0.12) is tuned for short hops; for a long route it
      // sits too low relative to the great-circle distance, so part of the
      // arc dips behind the globe's own curvature depending on camera angle
      // and reads as an incomplete/partial line. `null` here defers to
      // three-globe's own distance-proportional auto-scale instead, so the
      // arc always clears the horizon regardless of how far apart the two
      // points are.
      arcAltitude={(d: unknown) => ((d as ArcDatum).kind === "planning" ? null : 0.06)}
      arcAltitudeAutoScale={(d: unknown) => ((d as ArcDatum).kind === "planning" ? 0.35 : 0.5)}
      arcStroke={(d: unknown) => ((d as ArcDatum).kind === "planning" ? 0.35 : 0.6)}
      // Dash length/gap are fractions of the ARC'S TOTAL LENGTH, not a fixed
      // pixel pattern -- the old 0.25/0.18 produced only ~2 dash-gap cycles
      // across the whole line, which reads as two disconnected fragments
      // rather than one line, especially caught mid-animation. A denser
      // pattern (many small dashes) reads unambiguously as a single
      // continuous dashed connection, matching the dashed-border convention
      // used elsewhere in the app for modeled/hypothetical elements.
      arcDashLength={(d: unknown) => ((d as ArcDatum).kind === "planning" ? 0.06 : 0.4)}
      arcDashGap={(d: unknown) => ((d as ArcDatum).kind === "planning" ? 0.03 : 0.15)}
      arcDashAnimateTime={(d: unknown) => ((d as ArcDatum).kind === "planning" ? 4000 : 2500)}
      arcLabel={(d: unknown) =>
        `<div class="globe-tooltip" style="border-color:${PLANNING_LINE_COLOR}">${(d as ArcDatum).label}</div>`
      }
      // --- Planning-mode markers: location / destination / proposed site,
      // plus (while a route is shown) SOURCE/DESTINATION MARINE ACCESS
      // endpoint markers and the selected route's floating label. Rendered
      // as real DOM elements (not the WebGL point layer above) so they can
      // never be visually confused with real facility markers. ---
      htmlElementsData={htmlMarkers}
      htmlLat={(d: unknown) => (d as GlobeHtmlMarker).lat}
      htmlLng={(d: unknown) => (d as GlobeHtmlMarker).lng}
      htmlAltitude={0}
      htmlElement={buildPlanningMarkerElement}
    />
  );
});

export default Globe;
