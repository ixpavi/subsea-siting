// Profiles the routing engine against the real datasets, per phase.
//
// WHY MEASURE RATHER THAN ASSUME. Intercontinental routes take 15-25 s, and I
// have been carrying an unverified belief about the cause (that cable-proximity
// queries dominate, fixable with a precomputed distance field). That belief was
// formed by reading the code, not by timing it. Optimising the wrong phase is
// the usual outcome of that, so this measures where the time actually goes
// before anything is changed.
//
// It runs the same code the worker runs, on the same JSON, so the numbers are
// the engine's real behaviour and not a synthetic proxy.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// The routing modules are TypeScript. Vitest already runs them, so reuse its
// transform pipeline rather than inventing a second one.
const { createServer } = await import("vite");
const server = await createServer({
  root: ROOT,
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "error",
});

// The engine fetches its datasets; in Node there is no fetch origin, so serve
// them from disk under the same paths the worker uses.
const dataDir = join(ROOT, "public", "data");
globalThis.fetch = async (url) => {
  const p = String(url).replace(/^.*\/data\//, "");
  const body = readFileSync(join(dataDir, p), "utf-8");
  return { ok: true, status: 200, json: async () => JSON.parse(body) };
};

const { loadOceanGrid } = await server.ssrLoadModule("/src/routing/oceanGrid.ts");
const { runHypotheticalRouting } = await server.ssrLoadModule("/src/routing/hypotheticalRouting.ts");

const cables = JSON.parse(readFileSync(join(dataDir, "cables.json"), "utf-8"));
const landingPoints = JSON.parse(readFileSync(join(dataDir, "landing-points.json"), "utf-8"));

console.log("Loading ocean grid...");
const tGrid = performance.now();
const grid = await loadOceanGrid();
console.log(`  grid ready in ${Math.round(performance.now() - tGrid)} ms ` +
  `(${grid.rows} x ${grid.cols}, ${grid.resolutionDeg} deg)\n`);

const WEIGHTS = { length: 0.4, seabedDifficulty: 0.25, resilience: 0.2, environmental: 0.15 };

/** Pairs spanning short regional up to the intercontinental cases that hurt. */
const CASES = [
  ["Marseille", 43.30, 5.37, "Barcelona", 41.39, 2.17],
  ["London", 51.51, -0.13, "Amsterdam", 52.37, 4.90],
  ["Lisbon", 38.72, -9.14, "New York", 40.71, -74.01],
  ["Mumbai", 19.08, 72.88, "Marseille", 43.30, 5.37],
  ["Tokyo", 35.68, 139.69, "Los Angeles", 34.05, -118.24],
  ["Sydney", -33.87, 151.21, "Los Angeles", 34.05, -118.24],
];

console.log("=== END-TO-END TIMING ===");
console.log("  " + "route".padEnd(30) + "total ms".padStart(10) + "candidates".padStart(12) + "km".padStart(10));

const timings = [];
for (const [aName, aLat, aLng, bName, bLat, bLng] of CASES) {
  const t = performance.now();
  const result = runHypotheticalRouting({
    sourceLat: aLat, sourceLng: aLng, sourceLabel: aName,
    destLat: bLat, destLng: bLng, destLabel: bName,
    weights: WEIGHTS, grid, cables, landingPoints,
  });
  const ms = performance.now() - t;
  const best = result.candidates?.[0];
  timings.push({ pair: `${aName}-${bName}`, ms, n: result.candidates?.length ?? 0 });
  console.log("  " + `${aName} - ${bName}`.padEnd(30) +
    Math.round(ms).toLocaleString().padStart(10) +
    String(result.candidates?.length ?? 0).padStart(12) +
    Math.round(best?.candidate?.analysis?.lengthKm ?? best?.analysis?.lengthKm ?? 0).toLocaleString().padStart(10));
}

const worst = timings.reduce((a, b) => (b.ms > a.ms ? b : a));
console.log(`\n  worst: ${worst.pair} at ${Math.round(worst.ms).toLocaleString()} ms`);

// --- Where does that time go? ----------------------------------------------
// Sampling profiler rather than instrumenting the engine: no code changes, and
// it attributes time to whatever is actually on the stack, including things I
// would not have thought to instrument.
console.log("\n=== SELF-TIME BY FUNCTION (worst case, sampled) ===");
const session = new (await import("inspector")).Session();
session.connect();
const post = (m, p) => new Promise((res, rej) =>
  session.post(m, p, (e, r) => (e ? rej(e) : res(r))));

await post("Profiler.enable");
await post("Profiler.setSamplingInterval", { interval: 200 });
await post("Profiler.start");

const wc = CASES.find(([a, , , b]) => `${a}-${b}` === worst.pair);
runHypotheticalRouting({
  sourceLat: wc[1], sourceLng: wc[2], sourceLabel: wc[0],
  destLat: wc[4], destLng: wc[5], destLabel: wc[3],
  weights: WEIGHTS, grid, cables, landingPoints,
});

const { profile } = await post("Profiler.stop");
session.disconnect();

const self = new Map();
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
for (let i = 0; i < profile.samples.length; i++) {
  const n = byId.get(profile.samples[i]);
  if (!n) continue;
  const f = n.callFrame;
  const name = `${f.functionName || "(anonymous)"} ${f.url.split("/").pop()}:${f.lineNumber + 1}`;
  self.set(name, (self.get(name) ?? 0) + 1);
}
const total = profile.samples.length;
const ranked = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14);
console.log("  " + "function".padEnd(56) + "self %".padStart(9));
for (const [name, count] of ranked) {
  const pct = (100 * count) / total;
  console.log("  " + name.slice(0, 55).padEnd(56) + pct.toFixed(1).padStart(9) +
    "  " + "#".repeat(Math.round(pct / 2)));
}

await server.close();
