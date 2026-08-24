<div align="center">

# 🌊 Subsea Cable & Data Centre Planning Globe

**An interactive planning tool for submarine cable routing and data centre siting — built on published infrastructure data, with every number traceable to its source.**

[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vite.dev)
[![Tests](https://img.shields.io/badge/tests-144%20passing-2ea44f)](#testing)
[![Data](https://img.shields.io/badge/cable%20systems-724-0e7c86)](#data-provenance)
[![Licence](https://img.shields.io/badge/licence-Apache%202.0-blue)](LICENSE)

</div>

---

## What it does

Two connected questions a real infrastructure project has to answer:

> **Where should a data centre go?** — and — **How would it connect?**

The tool renders the actual global submarine cable network, evaluates candidate sites against measured climate, national water stress and grid carbon, ranks several sites against each other, and computes hypothetical new cable routes using pathfinding over a bathymetric grid.

Its distinguishing feature is not the globe. It is that **every figure is labelled with where it came from**, and a criterion with no data behind it is reported as unavailable rather than scored as zero.

---

## 📊 At a glance

<div align="center">

| | | | |
|:--:|:--:|:--:|:--:|
| **724** | **1,920** | **5,260** | **216** |
| cable systems | landing points | facilities | countries scored |
| **702** | **412** | **144** | **0.5°** |
| protected areas | as-laid routes studied | tests passing | ocean grid |

</div>

---

## ✨ Capabilities

### 🗺️ Explore the real network
Every cable system, landing point and facility on a 3D globe. Click a cable for its route, endpoints and connected landing points. Custom screen-space hit-testing gives reliable clicking where the renderer's own raycasting cannot.

### 📍 Evaluate one site
Enter a location and the tool pulls **a full year of hourly reanalysis temperature**, derives how much of the year outside air alone can carry the cooling load, joins national water stress and grid carbon intensity, and recommends a cooling configuration with a climate-adjusted PUE estimate.

### ⚖️ Compare several sites
The question siting actually starts from is *which of these*. Up to six candidates ranked on five weighted criteria, re-ranking instantly because the site data is already gathered.

> **A criterion missing for _any_ site is dropped for _all_ of them.** Scoring only the sites that have a value would rank a site higher precisely because less is known about it — and the table would still look complete.

### 🧭 Route a hypothetical cable
A\* search over a bathymetric depth-band grid produces materially different candidates — shortest, depth-favouring, diversity-seeking — analysed for seabed difficulty, protected-area exposure and separation from existing corridors, then ranked with a written justification.

### 🎚️ See how much the answer depends on your weights
Every ranking reports the share of possible weightings under which the recommendation still holds, and names the exact setting at which it flips.

> A result that survives every weighting and one that flips on a single slider look identical in most tools. Here they read differently.

---

## 🔍 Data provenance

Nothing is presented without its standing. This is enforced in the type system — a metric with no provenance entry cannot be rendered.

| Quantity | Source | Standing |
|---|---|:--:|
| Cable geometry, landing points | TeleGeography-derived | `REAL` |
| Data centre facilities | [PeeringDB](https://www.peeringdb.com) | `REAL` |
| Grid carbon intensity | [Our World in Data](https://ourworldindata.org) | `REAL` |
| Water stress | [WRI Aqueduct](https://www.wri.org/aqueduct) | `REAL` |
| Marine protected areas | WDPA via [EMODnet](https://emodnet.ec.europa.eu) *(European extract)* | `REAL` |
| Free-cooling hours | ERA5 reanalysis via [Open-Meteo](https://open-meteo.com) | `DERIVED` |
| Bathymetry grid | Natural Earth / GEBCO contours | `DERIVED` |
| Climate-adjusted PUE | Fitted to **31 measured facility-years** | `MODELLED` |
| Route cost estimate | Assumed coefficients | `MODELLED` |

---

## 🏗️ Architecture

```mermaid
flowchart TD
    subgraph sources["📡 Published sources"]
        A1[TeleGeography<br/>cables]
        A2[PeeringDB<br/>facilities]
        A3[Natural Earth<br/>bathymetry]
        A4[WDPA<br/>protected areas]
        A5[OWID + Aqueduct<br/>country factors]
    end

    subgraph build["⚙️ Build-time pipeline"]
        B1[build-ocean-grid<br/>rasterise to 0.5°]
        B2[build-protected-areas<br/>rasterise to 0.1°]
        B3[build-siting-data]
        B4[build-pue-model<br/>fit to 31 facilities]
    end

    subgraph runtime["🌐 Browser"]
        C1[Globe renderer<br/>+ hit-testing]
        C2[Routing worker<br/>A* pathfinding]
        C3[Siting engine<br/>climate + MCDA]
        C4[Weight sensitivity]
    end

    A1 --> C1
    A2 --> C1
    A3 --> B1 --> C2
    A4 --> B2 --> C2
    A5 --> B3 --> C3
    A2 --> B4 --> C3
    C2 --> C4
    C3 --> C4

    style sources fill:#e8f4f8,stroke:#0e7c86,color:#0b2437
    style build fill:#fff4e6,stroke:#a94f28,color:#0b2437
    style runtime fill:#eaf7ee,stroke:#2ea44f,color:#0b2437
```

Routing runs in a **Web Worker** so pathfinding never blocks the UI. Bathymetry, protected areas and country factors are rasterised or indexed at build time, turning runtime queries into array lookups.

---

## 🔬 Research

The repository includes an original study testing an assumption behind least-cost-path cable routing tools: **do submarine cables actually avoid difficult seabed?**

Run against **412 as-laid routes (206,175 km)** from national hydrographic offices, matched to 460 m bathymetry.

<div align="center">

| Finding | Result |
|---|---|
| 🟡 Cables prefer flatter seabed | Real, replicated — but **small** (−1.65 percentile) |
| 🔴 Effect scales with terrain difficulty | **Not supported** — confounded with data source |
| 🟢 Cables follow *other cables* | **68% closer** than displaced controls, 83% of routes |
| 🟢 Corridor reuse as a router | **Only method that beats a great circle** (6.4 km vs 7.1 km) |

</div>

**Two methodological controls each changed a headline:**

- **Placebo-displaced controls** — displacing the observed route sideways and re-measuring establishes what the instrument reads when no preference exists. Without it, the depth effect would have been overstated by ~70%.
- **Discretisation control** — measuring what a grid search costs when reproducing a known answer. Without it, the study would have reported that bathymetry-aware routing is worse than a straight line, which is wrong.

📄 Full write-up: [`docs/seabed-route-preference-study.md`](docs/seabed-route-preference-study.md) · Positioning: [`docs/related-work.md`](docs/related-work.md)

---

## 🚀 Getting started

```bash
npm install
npm run dev
```

Then open the printed local URL. No API keys, no accounts, no backend — the app is fully static and every dataset is committed.

**Other commands**

```bash
npm run build      # production build
npm test           # 144 tests
npm run lint       # oxlint
```

---

## 🧪 Testing

144 tests, and many assert properties of the **data** rather than the code — because that is where the hardest bugs lived.

| Suite | What it locks down |
|---|---|
| `cameraFraming` | All 724 cables frame correctly; the old code failed on 20+ |
| `oceanGridConnectivity` | Seas that must connect do; canals stay closed; Caspian stays landlocked |
| `cableHitTest` | The spatial prefilter never changes which cable a click resolves to |
| `protectedAreas` | Missing data is never reported as an absence of constraints |
| `siteComparison` | A site never ranks higher for having less data |
| `hypotheticalRouting` | Degenerate route pairs detected symmetrically |

---

## 📂 Project structure

```
src/
├── Globe.tsx                 3D globe, layers, hit-testing
├── cameraFraming.ts          spherical camera maths
├── cableHitTest.ts           screen-space cable picking
├── routing/                  A* engine, MCDA, sensitivity, protected areas
├── siting/                   climate, PUE, cooling, site comparison
├── design/                   planning wizard + inspectors
└── calculator/               facility sizing

scripts/
├── build-*.mjs               build-time data pipeline
└── research/                 reproducible study pipeline

docs/                         study write-up + related work
public/data/                  committed, app-ready datasets
```

---

## ⚠️ Known limitations

Stated here rather than discovered later:

- **Canals are not navigable.** Suez and Panama are not in the source coastline, so Europe–Asia routes come out around Africa. Natural straits narrower than the grid cell *are* corrected — 14 of them, listed in the shipped grid.
- **Protected areas are European.** EMODnet serves the European extract of WDPA. Outside its extent the criterion reports **unavailable**, never "no constraints found".
- **Route costs are assumed.** The coefficients are not sourced and are labelled `MODELLED`.
- **Bathymetry is band-derived.** Depths are contour-band bounds, not point soundings.
- **Not survey-grade.** This is a decision-support prototype, not a certified route survey.

---

## 📜 Licence

[Apache License 2.0](LICENSE) — permissive reuse with an explicit patent grant.
Chosen over MIT deliberately: submarine cable route generation is a
patent-active area, and Apache 2.0 grants patent rights from contributors and
terminates for anyone who litigates over them.

**The code is Apache 2.0. The data is not.** Each dataset remains under the
terms of its own source — see the [provenance table](#-data-provenance). Check
those terms before redistributing any of it, particularly for commercial use.

<div align="center">

**Built with** React · TypeScript · Vite · three.js · react-globe.gl

*Data: TeleGeography · PeeringDB · ERA5/Open-Meteo · WRI Aqueduct · Our World in Data · EMODnet · Natural Earth · NASA Blue Marble*

</div>
