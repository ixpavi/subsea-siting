import { useState } from "react";
import type { Selection } from "./types";
import CalculatorPanel from "./calculator/CalculatorPanel";
import { estimateRouteRisk } from "./calculator/environmentalRisk";
import CloseButton from "./CloseButton";

export default function DetailPanel({ selection, onClose }: { selection: Selection; onClose: () => void }) {
  const [configuring, setConfiguring] = useState(false);

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
