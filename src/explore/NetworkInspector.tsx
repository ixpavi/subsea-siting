// Compact detail panel for a selected real cable or real landing point in
// the explore-mode cable explorer. Every field comes straight from
// cableNetwork.ts's index over the existing TeleGeography-backed dataset --
// nothing here is fetched, scraped, or invented.
import { getCableDetail, getLandingPointDetail } from "../cableNetwork";
import type { CableNetworkIndex, NetworkSelection } from "../cableNetwork";
import CloseButton from "../CloseButton";
import "./explore.css";

interface Props {
  selection: NetworkSelection;
  index: CableNetworkIndex;
  onSelectCable: (cableId: string) => void;
  onSelectLandingPoint: (landingPointId: string) => void;
  onClose: () => void;
}

export default function NetworkInspector({ selection, index, onSelectCable, onSelectLandingPoint, onClose }: Props) {
  return (
    <div className="panel ni-panel">
      <div className="panel-header">
        <span className="ni-kicker">{selection.kind === "cable" ? "Cable System" : "Landing Point"}</span>
        <CloseButton onClick={onClose} />
      </div>
      <div className="panel-body">
        {selection.kind === "cable" ? (
          <CableView cableId={selection.cableId} index={index} onSelectLandingPoint={onSelectLandingPoint} />
        ) : (
          <LandingPointView landingPointId={selection.landingPointId} index={index} onSelectCable={onSelectCable} />
        )}
      </div>
    </div>
  );
}

function CableView({
  cableId,
  index,
  onSelectLandingPoint,
}: {
  cableId: string;
  index: CableNetworkIndex;
  onSelectLandingPoint: (id: string) => void;
}) {
  const cable = getCableDetail(cableId, index);
  if (!cable) return <p className="ni-unavailable">Cable not found in the current dataset.</p>;

  return (
    <>
      <span className="ni-real-badge">Real Infrastructure</span>
      <div className="ni-title" style={{ color: cable.color }}>
        {cable.name}
      </div>
      <div className="ni-id ex-mono">{cable.id}</div>

      <div className="ni-section">
        <span className="ni-label">Route</span>
        {cable.landingPoints.length > 0 ? (
          <div className="ni-route">
            {cable.landingPoints.map((lp, i) => (
              <span key={lp.id} className="ni-route-item">
                {i > 0 && <span className="ni-route-arrow">→</span>}
                <button className="ni-link" onClick={() => onSelectLandingPoint(lp.id)}>
                  {lp.name}
                </button>
              </span>
            ))}
          </div>
        ) : (
          <p className="ni-unavailable">No landing points matched in the dataset.</p>
        )}
      </div>

      <div className="ni-factgrid">
        <div className="ni-fact">
          <span className="ni-label">Countries</span>
          <div>{cable.countries.length > 0 ? cable.countries.join(", ") : "Unavailable"}</div>
        </div>
        <div className="ni-fact">
          <span className="ni-label">Geometry</span>
          <div className="ex-mono">
            {cable.pathSegmentCount} segment{cable.pathSegmentCount !== 1 ? "s" : ""} &middot;{" "}
            {cable.totalVertexCount} pts
          </div>
        </div>
      </div>

      {/* Stating what the source does NOT contain, so a blank space is never
          mistaken for "this cable has no owner" or for a loading failure. The
          public submarinecablemap.com export carries only id, name, colour and
          geometry -- verified against scripts/raw/cable-geo.json. */}
      <div className="ni-section">
        <span className="ni-label">Not published in this dataset</span>
        <div className="ni-unavailable-fields">
          Capacity, owners, RFS date, suppliers, status and cost are not part of the public TeleGeography export, which
          provides cable naming and route geometry only. These are missing from the source, not from this app.
        </div>
      </div>

      <p className="ni-source">Source: TeleGeography-derived dataset (submarinecablemap.com).</p>
    </>
  );
}

function LandingPointView({
  landingPointId,
  index,
  onSelectCable,
}: {
  landingPointId: string;
  index: CableNetworkIndex;
  onSelectCable: (id: string) => void;
}) {
  const lp = getLandingPointDetail(landingPointId, index);
  if (!lp) return <p className="ni-unavailable">Landing point not found in the current dataset.</p>;

  return (
    <>
      <span className="ni-real-badge">Real Infrastructure</span>
      <div className="ni-title">{lp.name}</div>

      <div className="ni-factgrid">
        <div className="ni-fact">
          <span className="ni-label">Coordinates</span>
          <div className="ex-mono">
            {lp.lat.toFixed(4)}, {lp.lng.toFixed(4)}
          </div>
        </div>
        <div className="ni-fact">
          <span className="ni-label">Country</span>
          <div>{lp.country ?? "Unavailable"}</div>
        </div>
      </div>

      <div className="ni-section">
        <span className="ni-label">Connected Cable Systems ({lp.connectedCables.length})</span>
        {lp.connectedCables.length > 0 ? (
          <div className="ni-chip-list">
            {lp.connectedCables.map((c) => (
              <button key={c.id} className="ni-chip" style={{ borderColor: c.color }} onClick={() => onSelectCable(c.id)}>
                {c.name}
              </button>
            ))}
          </div>
        ) : (
          <p className="ni-unavailable">No cable systems matched to this landing point in the dataset.</p>
        )}
      </div>

      <p className="ni-source">Source: TeleGeography-derived dataset (submarinecablemap.com).</p>
    </>
  );
}
