// Shown only when a click's tolerance zone genuinely contains multiple
// distinct real cables at the current screen resolution -- see
// cableHitTest.ts. Never a random pick: the user chooses explicitly.
import type { CableHitCandidate } from "../cableHitTest";
import CloseButton from "../CloseButton";
import "./explore.css";

export default function CableChooser({
  candidates,
  onChoose,
  onClose,
}: {
  candidates: CableHitCandidate[];
  onChoose: (cableId: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="panel cable-chooser">
      <div className="panel-header">
        <span className="ni-kicker">Select Cable</span>
        <CloseButton onClick={onClose} />
      </div>
      <div className="panel-body">
        <p className="ni-unavailable" style={{ marginBottom: 8 }}>
          {candidates.length} real cables overlap at this position.
        </p>
        <div className="cable-chooser-list">
          {candidates.map((c) => (
            <button key={c.cableId} className="cable-directory-row" onClick={() => onChoose(c.cableId)}>
              <span className="cable-directory-swatch" style={{ background: c.color }} />
              <span className="cable-directory-row-text">
                <span className="cable-directory-row-name">{c.cableName}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
