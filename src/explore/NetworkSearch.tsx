// Global search over the real cable/landing-point dataset. Plain substring
// matching only (see cableNetwork.ts's searchNetwork) -- no fuzzy matching,
// so a result is only ever shown because the user's text actually appears
// in it.
import { useMemo, useRef, useState } from "react";
import { searchNetwork } from "../cableNetwork";
import type { CableNetworkIndex } from "../cableNetwork";
import "./explore.css";

interface Props {
  index: CableNetworkIndex;
  onSelectCable: (cableId: string) => void;
  onSelectLandingPoint: (landingPointId: string) => void;
}

export default function NetworkSearch({ index, onSelectCable, onSelectLandingPoint }: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => searchNetwork(query, index), [query, index]);
  const hasResults = results.cables.length > 0 || results.landingPoints.length > 0;

  function select(fn: () => void) {
    fn();
    setQuery("");
    setOpen(false);
    inputRef.current?.blur();
  }

  return (
    <div className="network-search">
      <svg className="network-search-icon" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="7" cy="7" r="5.25" stroke="currentColor" strokeWidth="1.4" fill="none" />
        <path d="M11 11L14.5 14.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
      <input
        ref={inputRef}
        className="network-search-input"
        type="text"
        placeholder="Search cables, landing points…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
      />
      {open && query.trim().length > 0 && (
        <div className="network-search-results">
          {!hasResults && <div className="network-search-empty">No matches.</div>}
          {results.cables.length > 0 && (
            <div className="network-search-group">
              <div className="network-search-group-label">Cables</div>
              {results.cables.map((c) => (
                <button
                  key={c.id}
                  className="network-search-item"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => select(() => onSelectCable(c.id))}
                >
                  <span className="network-search-item-swatch" style={{ background: c.color }} />
                  <span>
                    <span className="network-search-item-name">{c.name}</span>
                    <span className="network-search-item-id ex-mono">{c.id}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
          {results.landingPoints.length > 0 && (
            <div className="network-search-group">
              <div className="network-search-group-label">Landing Points</div>
              {results.landingPoints.map((lp) => (
                <button
                  key={lp.id}
                  className="network-search-item"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => select(() => onSelectLandingPoint(lp.id))}
                >
                  <span className="network-search-item-swatch network-search-item-swatch-lp" />
                  <span className="network-search-item-name">{lp.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
