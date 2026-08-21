import { useEffect, useMemo, useRef } from "react";
import GlobeGL from "react-globe.gl";
import type { GlobeMethods } from "react-globe.gl";
import type { CableFeature, LandDC, SubseaDC, LayerToggles, Selection } from "./types";

const LAND_DC_COLOR = "#5eead4";
const SUBSEA_DC_COLOR = "#fb923c";
const CONNECTOR_COLOR = "#fbbf24";

interface FlatPath {
  cableId: string;
  cableName: string;
  color: string;
  points: [number, number][];
}

interface Props {
  cables: CableFeature[];
  landDCs: LandDC[];
  subseaDCs: SubseaDC[];
  toggles: LayerToggles;
  rotating: boolean;
  onUserInteracted: () => void;
  onSelect: (sel: Selection | null) => void;
}

export default function Globe({
  cables,
  landDCs,
  subseaDCs,
  toggles,
  rotating,
  onUserInteracted,
  onSelect,
}: Props) {
  const globeRef = useRef<GlobeMethods | undefined>(undefined);

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

  const flatCablePaths: FlatPath[] = useMemo(
    () =>
      cables.flatMap((c) =>
        c.paths.map((points) => ({
          cableId: c.id,
          cableName: c.name,
          color: c.color,
          points,
        }))
      ),
    [cables]
  );

  const connectorArcs = useMemo(
    () =>
      subseaDCs
        .filter((dc) => dc.nearestLandingPoint)
        .map((dc) => ({
          startLat: dc.lat,
          startLng: dc.lng,
          endLat: dc.nearestLandingPoint!.lat,
          endLng: dc.nearestLandingPoint!.lng,
          label: `${dc.name} → ${dc.nearestLandingPoint!.name} (${dc.nearestLandingPointDistanceKm} km)`,
        })),
    [subseaDCs]
  );

  return (
    <GlobeGL
      ref={globeRef}
      globeImageUrl="//unpkg.com/three-globe/example/img/earth-blue-marble.jpg"
      bumpImageUrl="//unpkg.com/three-globe/example/img/earth-topology.png"
      backgroundImageUrl="//unpkg.com/three-globe/example/img/night-sky.png"
      showAtmosphere
      atmosphereColor="#4fd1ff"
      atmosphereAltitude={0.22}
      // --- Submarine cable routes ---
      pathsData={toggles.cables ? flatCablePaths : []}
      pathPoints="points"
      pathPointLat={(p: unknown) => (p as [number, number])[0]}
      pathPointLng={(p: unknown) => (p as [number, number])[1]}
      pathColor={(d: unknown) => (d as FlatPath).color}
      pathLabel={(d: unknown) => {
        const p = d as FlatPath;
        return `<div class="globe-tooltip"><strong>${p.cableName}</strong><br/>Submarine cable route</div>`;
      }}
      pathStroke={0.6}
      pathDashLength={0.1}
      pathDashGap={0.008}
      pathDashAnimateTime={12000}
      pathTransitionDuration={0}
      // --- Land-based DC facilities (PeeringDB) + subsea DC sites ---
      pointsData={[
        ...(toggles.landDCs
          ? landDCs.map((d) => ({ kind: "land" as const, data: d }))
          : []),
        ...(toggles.subseaDCs
          ? subseaDCs.map((d) => ({ kind: "subsea" as const, data: d }))
          : []),
      ]}
      pointLat={(p: unknown) => (p as { data: { lat: number } }).data.lat}
      pointLng={(p: unknown) => (p as { data: { lng: number } }).data.lng}
      pointColor={(p: unknown) =>
        (p as { kind: string }).kind === "subsea" ? SUBSEA_DC_COLOR : LAND_DC_COLOR
      }
      pointAltitude={(p: unknown) => ((p as { kind: string }).kind === "subsea" ? 0.018 : 0.006)}
      pointRadius={(p: unknown) => ((p as { kind: string }).kind === "subsea" ? 0.85 : 0.42)}
      pointResolution={8}
      pointLabel={(p: unknown) => {
        const point = p as Selection;
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
      onPointClick={(p: unknown) => onSelect(p as Selection)}
      onPointHover={(p: unknown) => {
        const canvas = globeRef.current?.renderer().domElement;
        if (canvas) canvas.style.cursor = p ? "pointer" : "grab";
      }}
      // --- Connector lines: subsea DC -> nearest cable landing point ---
      arcsData={toggles.connectors && toggles.subseaDCs ? connectorArcs : []}
      arcStartLat="startLat"
      arcStartLng="startLng"
      arcEndLat="endLat"
      arcEndLng="endLng"
      arcColor={() => CONNECTOR_COLOR}
      arcAltitude={0.06}
      arcStroke={0.6}
      arcDashLength={0.4}
      arcDashGap={0.15}
      arcDashAnimateTime={2500}
      arcLabel={(d: unknown) =>
        `<div class="globe-tooltip" style="border-color:${CONNECTOR_COLOR}">${(d as { label: string }).label}</div>`
      }
    />
  );
}
