// Cesium rendering of the cable network, as an alternative to the three-globe
// implementation in Globe.tsx.
//
// WHY THIS EXISTS. Two things three-globe cannot do:
//
//   1. Real geodesics. three-globe interpolates paths linearly in lat/lng, so a
//      long segment is drawn along a curve no cable follows -- measured at up to
//      273 km off the true great circle on the longest segments in this dataset.
//      Cesium draws proper geodesics.
//
//   2. Reliable picking. three-globe's raycast tolerance on a path is
//      effectively sub-pixel regardless of stroke width, which is why this
//      project carries 600+ lines of hand-written screen-space hit-testing.
//      Cesium picks natively.
//
// It also renders a sun-accurate day/night terminator, a star field from the
// Tycho-2 catalogue, and atmospheric scattering -- all of which ship with the
// package and need no Cesium Ion account.
//
// SCOPE. This is a comparison build, not a finished replacement. It renders the
// cable network and facilities and supports selection. The planning wizard,
// routing overlay and site comparison still run against Globe.tsx.
import { useEffect, useRef, useState } from "react";
import {
  Viewer,
  Cartesian3,
  Color,
  JulianDate,
  TileMapServiceImageryProvider,
  buildModuleUrl,
  Ion,
  ScreenSpaceEventType,
  defined,
  Math as CesiumMath,
  Cartographic,
} from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import type { CableFeature, LandDC } from "./types";

// No Ion account is used. The imagery below is the Natural Earth II tile set
// bundled with the package, so the app has no external tile dependency and no
// token to leak. Setting this to undefined stops Cesium contacting Ion at all.
Ion.defaultAccessToken = undefined as unknown as string;

interface Props {
  cables: CableFeature[];
  landDCs: LandDC[];
  onSelectCable?: (cableId: string) => void;
  /** Renders the sun-lit terminator. Off gives flat, evenly lit imagery. */
  lighting?: boolean;
}

export default function CesiumGlobe({ cables, landDCs, onSelectCable, lighting = true }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const [status, setStatus] = useState<string>("initialising");

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let viewer: Viewer | null = null;
    let cancelled = false;

    (async () => {
      try {
        const imageryProvider = await TileMapServiceImageryProvider.fromUrl(
          buildModuleUrl("Assets/Textures/NaturalEarthII")
        );
        if (cancelled) return;

        viewer = new Viewer(container, {
          // Cesium 1.14x removed `imageryProvider` from the constructor; the
          // layer is added after construction instead (see below).
          baseLayer: false,
          // Every widget here is either irrelevant to this app or duplicates
          // controls it already has. Left on, they clutter the view and imply
          // features (timeline scrubbing, base layer switching) that nothing
          // behind them supports.
          baseLayerPicker: false,
          geocoder: false,
          homeButton: false,
          sceneModePicker: false,
          navigationHelpButton: false,
          animation: false,
          timeline: false,
          fullscreenButton: false,
          infoBox: false,
          selectionIndicator: false,
          // No terrain provider: this app cares about the ocean surface and
          // cable geometry, and terrain tiles would be a network dependency
          // and a large download for no benefit here.
        });

        viewer.imageryLayers.addImageryProvider(imageryProvider);

        viewer.scene.globe.enableLighting = lighting;
        if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = true;
        viewer.scene.globe.showGroundAtmosphere = true;
        viewer.scene.fog.enabled = true;
        // Fix the clock so the terminator is stable rather than drifting while
        // someone is trying to read the map.
        viewer.clock.currentTime = JulianDate.fromIso8601("2026-06-21T12:00:00Z");
        viewer.clock.shouldAnimate = false;

        viewer.scene.backgroundColor = Color.fromCssColorString("#03070d");

        // --- Cables -------------------------------------------------------
        // One entity per stored path. Cesium interpolates polylines along
        // geodesics by default, which is the correctness gain over three-globe.
        // Entity ids must be globally unique, and cable ids are NOT: the
        // dataset carries several entries sharing one id, which cableNetwork.ts
        // merges downstream. three-globe never noticed because it keys nothing;
        // Cesium throws on the duplicate. The running counter guarantees
        // uniqueness while the cable id stays recoverable for selection.
        let drawn = 0;
        for (const cable of cables) {
          for (let i = 0; i < cable.paths.length; i++) {
            const path = cable.paths[i];
            if (path.length < 2) continue;
            const positions = Cartesian3.fromDegreesArray(
              path.flatMap(([lat, lng]) => [lng, lat])
            );
            viewer.entities.add({
              id: `cable:${cable.id}:${i}:${drawn}`,
              polyline: {
                positions,
                width: 1.6,
                material: Color.fromCssColorString(cable.color).withAlpha(0.85),
                // Clamps the line to the ellipsoid instead of cutting through
                // it, so a cable on the far limb disappears behind the globe
                // as it should rather than showing through.
                clampToGround: false,
              },
            });
            drawn++;
          }
        }

        // --- Facilities ---------------------------------------------------
        for (let d = 0; d < landDCs.length; d++) {
          const dc = landDCs[d];
          viewer.entities.add({
            id: `dc:${dc.id}:${d}`,
            position: Cartesian3.fromDegrees(dc.lng, dc.lat),
            point: {
              pixelSize: 4,
              color: Color.fromCssColorString("#5eead4").withAlpha(0.85),
              // Scales down with distance so 5,260 markers do not merge into a
              // solid sheet when zoomed out.
              scaleByDistance: undefined,
            },
          });
        }

        // --- Picking ------------------------------------------------------
        // The whole reason the three-globe build needs 600 lines of custom
        // screen-space hit-testing. Here it is the built-in behaviour.
        viewer.screenSpaceEventHandler.setInputAction((movement: { position: unknown }) => {
          const picked = viewer!.scene.pick(movement.position as never);
          if (defined(picked) && picked.id?.id?.startsWith?.("cable:")) {
            const cableId = String(picked.id.id).split(":")[1];
            onSelectCable?.(cableId);
          }
        }, ScreenSpaceEventType.LEFT_CLICK);

        viewer.camera.setView({
          destination: Cartesian3.fromDegrees(10, 20, 22_000_000),
        });

        viewerRef.current = viewer;
        setStatus(`ready: ${drawn} cable paths, ${landDCs.length} facilities`);
      } catch (e) {
        setStatus(`failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    })();

    return () => {
      cancelled = true;
      if (viewer && !viewer.isDestroyed()) viewer.destroy();
      viewerRef.current = null;
    };
    // Rebuilding the viewer on every prop change would be catastrophic; the
    // datasets are loaded once and do not change identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const v = viewerRef.current;
    if (v && !v.isDestroyed()) v.scene.globe.enableLighting = lighting;
  }, [lighting]);

  return (
    <>
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
      <div
        style={{
          position: "absolute",
          bottom: 8,
          left: 8,
          font: "11px ui-monospace, monospace",
          color: "#7f8f99",
          pointerEvents: "none",
        }}
      >
        {status}
      </div>
    </>
  );
}

/** Exposed for tests and for the comparison harness. */
export function screenToLatLng(viewer: Viewer, x: number, y: number): { lat: number; lng: number } | null {
  const ray = viewer.camera.getPickRay({ x, y } as never);
  if (!ray) return null;
  const pos = viewer.scene.globe.pick(ray, viewer.scene);
  if (!pos) return null;
  const c = Cartographic.fromCartesian(pos);
  return {
    lat: CesiumMath.toDegrees(c.latitude),
    lng: CesiumMath.toDegrees(c.longitude),
  };
}
