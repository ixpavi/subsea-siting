# Data pipeline

Two separate pipelines live under `scripts/`, and they do not share data:

- **this directory** builds what the *app* ships — trimmed, committed datasets
  in `public/data/`;
- **[`research/`](#the-research-pipeline)** builds what the *study* measures,
  from higher-fidelity sources the app does not use.

Raw sourced data lives in `scripts/raw/` and `scripts/subsea-dcs.json`. It is
fetched/curated once and committed — the app never fetches these sources at
runtime, only the trimmed output in `public/data/`.

## Re-fetching raw sources

```bash
curl -s "https://www.submarinecablemap.com/api/v3/cable/cable-geo.json" -o scripts/raw/cable-geo.json
curl -s "https://www.submarinecablemap.com/api/v3/landing-point/landing-point-geo.json" -o scripts/raw/landing-point-geo.json
curl -s "https://www.peeringdb.com/api/fac?limit=10000" -o scripts/raw/peeringdb-fac-all.json
```

These are the live TeleGeography-backed endpoints behind submarinecablemap.com
(the richiecarmichael/delusan GitHub mirrors mentioned in project docs ship
the same per-cable JSON split across hundreds of files — these consolidated
endpoints are the same underlying data, much cheaper to fetch/parse). The
PeeringDB endpoint is public but rate-limited for unauthenticated requests
(~1/hour for large pulls) — get an API key at peeringdb.com for regular runs.

## Subsea data centre dataset

`scripts/subsea-dcs.json` is a hand-curated, source-cited list — there is no
structured API for subsea DCs. It was compiled via Apify web research
(`apify/rag-web-browser`) against primary/news sources for each site. Every
entry carries `coordinate_precision` ("exact" | "approximate" | "unverified")
and a `coordinate_note` explaining how the position was derived, since none of
the three currently-known real deployments have a publicly disclosed GPS fix:

- **Project Natick (Microsoft, Orkney)** — positioned at the EMEC tidal test
  site off Eday; Microsoft never published exact coordinates. Confirmed
  discontinued (DCD, 2025) — no successor deployment.
- **Hainan / Lingshui (Highlander Digital Technology)** — positioned on the
  Lingshui, Hainan coastline per news coverage; no published seabed fix.
  Actively expanding (a further module added Feb 2025).
- **Shanghai Lingang (HiCloud)** — estimated from "~10km off the Lingang
  coast" reporting; no published GPS fix. Depth is reported inconsistently
  across sources (10m vs 35m) — see `coordinate_note` in the dataset.
- **Subsea Cloud "Jules Verne" (Port Angeles, WA)** — `coordinate_precision:
  "unverified"`: announced 2022, no independent confirmation the pod was ever
  physically deployed. Included as a named, sourced candidate rather than
  omitted, but flagged as unconfirmed.

To add a new site, research it, append an entry to `subsea-dcs.json` with
`sources` URLs, and re-run the build.

## Building app-ready data

```bash
node scripts/build-data.mjs
```

Writes `public/data/{cables,landing-points,land-dcs,subsea-dcs}.json`. The
subsea build step also computes each subsea DC's nearest cable landing point
(haversine distance) and embeds it as `nearestLandingPoint` /
`nearestLandingPointDistanceKm`, which the globe uses to draw the connector
arcs.

---

## The research pipeline

`scripts/research/` is a separate, self-contained pipeline behind the study in
[`docs/seabed-route-preference-study.md`](../docs/seabed-route-preference-study.md)
and the paper in [`docs/paper/`](../docs/paper). It is **not** part of the app
build; nothing in `public/data/` comes from it, and `npm run build` never runs
it.

Why it is separate: the app ships TeleGeography-derived cable geometry, which
carries 7.3 vertices per 1,000 km and a median segment of 69 km. That is fine
for showing which systems exist and where they land, and useless for asking
where a cable actually goes. The study uses as-laid route positions republished
from national hydrographic offices instead — up to 3,369 vertices per 1,000 km.

Same constraint as the app pipeline: **no API key, no account, no prerequisite
beyond Node.** Every script writes its result to `scripts/research/.cache/`
(gitignored, ~615 MB when fully built) and prints the figures the study quotes.

| Group | Scripts | What they do |
|---|---|---|
| Corpus | `build-cable-corpus` | fetch and characterise 412 as-laid routes |
| Bathymetry | `plan-bathymetry-tiles`, `build-bathymetry-tiles`, `build-global-bathymetry`, `build-longhaul-grid` | 460 m European, 1.85 km global |
| Validation | `validate-*` | downsampling fidelity, coverage, cross-product agreement, the resolution gate |
| Analysis | `analyse-*` | the nine tests, in the order the study presents them |
| Prediction | `evaluate-*`, `measure-discretisation-penalty` | route prediction and its controls |
| Paper | `make-figures`, `svg-to-pdf`, `make-paper-tables`, `check-paper` | figures, tables and cross-file checks, all from the cache |

Run order, runtimes and which steps are cheap:
[study §7, *Reproducing*](../docs/seabed-route-preference-study.md#7-reproducing).

**Start here if you are checking the work.** The largest result in the study —
that cables follow other cables — is measured purely on route geometry and
touches no bathymetry, so it needs the corpus build alone:

```bash
node scripts/research/build-cable-corpus.mjs
node scripts/research/analyse-corridor-following.mjs         # the raw effect
node scripts/research/analyse-corridor-endpoint-control.mjs  # the controlled 29% figure
```

`inspect-geotiff.mjs` is not part of the pipeline. It exists because the EMODnet
WCS's resolution, elevation convention and nodata handling all had to be
established empirically before the tile downloader could be written against
them — and one of those, the zero-as-nodata encoding, turned out to be a real
defect that reads open ocean as land. See the study's §1.3 and §4d.
