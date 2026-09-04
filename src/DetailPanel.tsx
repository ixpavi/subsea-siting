import { useEffect, useState } from "react";
import type { Selection } from "./types";
import CalculatorPanel from "./calculator/CalculatorPanel";
import { estimateRouteRisk } from "./calculator/environmentalRisk";
import { assessEnvironmentalWithGrid, loadProtectedAreas } from "./routing/protectedAreas";
import type { EnvironmentalAssessment } from "./routing/routingTypes";
import CloseButton from "./CloseButton";

/**
 * Sample the great circle between two points at roughly 5 km, which is finer
 * than the protected-area grid's ~11 km cell so no cell the route crosses can
 * be stepped over.
 */
function densifyGreatCircle(a: [number, number], b: [number, number]): [number, number][] {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const [lat1, lng1] = a.map(toRad) as [number, number];
  const [lat2, lng2] = b.map(toRad) as [number, number];

  const d =
    2 *
    Math.asin(
      Math.sqrt(
        Math.sin((lat2 - lat1) / 2) ** 2 +
          Math.cos(lat1) * Math.cos(lat2) * Math.sin((lng2 - lng1) / 2) ** 2
      )
    );
  if (d === 0) return [a, b];

  const steps = Math.max(2, Math.ceil((d * 6371) / 5));
  const out: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(lat1) * Math.cos(lng1) + B * Math.cos(lat2) * Math.cos(lng2);
    const y = A * Math.cos(lat1) * Math.sin(lng1) + B * Math.cos(lat2) * Math.sin(lng2);
    const z = A * Math.sin(lat1) + B * Math.sin(lat2);
    out.push([toDeg(Math.atan2(z, Math.hypot(x, y))), toDeg(Math.atan2(y, x))]);
  }
  return out;
}

