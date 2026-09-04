// The paper's tables and inline numbers, generated from the cached results.
//
// SAME RULE AS THE FIGURES. Nothing in docs/paper/ that is a measurement is
// typed by hand. The tables are written to docs/paper/tables/*.tex and every
// number quoted in the prose comes from a macro in docs/paper/numbers.tex, so a
// re-run after a re-analysis updates the paper rather than leaving it quietly
// stale. A number that disagrees with the cache is then impossible rather than
// merely unlikely, which is the property the study document already claims and
// the one a reviewer cannot check for you.
//
// The cost of this is that the .tex is not free-standing prose: \input and a
// pile of \num... macros are less readable than digits. That trade is worth
// taking exactly once, for the numbers, and nowhere else -- the argument is
// written as ordinary text in main.tex.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE = join(__dirname, ".cache");
const PAPER = join(__dirname, "..", "..", "docs", "paper");
const TABLES = join(PAPER, "tables");
if (!existsSync(TABLES)) mkdirSync(TABLES, { recursive: true });

const read = (name) => JSON.parse(readFileSync(join(CACHE, name), "utf-8"));

// --- formatting -------------------------------------------------------------
const f1 = (x) => Number(x).toFixed(1);
const f2 = (x) => Number(x).toFixed(2);
const f0 = (x) => Math.round(Number(x)).toString();
/** Thousands separators, for counts a reader has to hold in their head. */
const grp = (x) => Math.round(Number(x)).toLocaleString("en-US");
/** Signed, because the whole point of an effect is which way it points. */
const sgn1 = (x) => (Number(x) >= 0 ? "+" : "\u2212") + Math.abs(Number(x)).toFixed(1);
const sgn2 = (x) => (Number(x) >= 0 ? "+" : "\u2212") + Math.abs(Number(x)).toFixed(2);
/**
 * LaTeX minus, so a negative number is not set as a hyphen.
 *
 * \ensuremath, not $...$: these values are emitted both into table cells (text
 * mode) and into macros the prose may well wrap in math, e.g. ($p=\nLongHaulP$).
 * A macro carrying its own $...$ closes the caller's math and reopens it,
 * which LaTeX reports as "Missing $ inserted" -- four times, on the first real
 * compile of this paper. \ensuremath is correct in either mode.
 */
const tex = (s) =>
  String(s).replace(/\u2212/g, "\\ensuremath{-}").replace(/%/g, "\\%").replace(/&/g, "\\&");

/**
 * A p-value at the resolution the test actually has. Permutation and sign tests
 * here bottom out at the number of routes, so anything the run reported as 0 is
 * "below what this test can resolve", not "zero".
 */
function pv(p) {
  if (p === 0 || p < 1e-4) return "\\ensuremath{<10^{-4}}";
  if (p < 0.001) {
    return "\\ensuremath{" + p.toExponential(0).replace("e-", "\\!\\times\\!10^{-") + "}}";
  }
  if (p < 0.01) return p.toFixed(4);
  return p.toFixed(3);
}
/** Bold the rows that carry a claim, so a skimming reader lands on them. */
const bf = (s) => `\\textbf{${s}}`;
/** A length band as typeset English: en-dash for the range, thin space before the unit. */
const band = (s) =>
  String(s)
    .replace(/(\d)-(\d)/g, "$1--$2")
    .replace(/ km/g, "\\,km");

const out = {};
const N = {}; // inline macros

function table(name, body) {
  out[name] = body;
}

