// Builds public/data/siting-country.json: real, country-level environmental
// and energy factors used by the data-centre siting model (src/siting/*).
//
// WHY COUNTRY LEVEL: the two source datasets below publish national
// aggregates. That is genuinely coarse -- water stress in particular varies
// enormously *within* large countries (a site in Kerala and a site in
// Rajasthan share an ISO code and nothing else hydrologically). The siting
// model must therefore present these as country-level indicators, never as
// site-level measurements, and src/routing/provenance.ts classifies them
// accordingly. Basin-level Aqueduct data exists and would be a genuine
// improvement; it is a much larger geospatial payload and is deliberately
// out of scope here.
//
// Re-run manually; never fetched at app runtime.
//
// SOURCES (all fetched live by this script -- nothing here is hand-entered):
//   1. Grid carbon intensity + low-carbon share
//      Our World in Data "Energy" dataset (CC-BY 4.0), which compiles Ember
//      and IEA electricity statistics.
//      https://github.com/owid/energy-data
//   2. Baseline water stress
//      WRI Aqueduct 4.0, accessed via the World Bank Data360 API.
//      Indicator WRI_AQDT_BASELINE_BWS. Industrial-weighted where available
//      (the appropriate weighting for an industrial water user such as a
//      data centre), falling back to total-weighted.
//      https://www.wri.org/aqueduct  |  https://github.com/wri/Aqueduct40
//   3. ISO 3166-1 alpha-2 <-> alpha-3 mapping
//      datasets/country-codes (public domain reference data). Needed because
//      Nominatim returns alpha-2 and both datasets above key on alpha-3.
//      https://github.com/datasets/country-codes
import { writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "data");

const COUNTRY_CODES_URL = "https://raw.githubusercontent.com/datasets/country-codes/master/data/country-codes.csv";
const OWID_ENERGY_URL = "https://raw.githubusercontent.com/owid/energy-data/master/owid-energy-data.csv";
const AQUEDUCT_URL =
  "https://data360api.worldbank.org/data360/data?DATABASE_ID=WRI_AQDT&INDICATOR=WRI_AQDT_BASELINE_BWS";

/** Minimal RFC4180-ish CSV line splitter -- country names contain commas inside quotes. */
function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

