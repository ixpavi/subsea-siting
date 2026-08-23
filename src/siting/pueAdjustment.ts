// Applies a climate correction to a design's baseline PUE, using a gradient
// fitted to REAL MEASURED per-facility PUE (see scripts/build-pue-model.mjs).
//
// WHAT THIS FIXES: calculator/facilityCalculator.ts assigns each cooling type
// a single fixed PUE (free-air 1.2, chilled water 1.4, and so on). Those are
// location-blind and were invented rather than measured -- yet an air-side
// economiser in Dublin and the same plant in Chennai plainly do not perform
// alike. This module supplies the missing location dependence from data.
//
// GRADIENT ONLY, NEVER THE INTERCEPT. The fit comes from Google's published
// fleet, which is hyperscale and exceptionally optimised (observed PUE 1.04 -
// 1.16 against a widely reported industry average nearer 1.5). Its absolute
// level says nothing about what an enterprise build would achieve, so the
// intercept is discarded and only the SLOPE -- how much PUE moves per degree
// of annual mean temperature -- is transferred. The baseline stays whatever
// the chosen cooling type specifies; climate shifts it from there.
//
// The reference temperature is the mean of the fitted sample: at that climate
// the correction is zero and the existing baseline is returned unchanged, so
// this can never silently re-scale the whole model.
//
// WHAT IT CANNOT DO: Google does not publish cooling technology per facility,
// so the fit relates PUE to climate alone. It cannot choose a cooling
// technology, and the same gradient is applied to every cooling type -- which
// is certainly an approximation, since an economiser is far more
// climate-sensitive than a sealed immersion loop. That limitation is
// surfaced to the user rather than buried here.

export interface PueModel {
  generatedAt: string;
  source: { name: string; url: string; quartersUsed: string[] };
  provenance: string;
  facilityCount: number;
  best: string;
  gradientMilliPuePerDegC: number;
  fittedRange: { min: number; max: number; variable: string };
  observedPue: { min: number; max: number; median: number };
  predictors: { name: string; r: number; loo: number; slope: number; intercept: number; meanX: number; min: number; max: number }[];
  facilities: { facility: string; lat: number; lng: number; pue: number; meanTempC: number }[];
}

export interface PueAdjustment {
  baselinePue: number;
  adjustedPue: number;
  deltaPue: number;
  siteMeanTempC: number;
  referenceTempC: number;
  gradientMilliPuePerDegC: number;
  /** True when the site's climate sits outside the range the gradient was fitted over -- the correction is then an extrapolation and must be labelled as such. */
  extrapolated: boolean;
  fittedRange: { min: number; max: number };
  basis: string;
}

let modelPromise: Promise<PueModel> | null = null;

export function loadPueModel(): Promise<PueModel> {
  if (!modelPromise) {
    modelPromise = fetch("/data/pue-model.json").then((res) => {
      if (!res.ok) throw new Error(`Failed to load pue-model.json: ${res.status}`);
      return res.json() as Promise<PueModel>;
    });
    modelPromise.catch(() => {
      modelPromise = null;
    });
  }
  return modelPromise;
}

/**
 * Shifts `baselinePue` for the site's climate. Returns the baseline unchanged
 * (delta 0) when the site sits at the reference climate.
 */
export function adjustPueForClimate(model: PueModel, baselinePue: number, siteMeanTempC: number): PueAdjustment {
  const predictor = model.predictors.find((p) => p.name === model.best);
  // Reference = mean of the fitted sample, so the correction is centred and
  // cannot bias the baseline for a typical site.
  const referenceTempC = predictor ? predictor.meanX : (model.fittedRange.min + model.fittedRange.max) / 2;
  const gradient = model.gradientMilliPuePerDegC / 1000;
  const deltaPue = gradient * (siteMeanTempC - referenceTempC);
  const extrapolated = siteMeanTempC < model.fittedRange.min || siteMeanTempC > model.fittedRange.max;

  return {
    baselinePue,
    // PUE below 1.0 is thermodynamically impossible -- a facility cannot use
    // less total power than its IT load. Clamp defensively; an unclamped
    // extrapolation to a very cold site could otherwise produce one.
    adjustedPue: Math.max(1.01, baselinePue + deltaPue),
    deltaPue,
    siteMeanTempC,
    referenceTempC,
    gradientMilliPuePerDegC: model.gradientMilliPuePerDegC,
    extrapolated,
    fittedRange: { min: model.fittedRange.min, max: model.fittedRange.max },
    basis:
      `Climate gradient of ${model.gradientMilliPuePerDegC.toFixed(2)} milli-PUE per °C, fitted to measured ` +
      `trailing-twelve-month PUE at ${model.facilityCount} real Google data centres against NASA POWER climate ` +
      `normals. Only the gradient is transferred -- that fleet's absolute efficiency is not representative of other ` +
      `facility classes. Cooling technology is not published per facility, so the same gradient is applied to every ` +
      `cooling type.`,
  };
}