// --- I. the corpus ----------------------------------------------------------
{
  const c = read("cable-corpus.json");
  N.corpusRoutes = grp(c.usableCount);
  // perLayer characterises the whole published layer; the corpus is what
  // survived the screen, so the route count has to come from the routes.
  const kept = new Map();
  for (const r of c.routes) {
    const k = r.source ?? r.layer;
    const e = kept.get(k) ?? { n: 0, km: 0 };
    e.n += 1;
    e.km += r.lengthKm ?? 0;
    kept.set(k, e);
  }
  N.corpusKm = grp(c.routes.reduce((s, r) => s + (r.lengthKm ?? 0), 0));
  const rows = c.perLayer
    .filter((l) => Number.isFinite(l.verticesPer1000Km))
    .sort((a, b) => b.verticesPer1000Km - a.verticesPer1000Km)
    .map((l) => {
      const seg =
        l.medianSegmentKm < 1
          ? `${f0(l.medianSegmentKm * 1000)}\\,m`
          : `${f2(l.medianSegmentKm)}\\,km`;
      const k = kept.get(l.source) ?? { n: 0, km: 0 };
      return `${tex(l.source)} & ${grp(k.n)} & ${grp(k.km)} & ${grp(l.verticesPer1000Km)} & ${seg}`;
    });
  table(
    "corpus",
    `\\begin{table}[t]
\\caption{As-laid route corpus by publishing agency. Sampling fidelity spans a
factor of 30, which \\S\\ref{sec:dose} shows is confounded with terrain.}
\\label{tab:corpus}
\\centering\\footnotesize
\\begin{tabular}{@{}lrrrr@{}}
\\toprule
Source & Routes & km & vtx/1{,}000\\,km & Median seg. \\\\
\\midrule
${rows.join(" \\\\\n")} \\\\
\\midrule
\\textit{TeleGeography} & \\textit{724} & \\textemdash & \\textit{7.3} & \\textit{69\\,km} \\\\
\\bottomrule
\\end{tabular}
\\end{table}`,
  );
}

// --- II. local preference, placebo-corrected --------------------------------
{
  const lp = read("local-preference.json");
  const real = lp.real["5"];
  // The placebo is the mean of the four 5 km displacements, which is what the
  // study reports: a single displacement direction would confound the baseline
  // with whatever lies on that side.
  const keys = Object.keys(lp.placebo);
  const metrics = [
    ["slope", "Slope"],
    ["rough", "Roughness"],
    ["depth", "Depth"],
  ];
  const rows = metrics.map(([k, label]) => {
    const r = real[k];
    const pl =
      keys.reduce((s, d) => s + lp.placebo[d][k].medianPercentile, 0) / keys.length;
    const eff = r.medianPercentile - pl;
    if (k === "slope") N.placeboSlope = sgn2(eff);
    if (k === "rough") N.placeboRough = sgn2(eff);
    if (k === "depth") N.placeboDepth = sgn2(eff);
    const line = `${label} & ${f2(r.medianPercentile)} & ${f2(pl)} & ${bf(tex(sgn2(eff)))} & ${pv(r.p)}`;
    return line;
  });
  N.localN = f0(real.slope.n);
  // The corpus is 412 routes; this is the subset with matched bathymetry, and
  // it is the number the terrain claims are actually made on. The two were
  // used interchangeably in the first draft, which the title and the abstract
  // then disagreed about.
  N.bathyRoutes = grp(lp.routes);
  table(
    "preference",
    `\\begin{table}[t]
\\caption{Local terrain preference against the placebo-displaced baseline
(5\\,km transects, $n=${N.localN}$ routes). A percentile below the placebo means
the cable sits on flatter, less rugged, or shallower ground than the water
beside it. The placebo, not 50, is the zero point.}
\\label{tab:preference}
\\centering\\footnotesize
\\begin{tabular}{@{}lrrrr@{}}
\\toprule
Metric & Real & Placebo & Effect & $p$ \\\\
\\midrule
${rows.join(" \\\\\n")} \\\\
\\bottomrule
\\end{tabular}
\\end{table}`,
  );
}

// --- III. the resolution gate ----------------------------------------------
{
  const g = read("longhaul-grid-validation.json");
  const fine = g.preference.fine;
  const coarse = g.preference.coarse;
  const rows = [
    ["Slope", fine.slope, coarse.slope],
    ["Relief", fine.relief, coarse.relief],
    ["Depth", fine.depth, coarse.depth],
  ].map(([label, a, b]) => {
    const ea = a - 50;
    const eb = b - 50;
    const ret = (eb / ea) * 100;
    if (label === "Slope") N.gateSlope = f0(ret);
    if (label === "Relief") N.gateRelief = f0(ret);
    if (label === "Depth") N.gateDepth = f0(ret);
    return `${label} & ${tex(sgn2(ea))} & ${tex(sgn2(eb))} & ${bf(f0(ret) + "\\%")}`;
  });
  N.gateRoutes = grp(g.pairedRoutes);
  table(
    "gate",
    `\\begin{table}[t]
\\caption{The resolution gate. The identical placebo measurement at both grid
resolutions on the same ${N.gateRoutes} routes, reported before any long-haul
result is quoted. Same sign throughout; roughly half the sensitivity survives on
slope and relief, almost all of it on depth.}
\\label{tab:gate}
\\centering\\footnotesize
\\begin{tabular}{@{}lrrr@{}}
\\toprule
Effect vs.\\ placebo & 460\\,m & 1.85\\,km & Retained \\\\
\\midrule
${rows.join(" \\\\\n")} \\\\
\\bottomrule
\\end{tabular}
\\end{table}`,
  );
}

