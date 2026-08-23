// Trains the revealed-preference siting model and emits
// public/data/siting-model.json.
//
// ============================================================================
// RESULT: NEGATIVE. THIS MODEL IS NOT WIRED INTO THE APP, AND SHOULD NOT BE
// UNTIL THE FEATURE SET IMPROVES. Recorded here so the finding is not lost.
// ============================================================================
//
// Posed as the question the product actually needs -- "rank viable candidate
// locations by how strong a data-centre ecosystem they support" -- held-out
// performance is near-useless:
//     Spearman 0.142 (full) / 0.256 (siting-only), R-squared 0.028 / 0.052
//     among already-built cells only: Spearman 0.134 / 0.083
// Train Spearman was 0.35, so this is a genuine generalisation failure rather
// than underfitting. Univariate rank correlations between every feature and
// log1p(netCount) are below |0.15| with one exception, confirming the signal
// is absent from the data rather than lost by the fit.
//
// An earlier binary formulation looked far better (held-out AUC 0.843) but was
// measuring the wrong thing: with zero-cells drawn from all land, the model
// only had to separate wilderness from cities. It scored a remote Costa Rican
// town at 0.76 and Frankfurt -- the largest European hub -- at 0.57. Replacing
// the target with graded ecosystem strength and restricting zero-cells to
// plausible candidates removed that easy discrimination, and the apparent
// performance went with it.
//
// WHY IT FAILS: real siting is driven by land cost, power price and
// availability, tax incentives, fibre backbone topology, latency to demand,
// regulatory regime, and above all AGGLOMERATION -- operators build where
// operators already are. None of those are in this feature set, and most have
// no open global dataset. Climate, grid carbon and water stress, which are
// available, turn out to have almost no relationship with where the industry
// historically built (univariate |rho| <= 0.10).
//
// WHAT SURVIVES: distance to a submarine cable landing point is the strongest
// non-urbanisation predictor in every variant fitted (univariate Spearman
// -0.266; top-ranked coefficient in all four models). That is a real,
// reproducible result and it empirically connects the two halves of this
// project.
//
// TARGET -- log1p(netCount): the total number of networks present across all
// real facilities in a cell, i.e. how strong an interconnection ecosystem the
// industry has actually built there. Zero for candidate cells with no
// facility.
//
// This replaces a binary presence/absence target. Presence was trivially
// separable (held-out AUC 0.843) but measured the wrong thing: it ranked a
// remote Costa Rican town at 0.76 and Frankfurt -- the largest European hub --
// at 0.57, because it had learned "coastal and near a city". Separating
// wilderness from cities is easy and useless; ranking viable candidates
// against each other is the question a siting tool exists to answer, and it
// needs a graded target rather than a binary one.
//
// RANK CORRELATION IS THE HEADLINE METRIC, not R-squared. The product uses
// this model to ORDER candidate locations, so how well the predicted order
// matches the real order is what matters; R-squared additionally penalises
// scale error that a ranking never sees.
//
// MODEL CHOICE -- L2-regularised linear regression, implemented here rather
// than pulled from a library. Three reasons, in order of importance:
//
//   1. It is interpretable BY CONSTRUCTION. Every prediction decomposes
//      exactly into per-feature contributions (standardised_value *
//      coefficient), so the UI can answer "why is this site scored this way"
//      with real numbers rather than a narrative. That is the product.
//   2. Training happens once at build time; inference is a dot product, so
//      the browser ships ~1 KB of coefficients instead of a model runtime.
//   3. It is auditable -- the whole fit is ~60 lines below, in the same
//      hand-rolled style as the rest of this project's numerics.
//
// VALIDATION IS SPATIALLY BLOCKED, NOT RANDOM. Neighbouring 1-degree cells
// are strongly correlated: a random train/test split would put a cell from
// Frankfurt in training and the cell next to it in test, and report an
// inflated score that reflects memorised geography rather than learned
// preference. Whole COUNTRIES are therefore assigned to either train or
// test, never split across both.
//
// TWO MODELS ARE FITTED AND BOTH ARE REPORTED:
//   full        - all features, including the urbanisation controls
//   siting-only - urbanisation controls REMOVED
// The gap between them is the honest measure of how much of the signal is
// "data centres are in cities" versus genuine siting characteristics. A
// siting-only model that collapses to near-chance would mean the model has
// no independent siting signal, and that must be reported, not hidden.
import { readFileSync, writeFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE = join(__dirname, ".cache");
const OUT = join(__dirname, "..", "public", "data");
const SEED = 20260823;

const TRAINING_SET = join(CACHE, "siting-training-set.json");
if (!existsSync(TRAINING_SET)) {
  console.error("Missing scripts/.cache/siting-training-set.json -- run build-siting-features.mjs first.");
  process.exit(1);
}

function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Feature definitions. `transform` is applied before standardisation --
 * distances and populations are heavily right-skewed, and a log makes their
 * relationship to log-odds far closer to linear (which is what logistic
 * regression assumes). `urbanisation: true` marks the confounder controls
 * that the siting-only model drops.
 */
// FEATURE SET, PRUNED FOR COLLINEARITY.
//
// The first fit used five temperature features (mean, warmest-month, cool-month
// fraction, annual range, warmest-month wet bulb). Measured pairwise
// correlations among them ran |r| = 0.82-0.90 -- they are all essentially one
// underlying climate-zone factor. Under that much collinearity the individual
// coefficients are arbitrary: the fit produced +1.94 on wet bulb against
// -1.86 on mean temperature (a see-saw that nearly cancels), and +1.64 on
// cool-month fraction whose univariate correlation with the label is -0.016.
// Predictive power was fine; per-feature attribution was worthless -- and
// per-feature attribution is the entire reason this model is a logistic
// regression rather than something stronger.
//
// Two temperature features are kept, chosen on engineering meaning rather
// than fit quality:
//   warmestMonthWetBulbC - governs evaporative/adiabatic cooling capability
//                          and is what a cooling plant must be sized for
//   tempRangeC           - continentality; distinct from absolute warmth
// All remaining pairs are below |r| = 0.7, so coefficients can be read
// individually. The dropped fields are still collected in the training set
// and remain available for later work.
const FEATURES = [
  { name: "warmestMonthWetBulbC", get: (r) => r.warmestMonthWetBulbC, label: "Warmest-month wet-bulb temperature" },
  { name: "tempRangeC", get: (r) => r.tempRangeC, label: "Annual temperature range" },
  { name: "carbonIntensity", get: (r) => r.carbonIntensityGco2PerKwh, label: "Grid carbon intensity" },
  { name: "waterStress", get: (r) => r.waterStressScore, label: "Baseline water stress" },
  { name: "logLandingPointKm", get: (r) => Math.log1p(r.nearestLandingPointKm), label: "Distance to cable landing point (log)" },
  { name: "logCityDistanceKm", get: (r) => Math.log1p(r.nearestCityDistanceKm), label: "Distance to major city (log)", urbanisation: true },
  { name: "logCityPopulation", get: (r) => Math.log1p(r.nearestCityPopulation), label: "Nearest-city population (log)", urbanisation: true },
];

/** Regression target: interconnection-ecosystem strength actually built in the cell. log1p keeps the heavy right tail (Ashburn dwarfs everything) from dominating the fit. */
const TARGET = (r) => Math.log1p(r.netCount ?? 0);

/** Largest absolute pairwise correlation among the given features -- printed so the collinearity claim above is verified at every run, not asserted. */
function maxAbsCorrelation(featureSet, data) {
  const cols = featureSet.map((f) => data.map(f.get));
  const corr = (a, b) => {
    const n = a.length;
    const ma = a.reduce((x, y) => x + y, 0) / n;
    const mb = b.reduce((x, y) => x + y, 0) / n;
    let num = 0, da = 0, db = 0;
    for (let i = 0; i < n; i++) {
      const x = a[i] - ma, y = b[i] - mb;
      num += x * y; da += x * x; db += y * y;
    }
    return num / Math.sqrt(da * db);
  };
  let worst = { r: 0, a: "", b: "" };
  for (let i = 0; i < cols.length; i++)
    for (let j = i + 1; j < cols.length; j++) {
      const r = corr(cols[i], cols[j]);
      if (Math.abs(r) > Math.abs(worst.r)) worst = { r, a: featureSet[i].name, b: featureSet[j].name };
    }
  return worst;
}

const raw = JSON.parse(readFileSync(TRAINING_SET, "utf-8"));
const rows = raw.rows.filter((r) => FEATURES.every((f) => Number.isFinite(f.get(r))));
console.log(`Loaded ${raw.rows.length} rows, ${rows.length} with all features finite`);

// --- spatially blocked split by country ------------------------------------
const rng = makeRng(SEED);
const countries = [...new Set(rows.map((r) => r.iso3))];
const testCountries = new Set();
for (const c of countries) if (rng() < 0.25) testCountries.add(c);
const train = rows.filter((r) => !testCountries.has(r.iso3));
const test = rows.filter((r) => testCountries.has(r.iso3));
console.log(
  `Spatially blocked split: ${train.length} train / ${test.length} test ` +
    `(${countries.length - testCountries.size} vs ${testCountries.size} countries)`
);

function standardiser(featureSet, data) {
  return featureSet.map((f) => {
    const vals = data.map(f.get);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length) || 1;
    return { name: f.name, label: f.label, mean, sd };
  });
}

