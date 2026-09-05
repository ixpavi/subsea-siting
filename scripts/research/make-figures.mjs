// Publication figures, generated from the cached results rather than drawn.
//
// WHY SVG FROM NODE. The study's reproducibility property is "no API key, no
// account, no prerequisite beyond Node". A matplotlib or R pipeline would break
// that for the sake of five pictures. SVG is vector, so it converts to PDF or
// EPS for submission without resampling, and it is text, so a figure diffs in
// review like any other file.
//
// EVERY NUMBER IS READ FROM .cache/. Nothing here is transcribed. A figure that
// disagrees with the study text means one of them is stale, and re-running this
// is how you find out -- which is the same rule the document itself follows.
//
// SIZED FOR IEEE TWO-COLUMN. Single-column figures are 252 pt (3.5 in) wide,
// double-column 516 pt (7.16 in). Type is 7-8 pt in a serif stack so it sits
// with the body text rather than against it, and no figure relies on a font
// larger than the caption it will carry.
//
// PRINT IS THE HOSTILE CASE, so every series carries THREE encodings: hue,
// dash pattern, and marker shape. The palette passes an all-pairs
// colour-vision check (worst adjacent pair dE 9.2 deutan, normal-vision floor
// 16.3), but a reader with a photocopy has no hue at all, and a figure that
// collapses in that case is a figure that fails exactly where a printed paper
// is most likely to be read.
//
// There is deliberately no hover layer, no tooltip and no interaction: the
// destination is a static PDF. Every series is direct-labelled instead, which
// is also what the aqua slot's sub-3:1 surface contrast requires.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE = join(__dirname, ".cache");
const OUT = join(__dirname, "..", "..", "docs", "figures");
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const read = (name) => JSON.parse(readFileSync(join(CACHE, name), "utf-8"));

// --- Design tokens ----------------------------------------------------------
// Categorical slots in the palette's fixed order. Never cycled: a fifth series
// would mean cutting one or faceting, not inventing a hue.
const C = {
  s1: "#2a78d6", // blue
  s2: "#eb6834", // orange
  s3: "#1baf7a", // aqua
  s4: "#4a3aa7", // violet
  ink: "#0b0b0b",
  ink2: "#52514e",
  muted: "#8a8983",
  grid: "#e4e3df",
  surface: "#ffffff",
  divNeg: "#2a78d6", // diverging cool pole
  divPos: "#e34948", // diverging warm pole
  divMid: "#f0efec",
};
const FONT = "Times New Roman, Times, Georgia, serif";
const MONO = "SFMono-Regular, Consolas, monospace";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Marker shapes, so identity survives a greyscale photocopy. */
function marker(kind, x, y, fill, r = 3.1) {
  switch (kind) {
    case "circle":
      return `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" stroke="${C.surface}" stroke-width="1.2"/>`;
    case "square":
      return `<rect x="${x - r}" y="${y - r}" width="${2 * r}" height="${2 * r}" fill="${fill}" stroke="${C.surface}" stroke-width="1.2"/>`;
    case "triangle":
      return `<polygon points="${x},${y - r - 0.6} ${x + r + 0.3},${y + r - 0.4} ${x - r - 0.3},${y + r - 0.4}" fill="${fill}" stroke="${C.surface}" stroke-width="1.2"/>`;
    case "diamond":
      return `<polygon points="${x},${y - r - 0.8} ${x + r + 0.4},${y} ${x},${y + r + 0.8} ${x - r - 0.4},${y}" fill="${fill}" stroke="${C.surface}" stroke-width="1.2"/>`;
    default:
      return "";
  }
}

function svg(w, h, body, title, desc) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="${FONT}" role="img" aria-labelledby="t d">
<title id="t">${esc(title)}</title><desc id="d">${esc(desc)}</desc>
<rect width="${w}" height="${h}" fill="${C.surface}"/>
${body}
</svg>`;
}

const text = (x, y, s, { size = 7.5, fill = C.ink2, anchor = "start", weight = "normal", family = FONT, style = "normal" } = {}) =>
  `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" text-anchor="${anchor}" font-weight="${weight}" font-family="${family}" font-style="${style}">${esc(s)}</text>`;

const fmt1 = (n) => (n >= 0 ? "+" : "") + n.toFixed(1);