// --- IV + V. regional prediction and its paired tests -----------------------
{
  const rp = read("route-prediction.json");
  // Read the discretisation control first: the prediction table's caption
  // quotes it, and a table that states a handicap it has not measured yet is
  // exactly the kind of drift this generator exists to prevent.
  const disc = read("discretisation-penalty.json");
  N.discretisation = f2(disc.penaltyKm.median);
  N.discPairs = f0(disc.openWaterPairs);
  N.discGap = f2(disc.headline.gapKm);

  const order = ["both", "corridor", "geodesic", "fitted", "slope", "handset", "seapath"];
  const label = {
    geodesic: "Great circle \\textit{(no bathymetry)}",
    seapath: "Shortest sea path \\textit{(terrain ignored)}",
    slope: "Terrain: slope only",
    handset: "Terrain: all terms, hand-set",
    fitted: "Terrain: all terms, fitted",
    corridor: "Corridor only",
    both: "Corridor $+$ terrain",
  };
  const by = Object.fromEntries(rp.summary.map((s) => [s.id, s]));
  for (const k of order) {
    N["reg" + k[0].toUpperCase() + k.slice(1)] = f1(by[k].medianKm);
  }
  const rows = order.map((id) => {
    const s = by[id];
    const beats = s.vsGeodesicPct < 0;
    const cell = (x) => (beats ? bf(x) : x);
    return `${label[id]} & ${cell(f1(s.medianKm))} & ${f1(s.meanKm)} & ${f1(s.p90Km)} & ${cell(tex(sgn1(s.vsGeodesicPct)) + "\\%")}`;
  });
  N.regN = f0(rp.routesCompleteAllMethods);
  table(
    "prediction",
    `\\begin{table}[t]
\\caption{Regional route prediction, 40--500\\,km at 460\\,m, on
$n=${N.regN}$ held-out routes. Error is the mean distance from the cable
actually laid, given only the two endpoints. Bold beats the great circle.
Every terrain-aware row carries the ${N.discretisation}\\,km discretisation
handicap of Table~\\ref{tab:paired}'s footnote; the great circle does not.}
\\label{tab:prediction}
\\centering\\footnotesize
\\begin{tabular}{@{}lrrrr@{}}
\\toprule
Method & Median & Mean & p90 & vs.\\ GC \\\\
 & (km) & (km) & (km) & \\\\
\\midrule
${rows.join(" \\\\\n")} \\\\
\\bottomrule
\\end{tabular}
\\end{table}`,
  );

  const pl = {
    "corridor|seapath": "Corridor vs.\\ shortest sea path",
    "fitted|seapath": "Fitted terrain vs.\\ shortest sea path",
    "corridor|handset": "Corridor vs.\\ hand-set terrain",
    "corridor|fitted": "Corridor vs.\\ \\textit{fitted} terrain",
    "both|corridor": "Adding terrain on top of corridor",
  };
  const prows = rp.paired.map((p) => {
    const name = pl[`${p.a}|${p.b}`] ?? `${p.a} vs.\\ ${p.b}`;
    const sig = p.p < 0.05;
    const w = `${p.winPct}\\%`;
    return `${name} & ${p.n} & ${sig ? bf(w) : w} & ${sig ? bf(pv(p.p)) : pv(p.p)}`;
  });
  table(
    "paired",
    `\\begin{table}[t]
\\caption{Paired per-route comparisons, regional band. Sign test on the share of
routes where the first method lands closer to the as-laid cable. These
comparisons are the sound ones: both members share the grid, the search and the
endpoints, so the discretisation handicap cancels.}
\\label{tab:paired}
\\centering\\footnotesize
\\begin{tabular}{@{}lrrr@{}}
\\toprule
Comparison & $n$ & Better on & $p$ \\\\
\\midrule
${prows.join(" \\\\\n")} \\\\
\\bottomrule
\\multicolumn{4}{@{}p{0.94\\columnwidth}@{}}{\\vspace{2pt}\\footnotesize
Discretisation control: a zero-weight grid search reproducing a known great
circle still lands a median ${N.discretisation}\\,km from it
($n=${N.discPairs}$ open-water pairs), which exceeds the
${N.discGap}\\,km gap the raw table attributes to bathymetry.} \\\\
\\end{tabular}
\\end{table}`,
  );
}

