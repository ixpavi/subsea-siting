import { useEffect, useMemo, useRef, useState } from "react";
import Globe from "./Globe";
import type { GlobeApi, PlanningMarker, ConnectivitySelection } from "./Globe";
import Legend from "./Legend";
import DetailPanel from "./DetailPanel";
import PlanningPanel from "./design/PlanningPanel";
import ConnectivityInspector from "./design/ConnectivityInspector";
import NetworkSearch from "./explore/NetworkSearch";
import CableDirectory from "./explore/CableDirectory";
import NetworkInspector from "./explore/NetworkInspector";
import CableChooser from "./explore/CableChooser";
import { COOLING_SPECS, TIER_SPECS } from "./calculator/facilityCalculator";
import type { DesignResult, LocationRequirement } from "./design/designTypes";
import { analyzeConnectivity } from "./design/connectivityAnalysis";
import type { RouteEngineResult, RoutingProfileId } from "./routing/routingTypes";
import { buildCableNetworkIndex, getCableDetail } from "./cableNetwork";
import { frameForPoints, sphericalCentroid, angularDistanceDeg } from "./cameraFraming";
import type { NetworkSelection } from "./cableNetwork";
import type { CableHitCandidate } from "./cableHitTest";
import type { CableFeature, LandDC, SubseaDC, LandingPoint, LayerToggles, Selection } from "./types";
import "./App.css";

async function fetchJSON<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return res.json();
}