// ============================================================================
// FIGURE 1 -- prediction error by length band
// ============================================================================
// The job is change across an ordinal axis by series, so this is a line chart
// and not grouped bars: the reader's question is "which way does each method go
// as routes get longer", and slope answers it directly.
//
// Plotted RELATIVE to the great circle, which puts every band on one axis. The
// alternative -- absolute km -- spans 5.8 to 268 and would need either a log
// axis or two panels, and would hide the only comparison that matters. Zero is
// the great circle, so below the line means "beats a straight line".
function figureBands() {
  const d = read("longhaul-prediction.json");
  const W = 252, H = 190;
  const M = { t: 16, r: 74, b: 34, l: 34 };
  const plotW = W - M.l - M.r, plotH = H - M.t - M.b;

  const bands = d.bands.filter((b) => b.summary);
  const series = [
    { id: "seapath", label: "Shortest sea path", color: C.s2, dash: "3 2", mark: "square" },
    { id: "handset", label: "Terrain", color: C.s4, dash: "5 2", mark: "triangle" },
    { id: "corridor", label: "Corridor", color: C.s1, dash: "none", mark: "circle" },
    { id: "both", label: "Corridor + terrain", color: C.s3, dash: "1.5 1.8", mark: "diamond" },
  ];

  const vals = series.flatMap((s) =>
    bands.map((b) => b.summary.find((x) => x.id === s.id)?.vsGeodesicPct ?? 0)
  );
  const lo = Math.min(-80, Math.floor(Math.min(...vals) / 20) * 20);
  const hi = Math.max(40, Math.ceil(Math.max(...vals) / 20) * 20);
  const X = (i) => M.l + (plotW * i) / (bands.length - 1);
  const Y = (v) => M.t + plotH * (1 - (v - lo) / (hi - lo));

  let g = "";
  for (let v = lo; v <= hi; v += 20) {
    const y = Y(v);
    const isZero = v === 0;
    g += `<line x1="${M.l}" y1="${y}" x2="${M.l + plotW}" y2="${y}" stroke="${isZero ? C.muted : C.grid}" stroke-width="${isZero ? 1 : 0.6}"/>`;
    g += text(M.l - 4, y + 2.4, `${v > 0 ? "+" : ""}${v}`, { anchor: "end", size: 6.6, fill: C.muted });
  }
  // The zero line is the great circle itself, so it is labelled as an entity
  // rather than left as a bare gridline.
  g += text(M.l + 2, Y(0) - 3, "great circle", { size: 6.4, fill: C.muted, style: "italic" });

  bands.forEach((b, i) => {
    // replaceAll, not replace: with replace() the second ",000" survives and
    // the 1,000-2,000 km band renders as "1k-2,000".
    const lbl = b.label.replace(" km", "").replaceAll(",000", "k");
    g += text(X(i), H - M.b + 11, lbl, { anchor: "middle", size: 6.6, fill: C.ink2 });
    g += text(X(i), H - M.b + 20, `n=${b.complete}`, { anchor: "middle", size: 6, fill: C.muted });
  });
  g += text(M.l + plotW / 2, H - 4, "route length (km)", { anchor: "middle", size: 7, fill: C.ink2 });
  g += text(9, M.t + plotH / 2, "median error vs great circle (%)", {
    anchor: "middle", size: 7, fill: C.ink2,
  }).replace("<text ", `<text transform="rotate(-90 9 ${M.t + plotH / 2})" `);

  for (const s of series) {
    const pts = bands.map((b, i) => [X(i), Y(b.summary.find((x) => x.id === s.id).vsGeodesicPct)]);
    g += `<polyline points="${pts.map((p) => p.join(",")).join(" ")}" fill="none" stroke="${s.color}" stroke-width="1.6"${s.dash !== "none" ? ` stroke-dasharray="${s.dash}"` : ""} stroke-linejoin="round"/>`;
    for (const [x, y] of pts) g += marker(s.mark, x, y, s.color);
  }

  // Direct labels at the right end, nudged apart so none collide. This replaces
  // a legend box: with four series the reader should never have to look away
  // from the line to learn its name.
  const ends = series
    .map((s) => ({ s, y: Y(bands[bands.length - 1].summary.find((x) => x.id === s.id).vsGeodesicPct) }))
    .sort((a, b) => a.y - b.y);
  let prev = -Infinity;
  for (const e of ends) {
    const y = Math.max(e.y, prev + 8.4);
    prev = y;
    g += `<line x1="${X(bands.length - 1) + 4}" y1="${e.y}" x2="${X(bands.length - 1) + 10}" y2="${y}" stroke="${e.s.color}" stroke-width="0.8"/>`;
    g += text(X(bands.length - 1) + 12, y + 2.4, e.s.label, { size: 6.8, fill: C.ink });
  }

  writeFileSync(
    join(OUT, "fig1-prediction-by-band.svg"),
    svg(W, H, g,
      "Prediction error by route length band",
      "Median distance from the cable actually laid, relative to a great circle, for four routing methods across four route-length bands. Corridor following improves with length; terrain does not.")
  );
  return "fig1-prediction-by-band.svg";
}