export default function DetailPanel({ selection, onClose }: { selection: Selection; onClose: () => void }) {
  const [configuring, setConfiguring] = useState(false);

  // Measured protected-area exposure for a subsea site's route to its nearest
  // landing point. Loaded lazily because the grid is only needed on this
  // panel, and left null outside the grid's extent -- estimateRouteRisk then
  // falls back to its heuristic and says so.
  const subsea = selection.kind === "subsea" ? selection.data : null;
  const lp = subsea?.nearestLandingPoint ?? null;
  // Keyed by the route it describes, so selecting a different site invalidates
  // it during render instead of through a setState inside the effect -- which
  // would otherwise show one site's exposure against another's for a frame.
  const routeKey = subsea && lp ? `${subsea.lat},${subsea.lng}->${lp.lat},${lp.lng}` : null;
  const [mpa, setMpa] = useState<{ key: string; value: EnvironmentalAssessment | null } | null>(null);
  const mpaExposure = routeKey && mpa?.key === routeKey ? mpa.value : null;

  useEffect(() => {
    if (!routeKey || !subsea || !lp) return;
    let cancelled = false;
    loadProtectedAreas()
      .then((grid) => {
        if (cancelled) return;
        // The straight line between the site and its landing point. A real
        // cable would not be straight, but this is the corridor the exposure
        // question is about, and densifying it is what the grid samples.
        const path = densifyGreatCircle([subsea.lat, subsea.lng], [lp.lat, lp.lng]);
        setMpa({ key: routeKey, value: assessEnvironmentalWithGrid(path, grid) });
      })
      .catch(() => {
        if (!cancelled) setMpa({ key: routeKey, value: null });
      });
    return () => {
      cancelled = true;
    };
  }, [routeKey, subsea, lp]);

  if (selection.kind === "land") {
    const dc = selection.data;
    return (
      <div className="panel detail">
        <div className="panel-header">
          <h2>Land-based facility</h2>
          <CloseButton onClick={onClose} />
        </div>
        <div className="panel-body">
          <div className="detail-section-label">Site info (real data)</div>
          <div className="detail-title">{dc.name}</div>
          <div className="detail-row">
            <span className="detail-key">Operator</span>
            <span>{dc.org}</span>
          </div>
          <div className="detail-row">
            <span className="detail-key">Location</span>
            <span>
              {dc.city}, {dc.country}
            </span>
          </div>
          <div className="detail-row">
            <span className="detail-key">Networks present</span>
            <span>{dc.netCount.toLocaleString()}</span>
          </div>
          <p className="status-note">
            Tier level, PUE/CUE/WUE, and redundancy configuration are not published by PeeringDB and
            aren't shown here to avoid guessing.
          </p>
          <p className="status-note">Source: PeeringDB facility #{dc.id}.</p>

          <button className="configure-btn" onClick={() => setConfiguring((v) => !v)}>
            {configuring ? "Hide configurator" : "Configure this site"}
          </button>
          {configuring && (
            <CalculatorPanel
              siteName={dc.name}
              siteLocation={`${dc.city}, ${dc.country}`}
              isSubsea={false}
              defaultCooling="air-crac"
            />
          )}
        </div>
      </div>
    );
  }

  const dc = selection.data;
  const routeRisk =
    dc.nearestLandingPoint && dc.nearestLandingPointDistanceKm != null
      ? estimateRouteRisk({
          depthM: dc.depth_m,
          latitude: dc.lat,
          routeDistanceKm: dc.nearestLandingPointDistanceKm,
          protectedAreaExposure: mpaExposure,
        })
      : null;

  return (
    <div className="panel detail">
      <div className="panel-header">
        <h2>Subsea data centre</h2>
        <CloseButton onClick={onClose} />
      </div>
      <div className="panel-body">
        <div className="detail-section-label">Site info (real data)</div>
        <div className="detail-title">{dc.name}</div>
        <div className="detail-row">
          <span className="detail-key">Operator</span>
          <span>{dc.operator}</span>
        </div>
        <div className="detail-row">
          <span className="detail-key">Status</span>
          <span className={`status-pill status-${dc.status}`}>{dc.status}</span>
        </div>
        <p className="status-note">{dc.status_note}</p>
        <div className="detail-row">
          <span className="detail-key">Depth</span>
          <span>{dc.depth_m} m</span>
        </div>
        <div className="detail-row">
          <span className="detail-key">Capacity</span>
          <span>{dc.capacity_mw ? `${dc.capacity_mw} MW` : "not publicly disclosed"}</span>
        </div>
        <p className="status-note">{dc.capacity_note}</p>
        {dc.nearestLandingPoint && (
          <div className="detail-row">
            <span className="detail-key">Nearest cable landing</span>
            <span>
              {dc.nearestLandingPoint.name} ({dc.nearestLandingPointDistanceKm} km)
            </span>
          </div>
        )}
        <div className={`coord-flag coord-flag-${dc.coordinate_precision}`}>
          <strong>Coordinate precision: {dc.coordinate_precision}.</strong> {dc.coordinate_note}
        </div>
        <p className="status-note">
          Tier level, PUE/CUE/WUE, and N/N+1/2N redundancy configuration are not publicly disclosed
          for this site and aren't shown here to avoid guessing.
        </p>
        <div className="sources">
          <span className="detail-key">Sources</span>
          <ul>
            {dc.sources.map((s) => (
              <li key={s}>
                <a href={s} target="_blank" rel="noreferrer">
                  {new URL(s).hostname}
                </a>
              </li>
            ))}
          </ul>
        </div>

        <button className="configure-btn" onClick={() => setConfiguring((v) => !v)}>
          {configuring ? "Hide configurator" : "Configure this site"}
        </button>
        {configuring && (
          <CalculatorPanel
            siteName={dc.name}
            siteLocation={
              dc.nearestLandingPoint
                ? `near ${dc.nearestLandingPoint.name}`
                : `${dc.lat.toFixed(2)}, ${dc.lng.toFixed(2)}`
            }
            isSubsea={true}
            defaultCooling="seawater"
            routeRisk={routeRisk}
            routeRiskLabel={dc.nearestLandingPoint ? `route to ${dc.nearestLandingPoint.name}` : undefined}
          />
        )}
      </div>
    </div>
  );
}
