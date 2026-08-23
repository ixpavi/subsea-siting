// Full cable directory -- generated directly from the loaded cable dataset
// (cableNetwork.ts's merged-by-id index), never a hardcoded list.
import { useMemo, useState } from "react";
import type { CableNetworkIndex } from "../cableNetwork";
import CloseButton from "../CloseButton";
import "./explore.css";

interface Props {
  index: CableNetworkIndex;
  onSelectCable: (cableId: string) => void;
  onClose: () => void;
}

export default function CableDirectory({ index, onSelectCable, onClose }: Props) {
  const [filter, setFilter] = useState("");

  const allCables = useMemo(
    () => [...index.cablesById.values()].sort((a, b) => a.name.localeCompare(b.name)),
    [index]
  );
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (q.length === 0) return allCables;
    return allCables.filter((c) => c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q));
  }, [allCables, filter]);

  return (
    <div className="panel cable-directory">
      <div className="panel-header">
        <div>
          <span className="ni-kicker">Cable Directory</span>
          <div className="cable-directory-count ex-mono">{allCables.length.toLocaleString()} systems</div>
        </div>
        <CloseButton onClick={onClose} />
      </div>
      <div className="cable-directory-toolbar">
        <input
          className="cable-directory-filter"
          type="text"
          placeholder="Filter by name or ID…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          autoFocus
        />
      </div>
      <div className="cable-directory-list">
        {filtered.map((c) => (
          <button key={c.id} className="cable-directory-row" onClick={() => onSelectCable(c.id)}>
            <span className="cable-directory-swatch" style={{ background: c.color }} />
            <span className="cable-directory-row-text">
              <span className="cable-directory-row-name">{c.name}</span>
              <span className="cable-directory-row-id ex-mono">{c.id}</span>
            </span>
          </button>
        ))}
        {filtered.length === 0 && <div className="network-search-empty">No matches.</div>}
      </div>
    </div>
  );
}