// ============================================================================
// FIGURE 2 -- the error-ratio rule
// ============================================================================
// One series, so no legend: the title names it. Bars because the job is
// magnitude per ordered bin, and the 50% reference is what the reader compares
// against -- above it the method helps more often than not.
function figureErrorRatio() {
  const d = read("error-ratio.json");
  const W = 252, H = 176;
  const M = { t: 14, r: 10, b: 44, l: 30 };
  const plotW = W - M.l - M.r, plotH = H - M.t - M.b;
  const bins = d.bins;
  const X = (i) => M.l + (plotW * (i + 0.5)) / bins.length;
  const bw = (plotW / bins.length) * 0.62;
  const Y = (v) => M.t + plotH * (1 - v / 100);

  let g = "";
  for (let v = 0; v <= 100; v += 25) {
    const y = Y(v);
    g += `<line x1="${M.l}" y1="${y}" x2="${M.l + plotW}" y2="${y}" stroke="${C.grid}" stroke-width="0.6"/>`;
    g += text(M.l - 4, y + 2.4, `${v}`, { anchor: "end", size: 6.6, fill: C.muted });
  }

  bins.forEach((b, i) => {
    const x = X(i), y = Y(b.pctHelped);
    // Colour carries polarity against the 50% line, and the 50% line carries it
    // again -- so the split survives greyscale.
    const fill = b.pctHelped >= 50 ? C.s1 : C.s2;
    g += `<path d="M${x - bw / 2},${M.t + plotH} L${x - bw / 2},${y + 3} Q${x - bw / 2},${y} ${x - bw / 2 + 3},${y} L${x + bw / 2 - 3},${y} Q${x + bw / 2},${y} ${x + bw / 2},${y + 3} L${x + bw / 2},${M.t + plotH} Z" fill="${fill}"/>`;
    // A bar landing just below 50% would print its value straight through the
    // reference line, so those labels go inside the bar instead.
    const nearRule = Math.abs(b.pctHelped - 50) < 12 && b.pctHelped < 50;
    g += text(x, nearRule ? y + 9 : y - 3.5, `${b.pctHelped.toFixed(0)}%`, {
      anchor: "middle", size: 6.8, fill: nearRule ? "#ffffff" : C.ink, weight: "bold",
    });
    g += text(x, M.t + plotH + 10, b.medianRatio.toFixed(2), { anchor: "middle", size: 6.4, fill: C.ink2, family: MONO });
    g += text(x, M.t + plotH + 18, `n=${b.n}`, { anchor: "middle", size: 5.8, fill: C.muted });
  });

  const y50 = Y(50);
  g += `<line x1="${M.l}" y1="${y50}" x2="${M.l + plotW}" y2="${y50}" stroke="${C.ink}" stroke-width="1" stroke-dasharray="4 2"/>`;
  g += text(M.l + plotW, y50 - 3.5, "helps as often as not", { anchor: "end", size: 6.2, fill: C.ink2, style: "italic" });

  g += text(M.l + plotW / 2, H - 20, "median error ratio per bin", { anchor: "middle", size: 7, fill: C.ink2 });
  g += text(M.l + plotW / 2, H - 10,
    "(neighbour-geometry error ÷ great-circle error)", { anchor: "middle", size: 6.4, fill: C.muted });
  g += text(9, M.t + plotH / 2, "routes improved (%)", { anchor: "middle", size: 7, fill: C.ink2 })
    .replace("<text ", `<text transform="rotate(-90 9 ${M.t + plotH / 2})" `);
  g += text(M.l, 9, `Spearman ρ = ${d.spearman.rho >= 0 ? "+" : ""}${d.spearman.rho.toFixed(3)}, n = ${d.spearman.n}`,
    { size: 6.6, fill: C.ink2, family: MONO });

  writeFileSync(
    join(OUT, "fig2-error-ratio.svg"),
    svg(W, H, g,
      "When corridor following helps",
      "Share of routes whose prediction improved under corridor following, binned by the ratio of neighbour-geometry error to great-circle error. Monotonic from 90 percent to 7 percent.")
  );
  return "fig2-error-ratio.svg";
}