export default function App() {
  const [cables, setCables] = useState<CableFeature[]>([]);
  const [landDCs, setLandDCs] = useState<LandDC[]>([]);
  const [subseaDCs, setSubseaDCs] = useState<SubseaDC[]>([]);
  const [landingPoints, setLandingPoints] = useState<LandingPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [rotating, setRotating] = useState(true);
  const [toggles, setToggles] = useState<LayerToggles>({
    cables: true,
    landDCs: true,
    subseaDCs: true,
    connectors: true,
    landingPoints: true,
  });

  const globeApiRef = useRef<GlobeApi>(null);
  const [planningMode, setPlanningMode] = useState(false);
  const [planningLocation, setPlanningLocation] = useState<LocationRequirement | null>(null);
  const [planningDestination, setPlanningDestination] = useState<LocationRequirement | null>(null);
  const [planningResult, setPlanningResult] = useState<DesignResult | null>(null);
  const [connectivitySelection, setConnectivitySelection] = useState<ConnectivitySelection | null>(null);
  const [routeEngineResult, setRouteEngineResult] = useState<RouteEngineResult | null>(null);
  const [selectedRouteCandidateId, setSelectedRouteCandidateId] = useState<RoutingProfileId | null>(null);

  // Explore-mode cable explorer state -- independent of Planning Mode.
  const [networkSelection, setNetworkSelection] = useState<NetworkSelection | null>(null);
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [explorerScope, setExplorerScope] = useState<Set<string> | null>(null);
  const [cableChoices, setCableChoices] = useState<CableHitCandidate[] | null>(null);

  useEffect(() => {
    Promise.all([
      fetchJSON<CableFeature[]>("/data/cables.json"),
      fetchJSON<LandDC[]>("/data/land-dcs.json"),
      fetchJSON<SubseaDC[]>("/data/subsea-dcs.json"),
      fetchJSON<LandingPoint[]>("/data/landing-points.json"),
    ])
      .then(([c, l, s, lp]) => {
        setCables(c);
        setLandDCs(l);
        setSubseaDCs(s);
        setLandingPoints(lp);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  function focusCamera(loc: LocationRequirement | null, dest: LocationRequirement | null) {
    const api = globeApiRef.current;
    if (!api) return;
    const hasLoc = loc?.lat != null && loc.lng != null;
    const hasDest = dest?.lat != null && dest.lng != null;
    if (hasLoc && hasDest) {
      // Same antimeridian trap as focusOnPoints: averaging the two longitudes
      // sends a Tokyo-Los Angeles plan to the Atlantic. Centre comes from the
      // vector mean; the altitude tuning here is deliberately wider than
      // frameForPoints' so both endpoints sit comfortably in view.
      const centre = sphericalCentroid([
        [loc!.lat!, loc!.lng!],
        [dest!.lat!, dest!.lng!],
      ]);
      const dist = angularDistanceDeg(loc!.lat!, loc!.lng!, dest!.lat!, dest!.lng!);
      const altitude = Math.min(3.2, Math.max(1.8, dist / 16));
      if (centre) api.flyTo(centre.lat, centre.lng, altitude);
    } else if (hasLoc) {
      api.flyTo(loc!.lat!, loc!.lng!, 1.3);
    } else if (hasDest) {
      api.flyTo(dest!.lat!, dest!.lng!, 1.3);
    }
  }

  // Cable/landing-point join over the real datasets -- built once per data
  // load, reused by search, the directory, the inspector, and Globe's
  // explore-mode highlighting (see cableNetwork.ts).
  const cableNetworkIndex = useMemo(() => buildCableNetworkIndex(cables, landingPoints), [cables, landingPoints]);

  /** Frames the camera on a route's full stored geometry -- generous enough that
   *  the route doesn't disappear around the globe's curve, without zooming so far
   *  out the highlight is imperceptible. Geometry lives in cameraFraming.ts so
   *  the antimeridian handling is directly testable. */
  function focusOnPoints(points: [number, number][]) {
    const api = globeApiRef.current;
    if (!api) return;
    const framing = frameForPoints(points);
    if (!framing) return;
    api.flyTo(framing.lat, framing.lng, framing.altitude);
  }

  function handleSelectNetworkItem(sel: NetworkSelection) {
    setSelected(null);
    setDirectoryOpen(false);
    setCableChoices(null);
    setRotating(false);
    setNetworkSelection(sel);
    if (sel.kind === "cable") {
      const detail = getCableDetail(sel.cableId, cableNetworkIndex);
      if (detail) focusOnPoints(detail.paths.flat());
    } else {
      const lp = cableNetworkIndex.landingPointsById.get(sel.landingPointId);
      if (lp) globeApiRef.current?.flyTo(lp.lat, lp.lng, 1.3);
    }
  }

  function handleSelectFacility(sel: Selection | null) {
    setNetworkSelection(null);
    setSelected(sel);
  }

  /** Multiple real cables genuinely overlapped the click's tolerance zone -- let the user pick, never guess. See cableHitTest.ts. */
  function handleAmbiguousCableClick(candidates: CableHitCandidate[]) {
    setDirectoryOpen(false);
    setCableChoices(candidates);
  }

  function handleChooseCable(cableId: string) {
    setCableChoices(null);
    if (planningMode) {
      const rel = connectivityAnalysis?.relevantCables.find((c) => c.id === cableId);
      if (rel) setConnectivitySelection({ kind: "cable", data: rel });
    } else {
      handleSelectNetworkItem({ kind: "cable", cableId });
    }
  }

  /** Hands off from Planning Mode's connectivity analysis into the explore-mode cable explorer, emphasizing the analyzed cables instead of re-implementing the explorer inside the planning panel. */
  function handleExploreCables(cableIds: string[]) {
    setPlanningMode(false);
    setPlanningLocation(null);
    setPlanningDestination(null);
    setPlanningResult(null);
    setConnectivitySelection(null);
    setRouteEngineResult(null);
    setSelectedRouteCandidateId(null);
    setNetworkSelection(null);
    setCableChoices(null);
    setExplorerScope(new Set(cableIds));
    setRotating(false);
  }

  const planningMarkers: PlanningMarker[] = useMemo(() => {
    const markers: PlanningMarker[] = [];
    const hasLoc = planningLocation?.lat != null && planningLocation.lng != null;
    const hasDest = planningDestination?.lat != null && planningDestination.lng != null;

    if (hasLoc && planningResult) {
      const c = planningResult.top.config;
      markers.push({
        id: "proposed",
        kind: "proposed",
        lat: planningLocation!.lat!,
        lng: planningLocation!.lng!,
        label: planningLocation!.name ?? planningLocation!.query,
        sublabel: `${TIER_SPECS[c.tier].label} · ${c.redundancy} · ${COOLING_SPECS[c.cooling].label}`,
      });
    } else if (hasLoc) {
      markers.push({
        id: "location",
        kind: "location",
        lat: planningLocation!.lat!,
        lng: planningLocation!.lng!,
        label: planningLocation!.name ?? planningLocation!.query,
      });
    }

    if (hasDest) {
      markers.push({
        id: "destination",
        kind: "destination",
        lat: planningDestination!.lat!,
        lng: planningDestination!.lng!,
        label: planningDestination!.name ?? planningDestination!.query,
      });
    }

    return markers;
  }, [planningLocation, planningDestination, planningResult]);

  const planningConnectivity = useMemo(() => {
    if (
      planningLocation?.lat != null &&
      planningLocation.lng != null &&
      planningDestination?.lat != null &&
      planningDestination.lng != null
    ) {
      return {
        lat1: planningLocation.lat,
        lng1: planningLocation.lng,
        lat2: planningDestination.lat,
        lng2: planningDestination.lng,
      };
    }
    return null;
  }, [planningLocation, planningDestination]);

  // Real-data connectivity analysis: recomputed whenever the proposed site or
  // connectivity destination resolves to coordinates. Needs only the source
  // (destination is optional) -- see design/connectivityAnalysis.ts.
  // Coordinates are narrowed to plain numbers BEFORE the memo rather than
  // inside it. Semantically identical, but it removes the non-null assertions
  // the React Compiler could not see through -- it was bailing out of this
  // memo ("existing memoization could not be preserved"), and this is the one
  // memo in the app that must not be lost: analyzeConnectivity merges 724
  // cable systems and geometrically joins them against 1,920 landing points.
  const srcLat = planningMode ? planningLocation?.lat ?? null : null;
  const srcLng = planningMode ? planningLocation?.lng ?? null : null;
  const dstLat = planningMode ? planningDestination?.lat ?? null : null;
  const dstLng = planningMode ? planningDestination?.lng ?? null : null;

  const connectivityAnalysis = useMemo(() => {
    if (srcLat == null || srcLng == null) return null;
    const destination = dstLat != null && dstLng != null ? { lat: dstLat, lng: dstLng } : null;
    return analyzeConnectivity({ lat: srcLat, lng: srcLng }, destination, cables, landingPoints);
  }, [srcLat, srcLng, dstLat, dstLng, cables, landingPoints]);

  return (
    <div className="app-root">
      <header className="title-bar">
        <h1>Subsea Cable &amp; Data Centre Planning Globe</h1>
        <p>
          {cables.length.toLocaleString()} cable routes · {landDCs.length.toLocaleString()} land
          facilities (PeeringDB) · {subseaDCs.length} subsea DC sites
        </p>
      </header>

      {loading && <div className="loading-overlay">Loading globe data…</div>}
      {error && <div className="error-overlay">{error}</div>}

      {!loading && !error && (
        <>
          <Globe
            ref={globeApiRef}
            cables={cables}
            landDCs={landDCs}
            subseaDCs={subseaDCs}
            toggles={toggles}
            rotating={rotating}
            onUserInteracted={() => setRotating(false)}
            onSelect={handleSelectFacility}
            planningMode={planningMode}
            planningMarkers={planningMarkers}
            planningConnectivity={planningConnectivity}
            onDismissProposedSite={() => setPlanningResult(null)}
            routeEngineResult={routeEngineResult}
            selectedRouteCandidateId={selectedRouteCandidateId}
            onSelectRouteCandidate={setSelectedRouteCandidateId}
            connectivityAnalysis={connectivityAnalysis}
            onSelectConnectivityItem={setConnectivitySelection}
            landingPoints={landingPoints}
            cableNetworkIndex={cableNetworkIndex}
            networkSelection={networkSelection}
            onSelectNetworkItem={handleSelectNetworkItem}
            explorerScope={explorerScope}
            onAmbiguousCableClick={handleAmbiguousCableClick}
          />
          {!planningMode && (
            <NetworkSearch
              index={cableNetworkIndex}
              onSelectCable={(id) => handleSelectNetworkItem({ kind: "cable", cableId: id })}
              onSelectLandingPoint={(id) => handleSelectNetworkItem({ kind: "landingPoint", landingPointId: id })}
            />
          )}
          {!planningMode && (
            <div className="top-toolbar">
              <button
                className="toolbar-btn"
                onClick={() => setRotating((r) => !r)}
                title={rotating ? "Pause rotation" : "Resume rotation"}
                aria-label={rotating ? "Pause rotation" : "Resume rotation"}
              >
                {rotating ? "⏸" : "▶"}
              </button>
              <button
                className={`toolbar-btn ${directoryOpen ? "active" : ""}`}
                onClick={() => setDirectoryOpen((v) => !v)}
                title="Browse the full cable directory"
              >
                Directory
              </button>
              <button
                className="design-launch-btn"
                onClick={() => {
                  setSelected(null);
                  setNetworkSelection(null);
                  setExplorerScope(null);
                  setDirectoryOpen(false);
                  setCableChoices(null);
                  setRotating(false);
                  setPlanningMode(true);
                }}
              >
                Design a Data Centre
              </button>
            </div>
          )}

          {!planningMode && (
            <Legend
              toggles={toggles}
              onChange={setToggles}
              counts={{
                cables: cables.length,
                landDCs: landDCs.length,
                subseaDCs: subseaDCs.length,
                landingPoints: landingPoints.length,
              }}
            />
          )}
          {!planningMode && selected && <DetailPanel selection={selected} onClose={() => setSelected(null)} />}

          {cableChoices && (
            <CableChooser candidates={cableChoices} onChoose={handleChooseCable} onClose={() => setCableChoices(null)} />
          )}

          {!planningMode && !cableChoices && directoryOpen && (
            <CableDirectory
              index={cableNetworkIndex}
              onSelectCable={(id) => handleSelectNetworkItem({ kind: "cable", cableId: id })}
              onClose={() => setDirectoryOpen(false)}
            />
          )}
          {!planningMode && !cableChoices && !directoryOpen && networkSelection && (
            <NetworkInspector
              selection={networkSelection}
              index={cableNetworkIndex}
              onSelectCable={(id) => handleSelectNetworkItem({ kind: "cable", cableId: id })}
              onSelectLandingPoint={(id) => handleSelectNetworkItem({ kind: "landingPoint", landingPointId: id })}
              onClose={() => {
                setNetworkSelection(null);
                setExplorerScope(null);
              }}
            />
          )}

          {planningMode && !cableChoices && connectivitySelection && (
            <ConnectivityInspector selection={connectivitySelection} onClose={() => setConnectivitySelection(null)} />
          )}

          {planningMode && (
            <PlanningPanel
              connectivityAnalysis={connectivityAnalysis}
              onExploreCables={handleExploreCables}
              routeResult={routeEngineResult}
              selectedRouteCandidateId={selectedRouteCandidateId}
              onSelectRouteCandidate={setSelectedRouteCandidateId}
              onRouteResult={setRouteEngineResult}
              onClose={() => {
                setPlanningMode(false);
                setPlanningLocation(null);
                setPlanningDestination(null);
                setPlanningResult(null);
                setConnectivitySelection(null);
                setRouteEngineResult(null);
                setSelectedRouteCandidateId(null);
              }}
              onLocationResolved={(loc) => {
                setPlanningLocation(loc);
                focusCamera(loc, planningDestination);
              }}
              onDestinationResolved={(dest) => {
                setPlanningDestination(dest);
                focusCamera(planningLocation, dest);
              }}
              onResult={(result) => {
                setPlanningResult(result);
                focusCamera(planningLocation, planningDestination);
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
