// Compact detail panel for a selected real cable or real landing point in
// the explore-mode cable explorer. Every field comes straight from the
// shipped TeleGeography-backed data -- cableNetwork.ts's index, plus each
// cable's owner record (design/providers.ts). Nothing here is invented.
import { getCableDetail, getLandingPointDetail } from "../cableNetwork";
import type { CableNetworkIndex, NetworkSelection } from "../cableNetwork";
import type { CableDetailsFile } from "../design/providers";
import CloseButton from "../CloseButton";
import "./explore.css";

interface Props {
  selection: NetworkSelection;
  index: CableNetworkIndex;
  /** Owners, builders and year per cable; null when it could not be loaded. */
  cableDetails: CableDetailsFile | null;
  onSelectCable: (cableId: string) => void;
  onSelectLandingPoint: (landingPointId: string) => void;
  onClose: () => void;
}

export default function NetworkInspector({
  selection,
  index,
  cableDetails,
  onSelectCable,
  onSelectLandingPoint,
  onClose,
}: Props) {
  return (
    <div className="panel ni-panel">
      <div className="panel-header">
        <span className="ni-kicker">{selection.kind === "cable" ? "Cable System" : "Landing Point"}</span>
        <CloseButton onClick={onClose} />
      </div>
      <div className="panel-body">
        {selection.kind === "cable" ? (
          <CableView
            cableId={selection.cableId}
            index={index}
            cableDetails={cableDetails}
            onSelectLandingPoint={onSelectLandingPoint}
          />
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
  cableDetails,
  onSelectLandingPoint,
}: {
  cableId: string;
  index: CableNetworkIndex;
  cableDetails: CableDetailsFile | null;
  onSelectLandingPoint: (id: string) => void;
}) {
  const cable = getCableDetail(cableId, index);
  const record = cableDetails?.cables[cableId] ?? null;
  if (!cable) return <p className="ni-unavailable">Cable not found in the current dataset.</p>;

  // Alphabetical, and never joined with arrows. The dataset gives a cable's
  // landing points only in the order its branches happen to be stored, which
  // is not the order the cable runs in: SeaMeWe-5 came out as Yemen -> Saudi
  // Arabia -> Indonesia -> Turkey -> Italy -> Myanmar, drawn as a "route".
  const landingPoints = [...cable.landingPoints].sort((a, b) => a.name.localeCompare(b.name));
  const countries = [...cable.countries].sort((a, b) => a.localeCompare(b));

  return (
    <>
      <span className="ni-real-badge">Real Infrastructure</span>
      <div className="ni-title" style={{ color: cable.color }}>
        {cable.name}
      </div>
      <div className="ni-id ex-mono">{cable.id}</div>

      <div className="ni-section">
        <span className="ni-label">Landing points ({landingPoints.length})</span>
        {landingPoints.length > 0 ? (
          <div className="ni-chip-list">
            {landingPoints.map((lp) => (
              <button key={lp.id} className="ni-chip" onClick={() => onSelectLandingPoint(lp.id)}>
                {lp.name}
              </button>
            ))}
          </div>
        ) : (
          <p className="ni-unavailable">No landing points matched in the dataset.</p>
        )}
      </div>

      <div className="ni-factgrid">
        <div className="ni-fact">
          <span className="ni-label">Countries</span>
          <div>{countries.length > 0 ? countries.join(", ") : "Unavailable"}</div>
        </div>
        <div className="ni-fact">
          <span className="ni-label">Geometry</span>
          <div className="ex-mono">
            {cable.pathSegmentCount} segment{cable.pathSegmentCount !== 1 ? "s" : ""} &middot;{" "}
            {cable.totalVertexCount} pts
          </div>
        </div>
      </div>

      {record ? (
        <>
          <div className="ni-section">
            <span className="ni-label">Owners ({record.owners.length})</span>
            {record.owners.length > 0 ? (
              <div className="ni-owner-list">{record.owners.join(", ")}</div>
            ) : (
              <p className="ni-unavailable">Not published for this system.</p>
            )}
          </div>
          <div className="ni-factgrid">
            <div className="ni-fact">
              <span className="ni-label">Built by</span>
              <div>{record.suppliers.length > 0 ? record.suppliers.join(", ") : "Not published"}</div>
            </div>
            <div className="ni-fact">
              <span className="ni-label">{record.planned ? "Planned for service" : "In service since"}</span>
              <div className="ex-mono">{record.rfsYear ?? "Not published"}</div>
            </div>
            <div className="ni-fact">
              <span className="ni-label">Stated length</span>
              <div className="ex-mono">{record.lengthKm != null ? `${record.lengthKm.toLocaleString()} km` : "Not published"}</div>
            </div>
          </div>
        </>
      ) : (
        <p className="ni-unavailable">
          {cableDetails ? "No owner record is published for this system." : "Owner data could not be loaded."}
        </p>
      )}

      {/* Stating what the source does NOT contain, so a blank space is never
          mistaken for "this cable has no capacity" or for a loading failure. */}
      <div className="ni-section">
        <span className="ni-label">Not published in this dataset</span>
        <div className="ni-unavailable-fields">
          Capacity and cost are not part of the public TeleGeography data. These are missing from the source, not
          from this app.
        </div>
      </div>

      <p className="ni-source">
        Source: TeleGeography Submarine Cable Map (submarinecablemap.com); owners and builders CC BY-NC-SA 3.0.
      </p>
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