async function fetchText(url, label) {
  process.stdout.write(`  fetching ${label}... `);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${label} failed: ${res.status}`);
  const text = await res.text();
  console.log(`${(text.length / 1024).toFixed(0)} KB`);
  return text;
}

console.log("Building country-level siting factors...");

// --- 1. ISO2 -> ISO3 -------------------------------------------------------
const ccText = await fetchText(COUNTRY_CODES_URL, "ISO country codes");
const ccLines = ccText.split("\n").filter((l) => l.trim());
const ccHeader = splitCsvLine(ccLines[0]);
const iA3 = ccHeader.indexOf("ISO3166-1-Alpha-3");
const iA2 = ccHeader.indexOf("ISO3166-1-Alpha-2");
if (iA3 < 0 || iA2 < 0) throw new Error("country-codes.csv: expected ISO3166-1 alpha columns not found");

const iso2ToIso3 = {};
for (let i = 1; i < ccLines.length; i++) {
  const c = splitCsvLine(ccLines[i]);
  const a2 = (c[iA2] || "").trim().toLowerCase();
  const a3 = (c[iA3] || "").trim().toUpperCase();
  if (a2.length === 2 && a3.length === 3) iso2ToIso3[a2] = a3;
}
console.log(`  ISO2->ISO3 pairs: ${Object.keys(iso2ToIso3).length}`);

// --- 2. Grid carbon intensity (latest year per country) ---------------------
const owidText = await fetchText(OWID_ENERGY_URL, "OWID energy data");
const owidLines = owidText.split("\n");
const owidHeader = splitCsvLine(owidLines[0]);
const oCountry = owidHeader.indexOf("country");
const oYear = owidHeader.indexOf("year");
const oIso = owidHeader.indexOf("iso_code");
const oCI = owidHeader.indexOf("carbon_intensity_elec");
const oLC = owidHeader.indexOf("low_carbon_share_elec");
const oRen = owidHeader.indexOf("renewables_share_elec");
if ([oCountry, oYear, oIso, oCI].some((i) => i < 0)) throw new Error("OWID: expected columns not found");

const energyByIso = new Map();
for (let i = 1; i < owidLines.length; i++) {
  if (!owidLines[i]) continue;
  const c = splitCsvLine(owidLines[i]);
  const iso = (c[oIso] || "").trim().toUpperCase();
  const ci = c[oCI];
  if (iso.length !== 3 || !ci) continue;
  const year = Number(c[oYear]);
  const prev = energyByIso.get(iso);
  if (prev && prev.year >= year) continue;
  energyByIso.set(iso, {
    name: c[oCountry],
    year,
    carbonIntensityGco2PerKwh: Number(ci),
    lowCarbonSharePct: c[oLC] ? Number(c[oLC]) : null,
    renewablesSharePct: c[oRen] ? Number(c[oRen]) : null,
  });
}
console.log(`  countries with grid carbon intensity: ${energyByIso.size}`);

// --- 3. Water stress -------------------------------------------------------
const aqText = await fetchText(AQUEDUCT_URL, "WRI Aqueduct baseline water stress");
const aq = JSON.parse(aqText);
// Prefer the industrial weighting -- a data centre is an industrial water
// user, so an irrigation- or domestic-weighted national score would be the
// wrong lens. Fall back to total-weighted where industrial is absent.
const WEIGHT_PREFERENCE = ["WRI_AQDT_WEIGHT_IND", "WRI_AQDT_WEIGHT_TOT"];
const waterByIso = new Map();
for (const pref of WEIGHT_PREFERENCE) {
  for (const row of aq.value) {
    if (row.COMP_BREAKDOWN_1 !== pref) continue;
    const iso = (row.REF_AREA || "").trim().toUpperCase();
    if (iso.length !== 3 || waterByIso.has(iso)) continue;
    const score = Number(row.OBS_VALUE);
    if (!Number.isFinite(score)) continue;
    waterByIso.set(iso, {
      waterStressScore: score,
      // Strip the dataset's "text-based risk category: " prefix.
      waterStressCategory: (row.COMMENT_OBS || "").replace(/^text-based risk category:\s*/i, "") || null,
      waterStressWeighting: pref === "WRI_AQDT_WEIGHT_IND" ? "industrial" : "total",
    });
  }
}
console.log(`  countries with water stress: ${waterByIso.size}`);

// --- 4. Merge --------------------------------------------------------------
const countries = {};
const allIso = new Set([...energyByIso.keys(), ...waterByIso.keys()]);
for (const iso of allIso) {
  const e = energyByIso.get(iso);
  const w = waterByIso.get(iso);
  countries[iso] = {
    name: e?.name ?? null,
    carbonIntensityGco2PerKwh: e?.carbonIntensityGco2PerKwh ?? null,
    carbonIntensityYear: e?.year ?? null,
    lowCarbonSharePct: e?.lowCarbonSharePct ?? null,
    renewablesSharePct: e?.renewablesSharePct ?? null,
    waterStressScore: w?.waterStressScore ?? null,
    waterStressCategory: w?.waterStressCategory ?? null,
    waterStressWeighting: w?.waterStressWeighting ?? null,
  };
}

const withBoth = Object.values(countries).filter((c) => c.carbonIntensityGco2PerKwh != null && c.waterStressScore != null).length;

const output = {
  generatedAt: new Date().toISOString(),
  provenance:
    "Country-level indicators compiled at build time. Grid carbon intensity and low-carbon share: Our World in Data 'Energy' dataset (CC-BY 4.0), compiling Ember and IEA statistics. Baseline water stress: WRI Aqueduct 4.0 via the World Bank Data360 API, industrial-weighted where published. These are NATIONAL aggregates and are not site-level measurements -- water stress in particular varies substantially within large countries.",
  sources: {
    carbonIntensity: { name: "Our World in Data - Energy", url: "https://github.com/owid/energy-data", licence: "CC-BY 4.0" },
    waterStress: {
      name: "WRI Aqueduct 4.0 (via World Bank Data360)",
      url: "https://www.wri.org/aqueduct",
      indicator: "WRI_AQDT_BASELINE_BWS",
      note: "Aqueduct's baseline represents 1979-2019 conditions, not a single year.",
    },
    countryCodes: { name: "datasets/country-codes", url: "https://github.com/datasets/country-codes" },
  },
  iso2ToIso3,
  countries,
};

writeFileSync(join(OUT, "siting-country.json"), JSON.stringify(output));
const bytes = JSON.stringify(output).length;
console.log(
  `Wrote public/data/siting-country.json (${(bytes / 1024).toFixed(0)} KB) -- ` +
    `${Object.keys(countries).length} countries, ${withBoth} with both carbon and water data`
);