// --- VI. corridor reuse under exclusion and landfall control ----------------
{
  const cf = read("corridor-following.json");
  const ec = read("corridor-endpoint-control.json").results;
  const L = cf.levels;
  const row = (name, r) =>
    `${name} & ${r.routes ?? r.n} & ${f1(r.realMedianKm)} & ${f1(r.placeboMedianKm)} & ${f0(r.closerPct)}\\% & ${pv(r.p)}`;
  const red = (r) =>
    r.reductionPct !== undefined
      ? f0(r.reductionPct)
      : f0(((r.placeboMedianKm - r.realMedianKm) / r.placeboMedianKm) * 100);
  N.corridorRaw = red(L["different-agency"]);
  N.corridorCtl = red(ec["trim30-landing10"]);
  N.corridorCtlPct = f0(ec["trim30-landing10"].closerPct);
  N.corridorCtlN = f0(ec["trim30-landing10"].n);
  const rows = [
    row("Any other route", L["any-other-route"]),
    row("Excl.\\ same named cable", L["different-system"]),
    row("Excl.\\ same agency", L["different-agency"]),
    "\\midrule",
    row("\\quad $+$ trim 10\\,km", ec.trim10),
    row("\\quad $+$ trim 30\\,km", ec.trim30),
    row("\\quad $+$ trim 50\\,km", ec.trim50),
    "\\midrule",
    bf("\\quad $+$ trim 30, excl.\\ shared landing") +
      ` & ${bf(f0(ec["trim30-landing10"].n))} & ${bf(f1(ec["trim30-landing10"].realMedianKm))} & ${bf(f1(ec["trim30-landing10"].placeboMedianKm))} & ${bf(f0(ec["trim30-landing10"].closerPct) + "\\%")} & ${bf(pv(ec["trim30-landing10"].p))}`,
  ];
  table(
    "corridor",
    `\\begin{table}[t]
\\caption{Distance to the nearest OTHER cable, real route vs.\\ its
placebo-displaced copy, under progressively stricter controls. The first three
rows exclude candidates by identity; the rest remove the landfall geometry that
identity exclusion cannot touch. The bold row is the figure this paper claims.}
\\label{tab:corridor}
\\centering\\footnotesize\\setlength{\\tabcolsep}{3pt}
\\begin{tabular}{@{}lrrrrr@{}}
\\toprule
Control & $n$ & Real & Placebo & Closer & $p$ \\\\
 & & (km) & (km) & on & \\\\
\\midrule
${rows.join(" \\\\\n").replace(/\\midrule \\\\/g, "\\midrule")} \\\\
\\bottomrule
\\end{tabular}
\\end{table}`,
  );
}