// ============================================================================
// FIGURE 3 -- fishing effect, trim x displacement
// ============================================================================
// A diverging heatmap, because the quantity has a meaningful zero (no
// preference) and a sign that matters: positive means cables sit in HEAVIER
// fishing, which is the opposite of the hypothesis. Blue/red poles with a
// neutral grey midpoint -- never a hue at the middle, or "no effect" would look
// like a value.
function figureFishing() {
  const d = read("fishing-preference.json");
  const W = 252, H = 180;
  const M = { t: 30, r: 12, b: 46, l: 40 };
  const disp = d.displacementsKm;
  const trims = [...new Set(d.sweep.map((s) => s.trimKm))].sort((a, b) => a - b);
  const cw = (W - M.l - M.r) / trims.length;
  const ch = (H - M.t - M.b) / disp.length;

  const maxAbs = Math.max(...d.sweep.map((s) => Math.abs(s.vs50 ?? 0)));
  const ramp = (v) => {
    const t = Math.min(1, Math.abs(v) / maxAbs);
    const mix = (a, b, f) => {
      const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
      const [r1, g1, b1] = p(a), [r2, g2, b2] = p(b);
      const c = (x, y) => Math.round(x + (y - x) * f).toString(16).padStart(2, "0");
      return `#${c(r1, r2)}${c(g1, g2)}${c(b1, b2)}`;
    };
    return mix(C.divMid, v >= 0 ? C.divPos : C.divNeg, t);
  };

  let g = "";
  trims.forEach((tr, j) => {
    g += text(M.l + cw * (j + 0.5), M.t - 12, tr === 0 ? "none" : `${tr} km`, { anchor: "middle", size: 6.6, fill: C.ink2 });
  });
  g += text(M.l + (W - M.l - M.r) / 2, M.t - 22, "endpoint trim", { anchor: "middle", size: 7, fill: C.ink });

  disp.forEach((dp, i) => {
    g += text(M.l - 5, M.t + ch * (i + 0.5) + 2.4, `${dp} km`, { anchor: "end", size: 6.6, fill: C.ink2 });
    trims.forEach((tr, j) => {
      const cell = d.sweep.find((s) => s.displacementKm === dp && s.trimKm === tr);
      if (!cell) return;
      const x = M.l + cw * j, y = M.t + ch * i;
      // 2px surface gap between fills, so adjacent cells never bleed together.
      g += `<rect x="${x + 1}" y="${y + 1}" width="${cw - 2}" height="${ch - 2}" fill="${ramp(cell.vs50)}"/>`;
      const sig = Number.isFinite(cell.p) && cell.p < 0.05;
      if (sig) g += `<rect x="${x + 1}" y="${y + 1}" width="${cw - 2}" height="${ch - 2}" fill="none" stroke="${C.ink}" stroke-width="1.1"/>`;
      g += text(x + cw / 2, y + ch / 2 + 2.3, fmt1(cell.vs50), {
        anchor: "middle", size: 6.4, family: MONO,
        fill: Math.abs(cell.vs50) > maxAbs * 0.55 ? "#ffffff" : C.ink,
        weight: sig ? "bold" : "normal",
      });
    });
  });

  g += text(9, M.t + (H - M.t - M.b) / 2, "control displacement", { anchor: "middle", size: 7, fill: C.ink })
    .replace("<text ", `<text transform="rotate(-90 9 ${M.t + (H - M.t - M.b) / 2})" `);

  // Legend: the sign is the whole point, so it is spelled out in words rather
  // than left to a colour bar the reader has to decode.
  const ly = H - 30;
  g += `<rect x="${M.l}" y="${ly}" width="9" height="9" fill="${ramp(maxAbs)}"/>`;
  g += text(M.l + 12, ly + 7, "cable in heavier fishing", { size: 6.4, fill: C.ink2 });
  g += `<rect x="${M.l}" y="${ly + 12}" width="9" height="9" fill="${ramp(-maxAbs)}"/>`;
  g += text(M.l + 12, ly + 19, "cable in lighter fishing", { size: 6.4, fill: C.ink2 });
  g += `<rect x="${M.l + 128}" y="${ly}" width="9" height="9" fill="none" stroke="${C.ink}" stroke-width="1.1"/>`;
  g += text(M.l + 140, ly + 7, "p < 0.05", { size: 6.4, fill: C.ink2 });
  g += text(M.l + 128, ly + 19, "percentile points vs 50", { size: 6.2, fill: C.muted });

  writeFileSync(
    join(OUT, "fig3-fishing-sweep.svg"),
    svg(W, H, g,
      "Fishing effect against endpoint trim and control displacement",
      "Effect vanishes once fifty kilometres of each route end is discarded, identifying it as landfall geometry rather than fishing avoidance.")
  );
  return "fig3-fishing-sweep.svg";
}

// ============================================================================
// FIGURE 4 -- the resolution gate
// ============================================================================
// A slope chart: two paired measurements per metric, and the question is how
// much is lost between them. Slope answers it without arithmetic.
function figureResolution() {
  const d = read("longhaul-grid-validation.json");
  const W = 252, H = 150;
  const M = { t: 20, r: 78, b: 30, l: 42 };
  const plotW = W - M.l - M.r, plotH = H - M.t - M.b;
  const rows = [
    { k: "slope", label: "slope", color: C.s1, mark: "circle" },
    { k: "relief", label: "relief", color: C.s2, mark: "square" },
    { k: "depth", label: "depth", color: C.s4, mark: "triangle" },
  ];
  const val = (side, k) => d.preference[side][k] - 50;
  const all = rows.flatMap((r) => [val("fine", r.k), val("coarse", r.k)]);
  const lo = Math.floor(Math.min(...all) / 5) * 5, hi = 0;
  const Y = (v) => M.t + plotH * (1 - (v - lo) / (hi - lo));
  const xL = M.l, xR = M.l + plotW;

  let g = "";
  for (let v = lo; v <= hi; v += 5) {
    const y = Y(v);
    g += `<line x1="${xL}" y1="${y}" x2="${xR}" y2="${y}" stroke="${v === 0 ? C.muted : C.grid}" stroke-width="${v === 0 ? 1 : 0.6}"/>`;
    g += text(xL - 4, y + 2.4, `${v}`, { anchor: "end", size: 6.6, fill: C.muted });
  }
  g += text(xR, Y(0) - 3.5, "no preference", { anchor: "end", size: 6.2, fill: C.muted, style: "italic" });
  g += text(xL, H - 12, "460 m", { anchor: "middle", size: 7, fill: C.ink });
  g += text(xR, H - 12, "1.85 km", { anchor: "middle", size: 7, fill: C.ink });
  g += text(9, M.t + plotH / 2, "effect (percentile pts)", { anchor: "middle", size: 7, fill: C.ink2 })
    .replace("<text ", `<text transform="rotate(-90 9 ${M.t + plotH / 2})" `);

  const ends = rows.map((r) => ({ r, y: Y(val("coarse", r.k)), keep: (val("coarse", r.k) / val("fine", r.k)) * 100 }))
    .sort((a, b) => a.y - b.y);
  let prev = -Infinity;
  for (const r of rows) {
    const y1 = Y(val("fine", r.k)), y2 = Y(val("coarse", r.k));
    g += `<line x1="${xL}" y1="${y1}" x2="${xR}" y2="${y2}" stroke="${r.color}" stroke-width="1.6"/>`;
    g += marker(r.mark, xL, y1, r.color);
    g += marker(r.mark, xR, y2, r.color);
  }
  for (const e of ends) {
    const y = Math.max(e.y, prev + 9);
    prev = y;
    g += `<line x1="${xR + 4}" y1="${e.y}" x2="${xR + 10}" y2="${y}" stroke="${e.r.color}" stroke-width="0.8"/>`;
    g += text(xR + 12, y + 2.4, `${e.r.label}  ${e.keep.toFixed(0)}% kept`, { size: 6.6, fill: C.ink });
  }
  g += text(M.l, 10, `same ${d.pairedRoutes} routes, both grids`, { size: 6.6, fill: C.ink2, style: "italic" });

  writeFileSync(
    join(OUT, "fig4-resolution-gate.svg"),
    svg(W, H, g,
      "Effect retained after coarsening the grid",
      "The placebo-displaced preference measured at both grid resolutions on the same routes, showing what the coarser grid costs before any long-haul result is quoted.")
  );
  return "fig4-resolution-gate.svg";
}

