import { useMemo, useState } from "react";
import {
  calculateFacilityProfile,
  COOLING_SPECS,
  LAND_COOLING_OPTIONS,
  SUBSEA_COOLING_OPTIONS,
  TIER_SPECS,
} from "./facilityCalculator";
import type { CoolingConfig, FacilityConfig, RedundancyLevel, TierLevel } from "./types";
import type { RouteRiskEstimate } from "./environmentalRisk";
import Recommendations from "./Recommendations";
import "./calculator.css";

const REDUNDANCY_OPTIONS: RedundancyLevel[] = ["N", "N+1", "2N"];
const TIER_OPTIONS: TierLevel[] = ["I", "II", "III", "IV"];

interface Props {
  siteName: string;
  siteLocation: string;
  isSubsea?: boolean;
  /** Defaults the cooling picker to a subsea-appropriate option */
  defaultCooling?: CoolingConfig;
  routeRisk?: RouteRiskEstimate | null;
  routeRiskLabel?: string;
}

export default function CalculatorPanel({
  siteName,
  siteLocation,
  isSubsea = false,
  defaultCooling = "air-crac",
  routeRisk,
  routeRiskLabel,
}: Props) {
  const [redundancy, setRedundancy] = useState<RedundancyLevel>("N+1");
  const [tier, setTier] = useState<TierLevel>("III");
  const [cooling, setCooling] = useState<CoolingConfig>(defaultCooling);
  const [downtimeCost, setDowntimeCost] = useState(9000);

  const config: FacilityConfig = useMemo(
    () => ({ redundancy, tier, cooling, downtimeCostPerHourUsd: downtimeCost }),
    [redundancy, tier, cooling, downtimeCost]
  );
  const profile = useMemo(() => calculateFacilityProfile(config), [config]);
  // Only the cooling types that make physical sense here -- the same sets the
  // recommendations below are drawn from. Offering all five let a land site be
  // "configured" with seawater exchange and a subsea vessel with a chiller plant.
  const coolingOptions = isSubsea ? SUBSEA_COOLING_OPTIONS : LAND_COOLING_OPTIONS;

  return (
    <div className="calc-panel">
      <div className="calc-panel-header">
        <span className="calc-badge">MODELED / HYPOTHETICAL</span>
        <h3>Configure a hypothetical deployment here</h3>
        <p className="calc-subtitle">
          Hypothetical facility at {siteName}, {siteLocation} -- not a claim about the real site.
        </p>
      </div>

      <div className="calc-inputs">
        <label className="calc-field">
          <span>Redundancy</span>
          <select value={redundancy} onChange={(e) => setRedundancy(e.target.value as RedundancyLevel)}>
            {REDUNDANCY_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>

        <label className="calc-field">
          <span>Tier</span>
          <select value={tier} onChange={(e) => setTier(e.target.value as TierLevel)}>
            {TIER_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {TIER_SPECS[t].label}
              </option>
            ))}
          </select>
        </label>

        <label className="calc-field">
          <span>Cooling</span>
          <select value={cooling} onChange={(e) => setCooling(e.target.value as CoolingConfig)}>
            {coolingOptions.map((c) => (
              <option key={c} value={c}>
                {COOLING_SPECS[c].label}
              </option>
            ))}
          </select>
        </label>

        <label className="calc-field">
          <span>Downtime cost ($/hr)</span>
          <input
            type="number"
            min={0}
            step={500}
            value={downtimeCost}
            // `min` only guides the spinner; a typed "-500" still arrives, and
            // a negative downtime cost would reward downtime.
            onChange={(e) => setDowntimeCost(Math.max(0, Number(e.target.value) || 0))}
          />
        </label>
      </div>

      <p className="calc-note">{TIER_SPECS[tier].description} {COOLING_SPECS[cooling].description}</p>

      <div className="calc-results">
        <div className="calc-stat">
          <span className="calc-stat-label">Est. availability</span>
          <span className="calc-stat-value">{profile.availabilityPct}%</span>
        </div>
        <div className="calc-stat">
          <span className="calc-stat-label">Est. annual downtime</span>
          <span className="calc-stat-value">{profile.annualDowntimeHours} hrs</span>
        </div>
        <div className="calc-stat">
          <span className="calc-stat-label">Est. downtime cost</span>
          <span className="calc-stat-value">${profile.annualDowntimeCostUsd.toLocaleString()}/yr</span>
        </div>
        <div className="calc-stat">
          <span className="calc-stat-label">PUE</span>
          <span className="calc-stat-value">{profile.pue}</span>
        </div>
        <div className="calc-stat">
          <span className="calc-stat-label">CUE</span>
          {/* CUE needs the site's grid carbon intensity, and this calculator
              has no location. Reported as unavailable rather than filled with
              a global average, which would vary the real answer by 30x. */}
          <span className="calc-stat-value" title="Needs a site location: CUE is PUE x the local grid's carbon intensity">
            {profile.cue == null ? "n/a" : `${profile.cue} kg/kWh`}
          </span>
        </div>
        <div className="calc-stat">
          <span className="calc-stat-label">WUE</span>
          <span className="calc-stat-value">{profile.wue} L/kWh</span>
        </div>
      </div>

      <p className="calc-disclaimer">
        Tier availability figures are the published Uptime Institute standard values. Redundancy
        downtime modifiers and cooling PUE/CUE/WUE figures are illustrative typical benchmarks for
        scenario comparison, not measurements of any real facility.
      </p>

      <Recommendations
        isSubsea={isSubsea}
        downtimeCostPerHourUsd={downtimeCost}
        onApply={(applied) => {
          setRedundancy(applied.redundancy);
          setTier(applied.tier);
          setCooling(applied.cooling);
        }}
      />

      {routeRisk && (
        <div className="calc-risk">
          <div className="calc-panel-header">
            <span className="calc-badge calc-badge-risk">MODELED / ILLUSTRATIVE</span>
            <h3>Connectivity route risk{routeRiskLabel ? ` -- ${routeRiskLabel}` : ""}</h3>
          </div>
          <div className="calc-results">
            <div className="calc-stat">
              <span className="calc-stat-label">
                Ecological sensitivity{" "}
                <span className="calc-basis">
                  {routeRisk.ecologicalBasis === "measured" ? "measured (WDPA)" : "heuristic"}
                </span>
              </span>
              <span className={`risk-pill risk-${routeRisk.ecologicalSensitivity}`}>
                {routeRisk.ecologicalSensitivity}
              </span>
            </div>
            <div className="calc-stat">
              <span className="calc-stat-label">Bathymetric hazard</span>
              <span className={`risk-pill risk-${routeRisk.bathymetricHazard}`}>
                {routeRisk.bathymetricHazard}
              </span>
            </div>
            <div className="calc-stat">
              <span className="calc-stat-label">Overall</span>
              <span className={`risk-pill risk-${routeRisk.overall}`}>{routeRisk.overall}</span>
            </div>
          </div>
          <ul className="calc-risk-rationale">
            {routeRisk.rationale.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          <p className="calc-disclaimer">
            {routeRisk.ecologicalBasis === "measured"
              ? "Ecological sensitivity is measured against the World Database on Protected Areas (European extract, ~11 km cells) -- it indicates proximity to protected water, not a legal boundary. "
              : "Ecological sensitivity falls back to a geographic heuristic (depth, latitude band) because no protected-area data covers this route. "}
            Bathymetric hazard is a heuristic in both cases, applied to the site&apos;s published depth. Reef
            data (Allen Coral Atlas) is not integrated.
          </p>
        </div>
      )}
    </div>
  );
}
