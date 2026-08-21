import { useMemo, useState } from "react";
import { recommendConfigurations } from "./recommend";
import { COOLING_SPECS, TIER_SPECS } from "./facilityCalculator";
import type { FacilityConfig, PriorityWeights } from "./types";

interface Props {
  isSubsea: boolean;
  downtimeCostPerHourUsd: number;
  onApply: (config: FacilityConfig) => void;
}

const DEFAULT_WEIGHTS: PriorityWeights = { cost: 50, availability: 50, sustainability: 50, speed: 50 };

const SLIDER_FIELDS: { key: keyof PriorityWeights; label: string }[] = [
  { key: "cost", label: "Cost" },
  { key: "availability", label: "Availability / uptime" },
  { key: "sustainability", label: "Sustainability (PUE/WUE)" },
  { key: "speed", label: "Deployment speed" },
];

export default function Recommendations({ isSubsea, downtimeCostPerHourUsd, onApply }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [weights, setWeights] = useState<PriorityWeights>(DEFAULT_WEIGHTS);

  const results = useMemo(
    () => recommendConfigurations(isSubsea, downtimeCostPerHourUsd, weights, 5),
    [isSubsea, downtimeCostPerHourUsd, weights]
  );

  return (
    <div className="calc-recommend">
      <button className="calc-recommend-toggle" onClick={() => setExpanded((v) => !v)}>
        <span className="calc-badge">MODELED / RULE-BASED</span>
        <span className="calc-recommend-title">
          {expanded ? "▾" : "▸"} Recommend configurations
        </span>
      </button>

      {expanded && (
        <div className="calc-recommend-body">
          <p className="calc-subtitle">
            Weight what matters to you -- the engine scores every valid Tier x redundancy x cooling
            combination and ranks the Pareto-efficient options. Equal weights by default.
          </p>

          <div className="calc-weights">
            {SLIDER_FIELDS.map((f) => (
              <label key={f.key} className="calc-weight-field">
                <span>
                  {f.label} <span className="calc-weight-value">{weights[f.key]}</span>
                </span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={weights[f.key]}
                  onChange={(e) => setWeights({ ...weights, [f.key]: Number(e.target.value) })}
                />
              </label>
            ))}
          </div>

          <div className="calc-recommend-cards">
            {results.map((r, i) => (
              <div key={`${r.config.tier}-${r.config.redundancy}-${r.config.cooling}`} className="rec-card">
                <div className="rec-card-rank">#{i + 1}</div>
                <div className="rec-card-title">
                  {TIER_SPECS[r.config.tier].label} &middot; {r.config.redundancy} &middot;{" "}
                  {COOLING_SPECS[r.config.cooling].label}
                </div>
                <div className="rec-card-stats">
                  <span>{r.profile.availabilityPct}% avail.</span>
                  <span>${r.profile.annualDowntimeCostUsd.toLocaleString()}/yr</span>
                  <span>PUE {r.profile.pue}</span>
                  <span>WUE {r.profile.wue}</span>
                </div>
                <div className="rec-card-tags">{r.tags.join(" · ")}</div>
                <button className="rec-apply-btn" onClick={() => onApply(r.config)}>
                  Apply this configuration
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