function design(featureSet, stats, data) {
  return data.map((r) => featureSet.map((f, i) => (f.get(r) - stats[i].mean) / stats[i].sd));
}

/** Batch gradient descent on the L2-penalised squared error. Deterministic. */
function fitRidge(X, y, { lambda = 1.0, lr = 0.35, iters = 8000 } = {}) {
  const n = X.length;
  const d = X[0].length;
  const w = new Array(d).fill(0);
  let b = 0;
  for (let it = 0; it < iters; it++) {
    const gw = new Array(d).fill(0);
    let gb = 0;
    for (let i = 0; i < n; i++) {
      let z = b;
      for (let j = 0; j < d; j++) z += w[j] * X[i][j];
      const err = z - y[i];
      for (let j = 0; j < d; j++) gw[j] += err * X[i][j];
      gb += err;
    }
    for (let j = 0; j < d; j++) w[j] -= lr * ((gw[j] * 2) / n + (lambda * w[j]) / n);
    b -= lr * ((gb * 2) / n);
  }
  return { w, b };
}

function predict(model, x) {
  let z = model.b;
  for (let j = 0; j < x.length; j++) z += model.w[j] * x[j];
  return z;
}

/** Fractional ranks with ties averaged -- shared by Spearman below. */
function rankOf(values) {
  const order = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const ranks = new Array(values.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[order[k][1]] = avg;
    i = j + 1;
  }
  return ranks;
}

