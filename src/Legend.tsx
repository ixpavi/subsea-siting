import type { LayerToggles } from "./types";

interface Props {
  toggles: LayerToggles;
  onChange: (next: LayerToggles) => void;
  counts: { cables: number; landDCs: number; subseaDCs: number };
}

const ROWS: { key: keyof LayerToggles; label: string; swatch: string; countKey?: keyof Props["counts"] }[] = [
  { key: "cables", label: "Submarine cable routes", swatch: "cable", countKey: "cables" },
  { key: "landDCs", label: "Land-based DC facilities", swatch: "land", countKey: "landDCs" },
  { key: "subseaDCs", label: "Subsea DC sites", swatch: "subsea", countKey: "subseaDCs" },
  { key: "connectors", label: "Nearest-landing connectors", swatch: "connector" },
];

export default function Legend({ toggles, onChange, counts }: Props) {
  return (
    <div className="panel legend">
      <h2>Layers</h2>
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
  );
}