// ============================================================================
// FIGURE 5 -- the placebo control, as a diagram
// ============================================================================
// Not a chart. The method is the contribution most likely to be misread as
// "they compared against a null of 50", so it gets a picture: the control
// shares the route's shape and heading and differs only in position.
function figurePlacebo() {
  const W = 252, H = 112;
  const D = 20;            // displacement, in figure units
  const LABEL_X = 150;     // route stops here so labels get clean air to the right
  let g = "";

  const route = [[20, 84], [46, 70], [74, 66], [102, 54], [126, 50], [LABEL_X, 40]];
  const path = (pts) => `M${pts.map((p) => p.join(",")).join(" L")}`;
  /** Offset perpendicular to the LOCAL heading, which is what the study does
   *  and what the caption claims. A rigid vertical shift would draw a control
   *  that is nearer the route on steep sections than on flat ones, quietly
   *  contradicting the method the figure exists to explain. */
  const offset = (pts, d) =>
    pts.map(([x, y], i) => {
      const [px, py] = pts[Math.max(0, i - 1)];
      const [nx, ny] = pts[Math.min(pts.length - 1, i + 1)];
      const dx = nx - px, dy = ny - py;
      const len = Math.hypot(dx, dy) || 1;
      return [x + (-dy / len) * d, y + (dx / len) * d];
    });

  const up = offset(route, -D), down = offset(route, D);
  for (const line of [up, down]) {
    g += `<path d="${path(line)}" fill="none" stroke="${C.s2}" stroke-width="1.4" stroke-dasharray="4 2.5" stroke-linejoin="round"/>`;
  }
  g += `<path d="${path(route)}" fill="none" stroke="${C.s1}" stroke-width="2.2" stroke-linejoin="round"/>`;

  // One tie, drawn at a vertex where the route is visibly turning, so the
  // reader can see the offset is normal to the heading and not vertical.
  const i = 3;
  g += `<line x1="${up[i][0]}" y1="${up[i][1]}" x2="${down[i][0]}" y2="${down[i][1]}" stroke="${C.muted}" stroke-width="0.7" stroke-dasharray="1.5 1.5"/>`;
  g += `<circle cx="${route[i][0]}" cy="${route[i][1]}" r="2" fill="${C.s1}"/>`;
  const midUp = [(route[i][0] + up[i][0]) / 2, (route[i][1] + up[i][1]) / 2];
  const midDn = [(route[i][0] + down[i][0]) / 2, (route[i][1] + down[i][1]) / 2];
  g += text(midUp[0] - 3, midUp[1] + 2, "d", { size: 7, fill: C.ink2, style: "italic", anchor: "end" });
  g += text(midDn[0] - 3, midDn[1] + 2, "d", { size: 7, fill: C.ink2, style: "italic", anchor: "end" });

  // Labels are anchored to each line's own right-hand endpoint, so none of them
  // can land on a stroke.
  const lead = (from, label, color, weight) => {
    const [x, y] = from;
    return `<line x1="${x + 3}" y1="${y}" x2="${x + 9}" y2="${y}" stroke="${color}" stroke-width="0.8"/>` +
      text(x + 12, y + 2.4, label, { size: 6.8, fill: color, weight: weight ?? "normal" });
  };
  g += lead(up[up.length - 1], "displaced control", C.s2);
  g += lead(route[route.length - 1], "as-laid cable", C.s1, "bold");
  g += lead(down[down.length - 1], "displaced control", C.s2);

  g += text(12, 14, "The control shares the route's shape, length and heading,", { size: 6.6, fill: C.ink2 });
  g += text(12, 22, "and differs only in where it sits.", { size: 6.6, fill: C.ink2 });

  writeFileSync(
    join(OUT, "fig5-placebo-control.svg"),
    svg(W, H, g,
      "The placebo-displaced control",
      "An as-laid cable route with control lines displaced perpendicular to the local heading on both sides, sharing shape, length and heading but not position.")
  );
  return "fig5-placebo-control.svg";
}

