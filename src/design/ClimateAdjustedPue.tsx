// Shows the recommended design's PUE corrected for the proposed site's real
// climate, instead of the location-blind constant from COOLING_SPECS.
//
// Both inputs are real: the site's climate comes from NASA POWER / ERA5, and
// the correction gradient is fitted to measured per-facility PUE published by
// Google (see scripts/build-pue-model.mjs and siting/pueAdjustment.ts). The
// baseline remains the chosen cooling type's specified PUE -- this only moves
// it with climate.
import { useEffect, useState } from "react";
import { fetchClimateProfile } from "../siting/climateProfile";
import { adjustPueForClimate, loadPueModel } from "../siting/pueAdjustment";
import type { PueAdjustment } from "../siting/pueAdjustment";
import "./design.css";

interface Props {
  lat: number;
  lng: number;
  /** PUE the selected cooling type specifies, before any climate correction. */
  baselinePue: number;
  coolingLabel: string;
}

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; adjustment: PueAdjustment };

export default function ClimateAdjustedPue({ lat, lng, baselinePue, coolingLabel }: Props) {
  const [state, setState] = useState<State>({ status: "loading" });

  // No synchronous reset to "loading" here: the parent keys this component on
  // its inputs, so changing site or design remounts it and the initial state
  // is already "loading". Resetting inside the effect would both trip the
  // cascading-render lint and, briefly, render the previous site's figure.
  useEffect(() => {
    let cancelled = false;
    Promise.all([loadPueModel(), fetchClimateProfile(lat, lng)])
      .then(([model, climate]) => {
        if (cancelled) return;
        setState({ status: "ready", adjustment: adjustPueForClimate(model, baselinePue, climate.meanDryBulbC) });
      })
      .catch((e: unknown) => {
        if (!cancelled) setState({ status: "error", message: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [lat, lng, baselinePue]);

  if (state.status === "loading") {
    return <p className="design-field-note">Fetching site climate to adjust PUE…</p>;
  }
  if (state.status === "error") {
    // Never silently fall back to the location-blind constant as though it
    // were climate-aware -- say the adjustment is unavailable.
    return (
      <p className="design-field-note">
        Climate-adjusted PUE unavailable ({state.message}). The figure above is the cooling type's baseline, which does
        not account for this site's climate.
      </p>
    );
  }

  const a = state.adjustment;
  const warmer = a.deltaPue >= 0;

  return (
    <div className="cap-block">
      <div className="cap-row">
        <span className="design-label">
          Climate-adjusted PUE <span className="prov-chip prov-derived">DERIVED</span>
        </span>
        <span className="dc-mono cap-value">{a.adjustedPue.toFixed(3)}</span>
      </div>
      <div className="cap-detail">
        <span className="dc-mono">{a.baselinePue.toFixed(2)}</span> baseline for {coolingLabel}
        <span className={`cap-delta ${warmer ? "cap-worse" : "cap-better"}`}>
          {warmer ? "+" : ""}
          {a.deltaPue.toFixed(3)}
        </span>
        for a site averaging <span className="dc-mono">{a.siteMeanTempC.toFixed(1)}°C</span> against the fitted
        reference of <span className="dc-mono">{a.referenceTempC.toFixed(1)}°C</span>
      </div>
      {a.extrapolated && (
        <p className="cap-warning">
          This site is outside the {a.fittedRange.min.toFixed(1)}–{a.fittedRange.max.toFixed(1)}°C range the gradient
          was fitted over. The correction is an extrapolation and is less reliable here.
        </p>
      )}
      <p className="design-field-note">{a.basis}</p>
    </div>
  );
}