function pearson(a, b) {
  const n = a.length;
  const ma = a.reduce((x, y) => x + y, 0) / n;
  const mb = b.reduce((x, y) => x + y, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma, y = b[i] - mb;
    num += x * y; da += x * x; db += y * y;
  }
  return num / Math.sqrt(da * db);
}

/** Spearman rank correlation -- how well predicted ORDER matches real order. */
const spearman = (a, b) => pearson(rankOf(a), rankOf(b));

/** Coefficient of determination against the held-out mean. */
function r2(pred, actual) {
  const m = actual.reduce((x, y) => x + y, 0) / actual.length;
  let ssRes = 0, ssTot = 0;
  for (let i = 0; i < actual.length; i++) {
    ssRes += (actual[i] - pred[i]) ** 2;
    ssTot += (actual[i] - m) ** 2;
  }
  return 1 - ssRes / ssTot;
}

function evaluate(featureSet, name) {
  const stats = standardiser(featureSet, train);
  const Xtr = design(featureSet, stats, train);
  const ytr = train.map(TARGET);
  const Xte = design(featureSet, stats, test);
  const yte = test.map(TARGET);

  const model = fitRidge(Xtr, ytr);
  const pTr = Xtr.map((x) => predict(model, x));
  const pTe = Xte.map((x) => predict(model, x));

  const spearmanTr = spearman(pTr, ytr);
  const spearmanTe = spearman(pTe, yte);
  const r2Te = r2(pTe, yte);
  // Ranking quality restricted to cells that actually host facilities: this
  // is the hardest and most product-relevant question -- among places the
  // industry did build, does the model order them correctly?
  const builtIdx = yte.map((v, i) => (v > 0 ? i : -1)).filter((i) => i >= 0);
  const spearmanBuilt =
    builtIdx.length > 10 ? spearman(builtIdx.map((i) => pTe[i]), builtIdx.map((i) => yte[i])) : NaN;
  const worst = maxAbsCorrelation(featureSet, train);

  console.log(`\n=== ${name} ===`);
  console.log(
    `  HELD-OUT Spearman ${spearmanTe.toFixed(3)}  (train ${spearmanTr.toFixed(3)})  |  held-out R2 ${r2Te.toFixed(3)}`
  );
  console.log(
    `  held-out Spearman among BUILT cells only (n=${builtIdx.length}): ` +
      `${Number.isNaN(spearmanBuilt) ? "n/a" : spearmanBuilt.toFixed(3)}`
  );
  console.log(`  worst pairwise feature correlation: ${worst.r.toFixed(3)} (${worst.a} <-> ${worst.b})`);
  console.log("  standardised coefficients (higher = more network presence):");
  featureSet
    .map((f, j) => ({ label: stats[j].label, w: model.w[j] }))
    .sort((a, b) => Math.abs(b.w) - Math.abs(a.w))
    .forEach((c) => console.log(`    ${c.w >= 0 ? "+" : "-"}${Math.abs(c.w).toFixed(3)}  ${c.label}`));

  return {
    model,
    stats,
    spearmanTrain: spearmanTr,
    spearmanHeldOut: spearmanTe,
    spearmanHeldOutBuiltOnly: spearmanBuilt,
    r2HeldOut: r2Te,
    worstCorrelation: worst,
  };
}

