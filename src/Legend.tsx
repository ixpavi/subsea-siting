import { useEffect, useRef, useState } from "react";
import type { LayerToggles } from "./types";
import CloseButton from "./CloseButton";

interface Props {
  toggles: LayerToggles;
  onChange: (next: LayerToggles) => void;
  counts: { cables: number; landDCs: number; subseaDCs: number; landingPoints: number };
}

const ROWS: { key: keyof LayerToggles; label: string; swatch: string; countKey?: keyof Props["counts"] }[] = [
  { key: "cables", label: "Submarine cables", swatch: "cable", countKey: "cables" },
  { key: "landingPoints", label: "Cable landing points", swatch: "landingpoint", countKey: "landingPoints" },
  { key: "landDCs", label: "Land-based DC facilities", swatch: "land", countKey: "landDCs" },
  { key: "subseaDCs", label: "Subsea DC sites", swatch: "subsea", countKey: "subseaDCs" },
  { key: "connectors", label: "Nearest-landing connectors", swatch: "connector" },
];

/**
 * Compact toggle + popover -- not a permanent dashboard card. Closed by
 * default so it never occupies globe real estate; when open it sits above
 * the button and closes on outside click, matching the rest of the app's
 * transient overlays (search results, cable directory).
 */
export default function Legend({ toggles, onChange, counts }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  return (
    <div className="legend-root" ref={rootRef}>
      {open && (
        <div className="panel legend-popover">
          <div className="panel-header">
            <h2>Layers</h2>
            {/* Outside-click already dismisses this, but on a phone it renders as
                a bottom sheet like every other panel, and a sheet without a
                visible close control reads as stuck. */}
            <CloseButton onClick={() => setOpen(false)} label="Close layers" />
          </div>
          <div className="panel-body legend-body">
            <span className="ni-label">Infrastructure</span>
            {ROWS.map((row) => (
              <label key={row.key} className="legend-row">
                <input
                  type="checkbox"
                  checked={toggles[row.key]}
                  disabled={row.key === "connectors" && !toggles.subseaDCs}
                  onChange={(e) => onChange({ ...toggles, [row.key]: e.target.checked })}
                />
                <span className={`swatch swatch-${row.swatch}`} />
                <span className="legend-label">{row.label}</span>
                {row.countKey !== undefined && (
                  <span className="legend-count">{counts[row.countKey].toLocaleString()}</span>
                )}
              </label>
            ))}
          </div>
        </div>
      )}
      <button className={`toolbar-btn legend-toggle ${open ? "active" : ""}`} onClick={() => setOpen((v) => !v)}>
        Layers
      </button>
    </div>
  );
}