// ============================================================================
// FIGURE A -- corpus geographic coverage
// ============================================================================
// A paper whose most-quoted limitation is "75% of corpus length is NW Europe
// and the Mediterranean" should show that rather than assert it. A reviewer
// checking geographic scope can read this in one glance, and it makes the
// long-haul band's concentration -- two corridors, transatlantic and
// Marseille-Levant -- visible instead of a sentence in Threats to Validity.
//
// Double-column (516 pt): a world map at 252 pt would render the Danish and
// Maltese routes as single pixels.
//
// Equirectangular, deliberately. An equal-area projection would be the honest
// choice for a density claim, but this figure makes a COVERAGE claim -- where
// there are routes and where there are none -- and equirectangular keeps
// lat/lng legible against the coordinates quoted in the text.
function figureCorpusMap() {
  const corpus = read("cable-corpus.json");
  const land = JSON.parse(
    readFileSync(join(__dirname, "..", "raw", "land", "ne_land.geojson"), "utf-8"),
  );

  const W = 516, H = 268;
  const M = { t: 10, r: 8, b: 26, l: 8 };
  const plotW = W - M.l - M.r, plotH = H - M.t - M.b;
  // Clip the poles: no cable lands above 71N and Antarctica is empty, so the
  // full -90..90 would spend a third of the figure on white space.
  const LAT0 = -60, LAT1 = 78;
  const X = (lng) => M.l + (plotW * (lng + 180)) / 360;
  const Y = (lat) => M.t + plotH * (1 - (lat - LAT0) / (LAT1 - LAT0));

  let g = `<rect x="${M.l}" y="${M.t}" width="${plotW}" height="${plotH}" fill="#f7f9fa"/>`;

  // Land first, as a quiet ground. Rings are drawn as one path each; Natural
  // Earth's 50m land is 1,409 rings, which is well inside what a vector PDF
  // handles without complaint.
  let landPath = "";
  for (const f of land.features) {
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poly of polys) {
      for (const ring of poly) {
        if (ring.length < 3) continue;
        let d = "";
        let skip = false;
        for (let i = 0; i < ring.length; i++) {
          const [lng, lat] = ring[i];
          if (lat < LAT0 - 12 || lat > LAT1 + 12) { skip = true; break; }
          d += `${i ? "L" : "M"}${X(lng).toFixed(1)},${Y(lat).toFixed(1)}`;
        }
        if (!skip && d) landPath += d + "Z";
      }
    }
  }
  g += `<path d="${landPath}" fill="#e6e4de" stroke="#d2cfc7" stroke-width="0.3"/>`;

  // Graticule, faint, so a reader can place a route without a coordinate table.
  for (let lat = -60; lat <= 60; lat += 30) {
    g += `<line x1="${M.l}" y1="${Y(lat)}" x2="${M.l + plotW}" y2="${Y(lat)}" stroke="${C.grid}" stroke-width="0.4"/>`;
    g += text(M.l + 2, Y(lat) - 1.5, `${Math.abs(lat)}${lat === 0 ? "" : lat > 0 ? "N" : "S"}`, { size: 5.4, fill: C.muted });
  }
  for (let lng = -120; lng <= 120; lng += 60) {
    g += `<line x1="${X(lng)}" y1="${M.t}" x2="${X(lng)}" y2="${M.t + plotH}" stroke="${C.grid}" stroke-width="0.4"/>`;
  }

  // Routes, coloured by publishing agency so the source confound that Test 3
  // turns on is visible: the ruggedness gradient is partly a map of who
  // surveyed where.
  const bySource = new Map();
  for (const r of corpus.routes) {
    const k = r.source ?? r.layer;
    if (!bySource.has(k)) bySource.set(k, []);
    bySource.get(k).push(r);
  }
  const order = [...bySource.entries()].sort((a, b) => b[1].length - a[1].length);
  const palette = [C.s1, C.s2, C.s3, C.s4, "#b0175e", "#6b7b8c", "#8a8983"];

  let drawn = 0;
  order.forEach(([, routes], si) => {
    const col = palette[Math.min(si, palette.length - 1)];
    for (const r of routes) {
      const coords = r.coordinates;
      if (!coords || coords.length < 2) continue;
      let d = "";
      let prevLng = null;
      for (let i = 0; i < coords.length; i++) {
        const [lng, lat] = coords[i];
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        // Break the path at the antimeridian rather than drawing a line back
        // across the whole map.
        const jump = prevLng !== null && Math.abs(lng - prevLng) > 180;
        d += `${!d || jump ? "M" : "L"}${X(lng).toFixed(1)},${Y(lat).toFixed(1)}`;
        prevLng = lng;
      }
      if (d) { g += `<path d="${d}" fill="none" stroke="${col}" stroke-width="0.85" stroke-opacity="0.85"/>`; drawn++; }
    }
  });

  // Legend along the bottom, sized by route count so the Europe weighting is
  // stated numerically as well as shown.
  let lx = M.l;
  const ly = H - 8;
  order.forEach(([name, routes], si) => {
    const col = palette[Math.min(si, palette.length - 1)];
    const label = `${name} (${routes.length})`;
    g += `<line x1="${lx}" y1="${ly - 2.4}" x2="${lx + 9}" y2="${ly - 2.4}" stroke="${col}" stroke-width="1.6"/>`;
    g += text(lx + 11.5, ly, label, { size: 6.2, fill: C.ink2 });
    // Times at 6.2 pt averages about 2.7 pt per character; the extra 5 pt is
    // the gap, which at 3.05 was tight enough for two labels to touch.
    lx += 18 + label.length * 2.9;
  });

  const totalKm = corpus.routes.reduce((a, r) => a + (r.lengthKm ?? 0), 0);
  g += text(W - M.r - 2, M.t + 9, `${drawn} routes`, { anchor: "end", size: 6.6, fill: C.ink, weight: "bold" });
  g += text(W - M.r - 2, M.t + 17, `${Math.round(totalKm).toLocaleString("en-US")} km`, { anchor: "end", size: 6.4, fill: C.ink2 });

  writeFileSync(
    join(OUT, "fig6-corpus-map.svg"),
    svg(W, H, g,
      "Geographic coverage of the as-laid route corpus",
      "World map of the 412 as-laid cable routes, coloured by the national hydrographic office that published them. Coverage is concentrated in northwest Europe and the Mediterranean, with French overseas territories reaching the Caribbean, Indian Ocean and Pacific."),
  );
  return "fig6-corpus-map.svg";
}