const sitingOnly = FEATURES.filter((f) => !f.urbanisation);
const fullResult = evaluate(FEATURES, "FULL MODEL (with urbanisation controls)");
const sitingResult = evaluate(sitingOnly, "SITING-ONLY MODEL (urbanisation controls removed)");

console.log(
  `\nUrbanisation contribution: held-out Spearman ${fullResult.spearmanHeldOut.toFixed(3)} -> ${sitingResult.spearmanHeldOut.toFixed(3)} ` +
    `when population/city-distance are removed (drop of ${(fullResult.spearmanHeldOut - sitingResult.spearmanHeldOut).toFixed(3)}).`
);

const output = {
  generatedAt: new Date().toISOString(),
  modelType: "L2-regularised linear regression",
  target:
    "log1p(netCount) -- total networks present across all real PeeringDB facilities in a 1-degree cell; 0 for candidate cells with no facility",
  provenance:
    "Trained at build time on real PeeringDB facility data (target) against NASA POWER climate normals, " +
    "OWID grid carbon intensity, WRI Aqueduct water stress, real TeleGeography landing-point distances, and " +
    "Natural Earth populated-place proxies. Zero-target cells are sampled only from PLAUSIBLE CANDIDATE locations " +
    "(within 250km of a populated place of 100k+), not from wilderness, so the model must discriminate among " +
    "viable sites rather than merely separating cities from empty land. Validation is spatially blocked by country. " +
    "This describes WHERE THE INDUSTRY HAS HISTORICALLY BUILT -- a revealed-preference association, not a causal " +
    "claim that these characteristics make a site good, and not a prediction of any individual project's success.",
  trainingRows: train.length,
  testRows: test.length,
  metrics: {
    metricNote:
      "Spearman rank correlation is the headline metric because the product ORDERS candidate locations; R-squared " +
      "additionally penalises scale error that a ranking never sees. 'builtOnly' restricts to held-out cells that " +
      "actually host facilities -- the hardest and most product-relevant comparison.",
    full: {
      spearmanTrain: fullResult.spearmanTrain,
      spearmanHeldOut: fullResult.spearmanHeldOut,
      spearmanHeldOutBuiltOnly: fullResult.spearmanHeldOutBuiltOnly,
      r2HeldOut: fullResult.r2HeldOut,
      worstFeatureCorrelation: fullResult.worstCorrelation,
    },
    sitingOnly: {
      spearmanTrain: sitingResult.spearmanTrain,
      spearmanHeldOut: sitingResult.spearmanHeldOut,
      spearmanHeldOutBuiltOnly: sitingResult.spearmanHeldOutBuiltOnly,
      r2HeldOut: sitingResult.r2HeldOut,
      worstFeatureCorrelation: sitingResult.worstCorrelation,
    },
  },
  full: {
    intercept: fullResult.model.b,
    features: fullResult.stats.map((s, j) => ({ ...s, coefficient: fullResult.model.w[j] })),
  },
  sitingOnly: {
    intercept: sitingResult.model.b,
    features: sitingResult.stats.map((s, j) => ({ ...s, coefficient: sitingResult.model.w[j] })),
  },
};

writeFileSync(join(OUT, "siting-model.json"), JSON.stringify(output));
console.log(`\nWrote public/data/siting-model.json (${(JSON.stringify(output).length / 1024).toFixed(1)} KB)`);