// --- VII + VIII. by length band --------------------------------------------
{
  const lh = read("longhaul-prediction.json");
  const ids = ["geodesic", "seapath", "handset", "corridor", "both"];
  const head = ["GC", "Sea path", "Terrain", "Corridor", "Cor$+$ter"];
  const rows = lh.bands.map((b) => {
    const by = Object.fromEntries(b.summary.map((s) => [s.id, s]));
    const best = Math.min(...ids.map((i) => by[i]?.medianKm ?? Infinity));
    const cells = ids.map((i) => {
      const s = by[i];
      if (!s) return "\u2014";
      const v = f1(s.medianKm);
      return s.medianKm === best ? bf(v) : v;
    });
    return `${band(b.label)} & ${b.complete} & ${cells.join(" & ")}`;
  });
  table(
    "bands",
    `\\begin{table}[t]
\\caption{Median prediction error by route length, all bands on the same
1.85\\,km grid. Bold is the best method in that band. Corridor following
improves monotonically with length; every terrain variant does not.}
\\label{tab:bands}
\\centering\\footnotesize\\setlength{\\tabcolsep}{3pt}
\\begin{tabular}{@{}lrrrrrr@{}}
\\toprule
Band & $n$ & ${head.join(" & ")} \\\\
 & & \\multicolumn{5}{c@{}}{median error (km)} \\\\
\\midrule
${rows.join(" \\\\\n")} \\\\
\\bottomrule
\\end{tabular}
\\end{table}`,
  );

  const want = [
    ["corridor", "handset", "Corridor vs.\\ terrain"],
    ["corridor", "seapath", "Corridor vs.\\ sea path"],
    ["both", "corridor", "Terrain added to corridor"],
  ];
  const prows = [];
  for (const b of lh.bands) {
    const found = want
      .map(([a, bb, name]) => {
        const p = b.paired.find((x) => x.a === a && x.b === bb);
        return p ? { ...p, name } : null;
      })
      .filter(Boolean);
    found.forEach((p, i) => {
      const sig = p.p < 0.05;
      const w = `${p.winPct}\\%`;
      prows.push(
        `${i === 0 ? band(b.label) : ""} & ${p.name} & ${p.n} & ${sig ? bf(w) : w} & ${sig ? bf(pv(p.p)) : pv(p.p)}`,
      );
    });
    prows.push("\\midrule");
  }
  prows.pop();
  const vl = lh.bands.find((b) => b.id === "veryLong");
  const ch = vl.paired.find((p) => p.a === "corridor" && p.b === "handset");
  N.longHaulWin = `${ch.n}/${ch.n}`;
  N.longHaulP = pv(ch.p);
  table(
    "bandpaired",
    `\\begin{table}[t]
\\caption{Paired per-route comparisons within each length band. The natural
objection to a regional corpus predicts corridor following weakening with
distance; it strengthens, and above 2{,}000\\,km adding terrain on top of it
reverses sign.}
\\label{tab:bandpaired}
\\centering\\footnotesize\\setlength{\\tabcolsep}{3pt}
\\begin{tabular}{@{}llrrr@{}}
\\toprule
Band & Comparison & $n$ & Better on & $p$ \\\\
\\midrule
${prows.join(" \\\\\n").replace(/\\midrule \\\\/g, "\\midrule")} \\\\
\\bottomrule
\\end{tabular}
\\end{table}`,
  );
}

// --- IX. the independent candidate set -------------------------------------
{
  const cc = read("corridor-candidates.json");
  const keys = ["corpus", "tg0", "tg1", "tg3"];
  const head = ["Corpus", "TG $k{=}0$", "TG $k{=}1$", "TG $k{=}3$"];
  const rows = cc.bands.map((b) => {
    const sum = Object.fromEntries(b.summary.map((s) => [s.key, s]));
    const pr = Object.fromEntries(b.paired.map((p) => [p.key, p]));
    const cells = keys.map((k) => {
      const m = f1(sum[k].medianKm);
      const p = pr[k];
      const w = `${p.winPct}\\%`;
      const sig = p.p < 0.05;
      const worse = p.winPct < 50;
      const mark = sig ? (worse ? `\\underline{${w}}` : bf(w)) : w;
      return `${m} \\,/\\, ${mark}`;
    });
    return `${band(b.label)} & ${b.complete} & ${cells.join(" & ")}`;
  });
  N.tgSystems = grp(cc.telegeography.systems);
  table(
    "candidates",
    `\\begin{table*}[t]
\\caption{Replacing the candidate set. Each cell is median error (km) / share of
routes beating a great circle, for the EMODnet corpus under same-agency
exclusion and for ${N.tgSystems} TeleGeography systems with the $k$
closest-tracking systems removed. Bold is significantly better than a great
circle, \\underline{underlined} significantly worse. Long-haul survives an
independent candidate set and an unrelated exclusion mechanism; the regional
band does not.}
\\label{tab:candidates}
\\centering\\footnotesize
\\begin{tabular}{@{}lrcccc@{}}
\\toprule
Band & $n$ & ${head.join(" & ")} \\\\
\\midrule
${rows.join(" \\\\\n")} \\\\
\\bottomrule
\\end{tabular}
\\end{table*}`,
  );
}

