// Small floating inspector for a selected real cable or real landing point,
// surfaced while a connectivity analysis is active. Deliberately separate
// from DetailPanel/Selection (which is suppressed during planning mode) --
// this only ever shows real, dataset-backed facts about the clicked item.
import type { ConnectivitySelection, ConnectivityLandingPointDatum } from "../Globe";
import type { RelevantCable } from "./connectivityAnalysis";
import CloseButton from "../CloseButton";
import "./design.css";

export default function ConnectivityInspector({
  selection,
  onClose,
}: {
  selection: ConnectivitySelection;
  onClose: () => void;
}) {
  return (
    <div className="panel ci-panel">
      <div className="panel-header">
        <span className="ni-kicker">{selection.kind === "cable" ? "Cable System" : "Landing Point"}</span>
        <CloseButton onClick={onClose} />
      </div>
      <div className="panel-body">
        {selection.kind === "cable" ? <CableDetail cable={selection.data} /> : <LandingPointDetail lp={selection.data} />}
      </div>
    </div>
  );
}

function CableDetail({ cable }: { cable: RelevantCable }) {
  const relevanceLabel =
    cable.relevance === "direct"
      ? "Direct system -- lands near both endpoints"
      : cable.relevance === "source-side"
        ? "Lands near source only"
        : "Lands near destination only";
  return (
    <>
      <div className="detail-section-label">REAL CABLE SYSTEM</div>
      <div className="detail-title" style={{ color: cable.color }}>
        {cable.name}
      </div>
      <div className="detail-row">
        <span className="detail-key">Relevance</span>
        <span>{relevanceLabel}</span>
      </div>
      {cable.sourceLandingPoints.length > 0 && (
        <div className="detail-row">
          <span className="detail-key">Source-side landing</span>
          <span>{cable.sourceLandingPoints.map((lp) => lp.name).join(", ")}</span>
        </div>
      )}
      {cable.destinationLandingPoints.length > 0 && (
        <div className="detail-row">
          <span className="detail-key">Destination-side landing</span>
          <span>{cable.destinationLandingPoints.map((lp) => lp.name).join(", ")}</span>
        </div>
      )}
      <div className="detail-row">
        <span className="detail-key">Path segments</span>
        <span>{cable.paths.length}</span>
      </div>
      <p className="status-note">Source: TeleGeography submarine cable geometry (submarinecablemap.com).</p>
    </>
  );
}

function LandingPointDetail({ lp }: { lp: ConnectivityLandingPointDatum }) {
  return (
    <>
      <div className="detail-section-label">REAL LANDING POINT</div>
      <div className="detail-title">{lp.name}</div>
      <div className="detail-row">
        <span className="detail-key">Role</span>
        <span>{lp.role === "destination" ? "Near destination" : "Near proposed site"}</span>
      </div>
      <div className="detail-row">
        <span className="detail-key">{lp.role === "destination" ? "Distance from destination" : "Distance from site"}</span>
        <span className="dc-mono">{lp.distanceFromQueryKm.toFixed(1)} km</span>
      </div>
      <div className="detail-row">
        <span className="detail-key">Coordinates</span>
        <span className="dc-mono">
          {lp.lat.toFixed(4)}, {lp.lng.toFixed(4)}
        </span>
      </div>
      <p className="status-note">Source: TeleGeography landing-point geometry (submarinecablemap.com).</p>
    </>
  );
}