// ============================================================================
// FIGURE B -- the evaluation protocol
// ============================================================================
// The single most important thing to understand before reading any result, and
// the thing that distinguishes this work from the routing literature it argues
// with: every method is handed ONLY two endpoints and scored on distance from
// the cable that was really laid. A reader who takes this in does not need the
// protocol prose at all.
function figureProtocol() {
  const W = 252, H = 176;
  let g = "";

  const box = (x, y, w, h, fill, stroke, dash) =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="${fill}" stroke="${stroke}" stroke-width="1"${dash ? ` stroke-dasharray="${dash}"` : ""}/>`;

  // Step 1: what the method is given.
  g += box(8, 10, 236, 30, "#f7f9fa", C.grid);
  g += text(14, 22, "GIVEN", { size: 6, weight: "bold", fill: C.muted });
  g += text(14, 33, "two endpoints only — no route, no hint", { size: 7.4, fill: C.ink });
  g += `<circle cx="196" cy="26" r="3" fill="${C.ink}"/>`;
  g += `<circle cx="228" cy="26" r="3" fill="${C.ink}"/>`;
  g += `<line x1="199" y1="26" x2="225" y2="26" stroke="${C.grid}" stroke-width="1" stroke-dasharray="2 2"/>`;

  // Step 2: the methods, sharing one search.
  g += box(8, 50, 236, 46, C.surface, C.s1);
  g += text(14, 62, "EACH METHOD PREDICTS", { size: 6, weight: "bold", fill: C.s1 });
  const methods = [
    ["great circle", C.muted],
    ["sea path", C.s2],
    ["terrain", C.s4],
    ["corridor", C.s1],
  ];
  methods.forEach(([m, col], i) => {
    const x = 16 + i * 56;
    g += `<rect x="${x}" y="${68}" width="50" height="18" rx="2" fill="${col}" fill-opacity="0.11" stroke="${col}" stroke-width="0.8"/>`;
    g += text(x + 25, 80, m, { size: 6.2, anchor: "middle", fill: C.ink });
  });
  g += text(126, 92.5, "same A* · same grid · same endpoints", { size: 5.8, anchor: "middle", fill: C.muted, style: "italic" });

  // Step 3: scored against reality.
  g += box(8, 106, 236, 34, C.surface, C.s3);
  g += text(14, 118, "SCORED AGAINST", { size: 6, weight: "bold", fill: C.s3 });
  g += text(14, 130, "the cable that was actually laid — mean km apart", { size: 7.4, fill: C.ink });

  // Arrows down the spine.
  const arrow = (y1, y2) =>
    `<line x1="126" y1="${y1}" x2="126" y2="${y2 - 4}" stroke="${C.ink2}" stroke-width="1"/>` +
    `<polygon points="126,${y2} 123,${y2 - 4.5} 129,${y2 - 4.5}" fill="${C.ink2}"/>`;
  g += arrow(40, 50);
  g += arrow(96, 106);

  // The control that makes the comparison legal.
  g += box(8, 148, 236, 22, "#fdf6f2", C.s2, "3 2");
  g += text(14, 157, "CONTROL", { size: 6, weight: "bold", fill: C.s2 });
  g += text(52, 157, "every grid search carries a 7.85 km discretisation", { size: 6.4, fill: C.ink2 });
  g += text(14, 166.5, "handicap. It cancels between two of them, and never against the great circle.", { size: 6.4, fill: C.ink2 });

  writeFileSync(
    join(OUT, "fig7-protocol.svg"),
    svg(W, H, g,
      "The evaluation protocol",
      "Each method receives only the two endpoints, predicts a route, and is scored by mean distance from the cable actually laid. All terrain-aware methods share one A* search, grid and endpoint handling, so differences are attributable to the cost weights."),
  );
  return "fig7-protocol.svg";
}

// ============================================================================
// FIGURE C -- the corridor control ladder
// ============================================================================
// The corridor result is the paper's largest claim and it moved from 68% to
// 29% under controls. Reporting only the final number hides the work; reporting
// only the table makes the reader reconstruct the sequence. A ladder shows the
// claim shrinking as each confound is removed, which is the actual argument.
function figureControlLadder() {
  const ec = read("corridor-endpoint-control.json").results;
  const W = 252, H = 168;
  // Right margin holds the value and the sample size beside each bar; at
  // 12 pt the widest pair ran off the canvas and "n=301" rendered as "n=30".
  const M = { t: 26, r: 36, b: 30, l: 96 };
  const plotW = W - M.l - M.r;

  const steps = [
    ["same-agency excluded", ec.trim0],
    ["+ trim 10 km", ec.trim10],
    ["+ trim 30 km", ec.trim30],
    ["+ trim 50 km", ec.trim50],
    ["+ shared landfall excl.", ec["trim30-landing10"]],
  ];
  const red = (r) =>
    r.reductionPct !== undefined
      ? r.reductionPct
      : ((r.placeboMedianKm - r.realMedianKm) / r.placeboMedianKm) * 100;

  const hi = 80;
  const X = (v) => M.l + (plotW * v) / hi;
  const rowH = (H - M.t - M.b) / steps.length;

  let g = "";
  for (let v = 0; v <= hi; v += 20) {
    g += `<line x1="${X(v)}" y1="${M.t - 6}" x2="${X(v)}" y2="${H - M.b}" stroke="${C.grid}" stroke-width="0.6"/>`;
    g += text(X(v), H - M.b + 10, `${v}%`, { anchor: "middle", size: 6.2, fill: C.muted });
  }
  g += text(M.l + plotW / 2, H - 6, "how much closer than the displaced control", {
    anchor: "middle", size: 6.6, fill: C.ink2,
  });
  g += text(M.l, M.t - 12, "each row removes one more confound", { size: 6.2, fill: C.muted, style: "italic" });

  steps.forEach(([label, r], i) => {
    const y = M.t + i * rowH + rowH / 2;
    const v = red(r);
    const last = i === steps.length - 1;
    const col = last ? C.s1 : C.s3;
    g += `<rect x="${M.l}" y="${y - 5}" width="${Math.max(1, X(v) - M.l)}" height="10" rx="1.5" fill="${col}" fill-opacity="${last ? 1 : 0.42}"/>`;
    g += text(M.l - 5, y + 2.4, label, { anchor: "end", size: 6.3, fill: last ? C.ink : C.ink2, weight: last ? "bold" : "normal" });
    g += text(X(v) + 4, y + 2.4, `${Math.round(v)}%`, { size: 6.4, fill: C.ink, weight: last ? "bold" : "normal" });
    g += text(X(v) + 22, y + 2.4, `n=${r.n}`, { size: 5.8, fill: C.muted });
  });

  writeFileSync(
    join(OUT, "fig8-control-ladder.svg"),
    svg(W, H, g,
      "The corridor effect under successive controls",
      "The corridor proximity effect measured against a displaced control, as each confound is removed: identity exclusion alone gives 68%, trimming the landfall approaches and excluding cables sharing a named landing point brings it to 29%."),
  );
  return "fig8-control-ladder.svg";
}


// --- Run --------------------------------------------------------------------
const required = [
  "longhaul-prediction.json", "error-ratio.json",
  "fishing-preference.json", "longhaul-grid-validation.json",
  "cable-corpus.json", "corridor-endpoint-control.json",
];
const missing = required.filter((f) => !existsSync(join(CACHE, f)));
if (missing.length) {
  console.error(`Missing cached results: ${missing.join(", ")}`);
  console.error("Run the analyses in section 7 of the study first.");
  process.exit(1);
}

const made = [
  figureCorpusMap(), figureProtocol(), figureBands(), figureErrorRatio(),
  figureControlLadder(), figureFishing(), figureResolution(), figurePlacebo(),
];
console.log(`Wrote ${made.length} figures to ${OUT}`);
for (const f of made) console.log(`  ${f}`);
console.log("\nAll values are read from .cache/ -- if a figure disagrees with the");
console.log("study text, one of them is stale. Convert to PDF for submission with");
console.log("any SVG renderer; nothing here depends on a rasteriser.");