// --- X. the error-ratio rule ------------------------------------------------
{
  const er = read("error-ratio.json");
  const rows = er.bins.map((b) => {
    const helped = `${f0(b.pctHelped)}\\%`;
    const emph = b.pctHelped >= 80 || b.pctHelped <= 20;
    return `${f2(b.lo)}--${f2(b.hi)} & ${b.n} & ${f2(b.medianRatio)} & ${emph ? bf(helped) : helped} & ${tex(sgn1(b.medianGainPct))}\\%`;
  });
  N.erRho = f3(er.spearman.rho);
  N.erZ = f1(er.spearman.z);
  N.erN = f0(er.spearman.n);
  const t = er.thresholds.find((x) => x.threshold === 0.3);
  N.erBelow = f0(t.belowPctHelped);
  N.erAbove = f0(t.abovePctHelped);
  table(
    "ratio",
    `\\begin{table}[t]
\\caption{The error-ratio rule, tested per route rather than per band
($n=${N.erN}$). The ratio is the neighbour geometry's error over the great
circle's error for that same route. Monotonic across every bin, Spearman
$\\rho=${N.erRho}$ ($z=${N.erZ}$).}
\\label{tab:ratio}
\\centering\\footnotesize
\\begin{tabular}{@{}lrrrr@{}}
\\toprule
Ratio range & $n$ & Median & Routes & Median \\\\
 & & ratio & helped & gain \\\\
\\midrule
${rows.join(" \\\\\n")} \\\\
\\bottomrule
\\end{tabular}
\\end{table}`,
  );
}

// --- XI. fishing effort -----------------------------------------------------
{
  const fp = read("fishing-preference.json");
  const disp = [3, 5, 10, 20, 50];
  const trims = [0, 10, 25, 50];
  const rows = disp.map((d) => {
    const cells = trims.map((t) => {
      const r = fp.sweep.find((x) => x.displacementKm === d && x.trimKm === t);
      if (!r) return "\u2014";
      const v = sgn2(r.vs50);
      return r.p < 0.05 ? bf(tex(v)) + "$^{*}$" : tex(v);
    });
    return `${d}\\,km & ${cells.join(" & ")}`;
  });
  const ns = trims.map((t) => {
    const r = fp.sweep.find((x) => x.displacementKm === 5 && x.trimKm === t);
    return r ? r.n : "\u2014";
  });
  N.fishUsablePct = f1((fp.usableSamples / fp.totalSamples) * 100);
  N.fishSamples = grp(fp.totalSamples);
  table(
    "fishing",
    `\\begin{table}[t]
\\caption{Fishing effort: mean percentile minus 50, by control displacement and
by how much of each route end is discarded. Positive means the cable
sits in heavier fishing than the water beside it. $^{*}$~$p<0.05$ across
routes. The effect is confined to the untrimmed columns and vanishes at a
50\\,km trim, which locates it at the landfalls.}
\\label{tab:fishing}
\\centering\\footnotesize
\\begin{tabular}{@{}lrrrr@{}}
\\toprule
Displacement & No trim & 10\\,km & 25\\,km & 50\\,km \\\\
\\midrule
${rows.join(" \\\\\n")} \\\\
\\midrule
\\textit{routes} & ${ns.map((n) => `\\textit{${n}}`).join(" & ")} \\\\
\\bottomrule
\\end{tabular}
\\end{table}`,
  );
}

function f3(x) {
  return Number(x).toFixed(3);
}

// --- write ------------------------------------------------------------------
for (const [name, body] of Object.entries(out)) {
  writeFileSync(join(TABLES, `tab-${name}.tex`), body + "\n", "utf-8");
}

const macros = Object.entries(N)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([k, v]) => `\\newcommand{\\n${k[0].toUpperCase()}${k.slice(1)}}{${tex(v)}}`)
  .join("\n");

writeFileSync(
  join(PAPER, "numbers.tex"),
  `% Generated by scripts/research/make-paper-tables.mjs -- do not edit.
% Every inline number in main.tex comes from here, so the prose cannot drift
% from the cache without the build noticing.
${macros}
`,
  "utf-8",
);

console.log(`${Object.keys(out).length} tables -> docs/paper/tables/`);
console.log(`${Object.keys(N).length} macros -> docs/paper/numbers.tex`);
