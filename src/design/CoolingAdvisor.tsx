// Renders the cooling-technology assessment for a proposed site. All logic
// lives in siting/coolingAdvisor.ts; this only presents what it computed.
import { useEffect, useState } from "react";
import { LAND_COOLING_OPTIONS } from "../calculator/facilityCalculator";
import { fetchClimateProfile } from "../siting/climateProfile";
import { getCountryFactors } from "../siting/countryFactors";
import { loadPueModel } from "../siting/pueAdjustment";
import { assessCooling, ECONOMISER_SUPPLY_AIR_C, EVAPORATIVE_WET_BULB_C } from "../siting/coolingAdvisor";
import type { CoolingAdvice, CoolingAssessment } from "../siting/coolingAdvisor";
import "./design.css";

interface Props {
  lat: number;
  lng: number;
  countryCode?: string;
  /** Cooling type the MCDA recommendation already selected, highlighted for comparison. */
  selectedCooling?: string;
}

type State = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; advice: CoolingAdvice };

export default function CoolingAdvisor({ lat, lng, countryCode, selectedCooling }: Props) {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchClimateProfile(lat, lng), getCountryFactors(countryCode), loadPueModel()])
      .then(([climate, country, model]) => {
        if (cancelled) return;
        setState({
          status: "ready",
          advice: assessCooling(LAND_COOLING_OPTIONS, climate, country.factors, model),
        });
      })
      .catch((e: unknown) => {
        if (!cancelled) setState({ status: "error", message: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [lat, lng, countryCode]);

  if (state.status === "loading") return <p className="design-field-note">Assessing cooling options against this site's climate…</p>;
  if (state.status === "error") {
    return <p className="pp-conn-unavailable">Cooling assessment unavailable ({state.message}).</p>;
  }

  const { advice } = state;
  const c = advice.climate;

  return (
    <div className="pp-detail-card ca-card">
      <div className="ca-head">
        <span className="design-label">
          Cooling suitability at this site <span className="prov-chip prov-modeled">MODELED</span>
        </span>
      </div>

      <div className="ca-climate">
        <span className="design-label">
          Measured site climate <span className="prov-chip prov-derived">DERIVED</span>
        </span>
        <div className="ca-climate-grid">
          <div>
            <span className="dc-mono">{(c.freeCoolingFractionAt24C * 100).toFixed(0)}%</span> of year below{" "}
            {ECONOMISER_SUPPLY_AIR_C}°C dry bulb
          </div>
          <div>
            <span className="dc-mono">{(c.evaporativeFractionAt20C * 100).toFixed(0)}%</span> of year below{" "}
            {EVAPORATIVE_WET_BULB_C}°C wet bulb
          </div>
          <div>
            Design dry bulb <span className="dc-mono">{c.designDryBulbC.toFixed(1)}°C</span>
          </div>
          <div>
            Design wet bulb <span className="dc-mono">{c.designWetBulbC.toFixed(1)}°C</span>
          </div>
        </div>
        <p className="design-field-note">
          {c.hoursSampled.toLocaleString()} hourly observations, {c.source}.
        </p>
      </div>

      {advice.countryFactors && (
        <p className="design-field-note ca-national">
          National context <span className="prov-chip prov-derived">DERIVED</span>: water stress{" "}
          <span className="dc-mono">{advice.countryFactors.waterStressScore?.toFixed(2) ?? "n/a"}/5</span>
          {advice.countryFactors.waterStressCategory ? ` (${advice.countryFactors.waterStressCategory})` : ""}, grid
          carbon{" "}
          <span className="dc-mono">
            {advice.countryFactors.carbonIntensityGco2PerKwh?.toFixed(0) ?? "n/a"} gCO₂/kWh
          </span>
          . National aggregates -- water stress in particular varies widely within large countries.
        </p>
      )}
      {advice.nationalDataUnavailable && (
        <p className="design-field-note">
          National water-stress and grid-carbon data could not be matched for this location, so those factors were
          treated as neutral rather than favourable.
        </p>
      )}

      <div className="ca-list">
        {advice.assessments.map((a, i) => (
          <CoolingRow key={a.cooling} a={a} rank={i + 1} isSelected={a.cooling === selectedCooling} />
        ))}
      </div>

      <p className="design-field-note">
        Ranked by an equally weighted combination of climate fit, water exposure and climate-adjusted efficiency. The
        supply-air and wet-bulb limits above are disclosed modelling assumptions, not industry standards -- the
        measured hour-fractions are shown so you can apply your own thresholds.
      </p>
      <p className="design-field-note">
        <strong>Scope:</strong> this ranks cooling technologies on <em>site fit only</em>. It does not price capital
        cost, deployment complexity, supply-chain maturity or serviceability -- which is why a liquid/immersion
        approach tends to lead here on efficiency and water alone. The design recommendation above does weigh cost and
        deployment speed, so read the two together rather than treating this ordering as a purchase decision.
      </p>
    </div>
  );
}

function CoolingRow({ a, rank, isSelected }: { a: CoolingAssessment; rank: number; isSelected: boolean }) {
  return (
    <div className={`ca-row ${rank === 1 ? "ca-best" : ""}`}>
      <div className="ca-row-head">
        <span className="ca-rank dc-mono">#{rank}</span>
        <span className="ca-name">{a.label}</span>
        {rank === 1 && <span className="pp-real-badge ca-badge">BEST FIT</span>}
        {isSelected && <span className="dc-modeled-badge ca-badge">CURRENT DESIGN</span>}
        <span className="dc-mono ca-score">{a.suitability.toFixed(2)}</span>
      </div>
      <div className="ca-bars">
        <Bar label="Climate" v={a.climate.score} title={a.climate.basis} />
        <Bar label="Water" v={a.water.score} title={a.water.basis} />
        <Bar label="Efficiency" v={a.efficiency.score} title={a.efficiency.basis} />
      </div>
      <div className="ca-metrics">
        <span className="dc-mono">PUE {a.adjustedPue.toFixed(3)}</span>
        <span className="dc-mono">WUE {a.wue} L/kWh</span>
        {a.operationalCarbonKgPerKwh != null && (
          <span className="dc-mono">{a.operationalCarbonKgPerKwh.toFixed(3)} kgCO₂/kWh</span>
        )}
      </div>
      {a.notes.map((n) => (
        <p key={n} className="design-field-note ca-note">
          {n}
        </p>
      ))}
      {a.warnings.map((w) => (
        <p key={w} className="ca-warning">
          {w}
        </p>
      ))}
    </div>
  );
}

function Bar({ label, v, title }: { label: string; v: number; title: string }) {
  return (
    <div className="ca-bar" title={title}>
      <span className="ca-bar-label">{label}</span>
      <span className="ca-bar-track">
        <span className="ca-bar-fill" style={{ width: `${Math.round(v * 100)}%` }} />
      </span>
      <span className="dc-mono ca-bar-value">{v.toFixed(2)}</span>
    </div>
  );
}
