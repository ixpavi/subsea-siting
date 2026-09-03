# Do submarine cables avoid difficult seabed? A placebo-controlled test on 355 as-laid routes

**Status:** complete analysis, negative-leaning result. Reproducible from the scripts in `scripts/research/`.

**Scope note.** Tests 1–6 (§2–§4c) run on 355 routes of 40–500 km at 460 m
resolution. Tests 7–8 (§4d–§4e) extend the prediction experiment to every length
band up to 6,400 km on a uniform 1.85 km grid, and Test 9 (§4f) adds fishing
effort. Figures from the two resolutions are not interchangeable — see §5.

---

## Summary

Least-cost-path routing tools — including the one in this repository — assume
that submarine cable routes are chosen largely by optimising over seabed
terrain. That assumption is rarely tested against cables that were actually
laid.

This study tests it on **355 as-laid cable routes (131,506 km)** published by
national hydrographic offices, against **460 m bathymetry**.

**The effect is real, replicated across independent national sources, and
small.** Cables sit on measurably flatter and less rugged seabed than control
lines drawn beside them — by about **1.6 percentile points** against a placebo
baseline. They also sit slightly *deeper* than their surroundings, which is
consistent with following flat-bottomed troughs rather than minimising depth.

A second hypothesis — that the effect strengthens in rugged terrain, where
route choice actually matters — **did not survive testing.** It appeared
clearly in a quartile analysis and then dissolved once the confound with data
source was controlled for.

**Terrain preference does measurably improve route prediction.** Given only two
endpoints, adding it to a least-cost-path search cuts median error from 9.6 km
to 7.1 km — a 26% reduction, better on 62% of held-out routes (p = 0.0009).

**But fitting the weights does not beat guessing them** (52%, p = 0.63), and the
absolute accuracy stays modest: predictions land about 7 km from the real cable,
which is the same order as a naive great circle once the grid's own
discretisation handicap (7.9 km) is accounted for.

The practical implication: terrain optimisation is worth doing and is not worth
over-engineering. A sensible hand-set weighting captures what is there.

**And terrain is not the strongest signal available.** Cables sit closer to
other operators' cables than displaced controls do, surviving exclusion of the
same cable, the same national dataset, the landfall approaches at either end,
and every cable sharing a named landing point. Under that full set of controls
the effect is **29% closer on 74% of routes (p < 1e-4)** — roughly a third of
the uncontrolled figure, and still several times the terrain effect.

Built into a router, that corridor signal is **the only method tested that beats
a great circle** at predicting real cables (6.4 km median against 7.1 km), while
every terrain variant falls short of it. It needs no bathymetry at all.

**And it is strongest exactly where it was most likely to be an artefact.**
Extending the experiment past its 500 km ceiling onto a uniform 1.85 km grid,
corridor following gets *better* with route length, not worse: it beats hand-set
terrain on **15 of 15 routes above 2,000 km (p = 0.0003)** and beats the
shortest sea path on 86% of routes between 1,000 and 2,000 km (82% against a
great circle). The natural objection — that
corridor reuse is a shallow-water landing-point artefact — has the sign
backwards. It is weakest on the shelf.

That result survives replacing the candidate set entirely. Measured against
TeleGeography's 724 systems instead of the 412-route corpus, with the three
closest-tracking systems removed to prevent a router tracing its own answer, it
still beats a great circle on 75% of 1,000–2,000 km routes and 15/15 above
2,000 km. Regionally it *fails* under the same treatment, and the reason is
measurable: corridor following helps only when the neighbour geometry's error is
small relative to the prediction's scale. A corridor known to ±12 km cannot
improve a 7 km prediction.

**The third suspected driver was tested and found absent.** Fishing effort, the
mechanism behind 80–86% of real cable faults, shows no spatial relationship to
cable position once the landfall approaches are removed. Whatever separates
cables from the hazard that actually breaks them, it is not route selection.

---

## 1. Data

### 1.1 Why not the geometry the app already ships

The application renders TeleGeography-derived cable geometry. Measured
directly, that dataset carries **7.3 vertices per 1,000 km**, a median segment
of **69 km**, and a longest single segment of **5,650 km**.

A 5,650 km straight line is not a route. It is a line drawn to show that two
places are connected. That geometry is entirely adequate for the app's purpose
— showing which systems exist and where they land — but it cannot support any
claim about *where a cable actually goes*, because it never recorded that.

### 1.2 As-laid routes

EMODnet Human Activities republishes cable positions from national
hydrographic offices — the data fishermen and marine planners use to avoid
them. Telecommunication layers only; power cables are a different engineering
problem with different burial rules and route economics.

| Source | vtx / 1,000 km | Median segment |
|---|---|---|
| DE BSH-CONTIS | 3,369 | **6 m** |
| UK OGA | 692 | 327 m |
| NL Rijkswaterstaat | 378 | 703 m |
| FR SIGCables | 168 | 2,495 m |
| FR SHOM | 148 | 2,114 m |
| MT IOI-MOC | 91 | — |
| ES CICA | 89 | — |
| *TeleGeography (for comparison)* | *7.3* | *69,000 m* |

Screening for routes long enough to have had alternatives and sampled finely
enough to show which was taken (≥25 km, ≥50 vtx/1,000 km) gives **412 routes,
206,175 km**. Counts at five different cutoffs are reported in
`build-cable-corpus.mjs` so the threshold's sensitivity is visible rather than
asserted.

The corpus is **Europe-weighted but not shelf-limited**: French SHOM covers
overseas territories, so it reaches the Pacific, Indian Ocean and Caribbean.
49 routes exceed 1,000 km, 11 exceed 3,000 km, and depth exposure runs from
shelf to abyssal plain.

### 1.3 Bathymetry

EMODnet Bathymetry DTM, native 1/16 arc-minute (~115 m), downsampled to
**~460 m** — comfortably finer than the corpus's 2 km median route sampling,
which is the condition for resolving what routes bent around.

The downsampling was validated rather than assumed. Asking the server for
460 m hands the reduction to a method we do not control; if it point-sampled,
narrow canyons and escarpments would vanish between samples — and those are
exactly what cables route around. Measured against locally block-averaged
native tiles:

- **0.1%** of output cells exactly equal a source cell → it interpolates, it does not point-sample
- Global mean signed error **−1.2 m** → unbiased at scale
- Residual is interpolation noise concentrated on steep cells (steep-decile RMS 47 m) against relief of thousands of metres

Of 412 corpus routes, **356 fall inside EMODnet Bathymetry's envelope**; one
crosses a genuine hole in its coverage and is excluded rather than
interpolated over, leaving **355 routes / 131,506 km**.

An independent check: cables are, definitionally, in water, and the bathymetry
is a separate dataset. 1.7% of route vertices land on positive elevation — and
**78% of those sit in the outer 5% of their route**, which is landfall at
460 m cells. The explanation was tested, not merely asserted.

**A defect in this product, found later and documented in §4d.** EMODnet writes
out-of-coverage as exactly `0` rather than as a nodata sentinel — 4.85% of cells
across the 789 Phase 1 tiles, with 36 tiles entirely zero. Because depth is read
as null for any elevation ≥ 0, such a cell reads as *land*. It does not corrupt
the terrain statistics in §2–§4 (null-depth samples are dropped rather than
counted as shallow seabed), but it would make a router treat open water as
coastline. The affected regions lie outside the coverage box used by §4a; the
long-haul grid in §4d excludes and back-fills them explicitly.

Depth along the corpus: median 64 m, but **17% below 2,000 m** and 4% abyssal,
max 5,272 m. Deep-water routing decisions are present.

---

## 2. Test 1 — deviation from the geodesic

If cables essentially go straight, there is nothing to explain.

They do not. Median sinuosity **1.098**; median maximum lateral departure
**17.5 km**; only 10% of routes are within 2% of straight.

But **218 of 353 routes have geodesics that cross land.** Those cables *had*
to bend, and "cables avoid continents" is true, trivial, and not a finding.
Pooling them with the rest would manufacture a strong result out of geography.

Restricting to the **135 routes whose straight line was navigable open water**,
the deviation is much smaller: median sinuosity 1.043, median maximum departure
9.8 km.

Comparing terrain along the observed route against the straight line it
declined to take, on that informative subset:

| Measure | Observed lower | p |
|---|---|---|
| Median depth | 39% | 0.02 |
| Max depth | 40% | 0.10 |
| Median slope | 58% | 0.11 |
| **90th-percentile slope** | **65%** | **0.0005** |
| Median roughness | 58% | 0.23 |

Four of five measures show nothing. The one signal is in the **steep tail** —
routes avoid their steepest sections, about an 8% reduction. Depth runs the
*opposite* way: 61% of observed routes are deeper than their straight line.

---

## 3. Test 2 — local preference, with a placebo control

Test 1 has two weaknesses that could hide a real effect. It averages terrain
over the whole route, so local avoidance is diluted against a counterfactual
that was often barely different. And EMODnet features are route *segments*
published by national authorities — if a segment's endpoints are
administrative cuts, the geodesic between them is not a route anyone
considered.

**Design.** At each point along a route, take a transect perpendicular to the
local heading and ask where the cable sits within it. Purely local: no
endpoints, no geodesic, no assumption about what the route was for. Under the
null the expected percentile is 50. Each route contributes one number (the mean
of its samples) because adjacent samples share terrain and pooling them would
inflate significance enormously.

**The placebo is the point.** A percentile near 50 *sounds* like it must mean
"no preference", but that is an assumption about the instrument. Terrain is
strongly autocorrelated and transects are short; the geometry alone could push
the centre off 50 for any line drawn on the seabed. So the identical
measurement was repeated on the same routes displaced sideways by 20 and 50 km.
Displaced lines are not cables and cannot express engineering preference, but
they have the same shape, length, headings and terrain.

**Result (5 km transects, n = 342 routes):**

| Metric | Real routes | Placebo mean | **Effect** |
|---|---|---|---|
| Slope | 48.56 | 50.20 | **−1.65** |
| Roughness | 48.77 | 50.30 | **−1.54** |
| Depth | 50.71 | 50.29 | **+0.42** |

Across all 12 placebo combinations the median percentiles sit at 50.0–50.6, and
11 of 12 are non-significant. The placebo **never drops below 50** on slope or
roughness. The instrument reads clean on lines that are not cables.

The control changed the conclusion. Raw, the depth effect read **+0.71** against
a null of 50 and looked substantial; baselined, it is **+0.42** — most of it was
the instrument, not the cables.

Effects strengthen monotonically with transect width. Raw slope percentiles at
2 / 5 / 10 km are **49.45 / 48.56 / 48.13** — a coherent gradient of the kind a
real mechanism should show, since a wider transect offers more genuinely
different ground to have chosen instead.

*These three are raw, uncorrected values.* The placebo was run only at 5 km, so
only that width has a measured baseline; the 2 km and 10 km figures are stated
against the nominal null of 50 and are therefore upper bounds on the true
effect, not placebo-corrected results.

---

## 4. Test 3 — the dose-response that failed

If the mechanism is real, it should appear *where it can*. Over featureless
shelf there is no meaningful choice: every position for tens of km is equally
flat, so even an engineer optimising hard for terrain would produce a route
indistinguishable from a random line. Over rugged ground there are real
alternatives and real reasons to prefer some.

Placebo-corrected slope effect by terrain-ruggedness quartile:

| Quartile | Local relief | Routes | Δ slope |
|---|---|---|---|
| Q1 (flattest) | 0.0–1.5 m | 85 | −0.69 |
| Q2 | 1.5–3.0 m | 85 | −2.04 |
| Q3 | 3.0–16.8 m | 85 | −1.49 |
| Q4 (ruggedest) | 16.8–207.3 m | 88 | **−2.39** |

Q1 → Q4 is 3.5×, in the predicted direction. **It does not hold.**

The series is not monotonic (Q2 exceeds Q3), and quoting "3.5×" from the two
extreme bins of a noisy four-bin series is a number chosen after seeing it.
Testing the trend across all 343 routes gives Spearman **ρ = −0.174**
(p = 0.002) — real but weak.

**And it is confounded with data source.** The corpus is seven national
agencies whose survey fidelity differs by 30×, and they survey different seas:

| Source | Q1 | Q2 | Q3 | Q4 |
|---|---|---|---|---|
| DE BSH-CONTIS | **21** | 2 | 0 | 0 |
| NL Rijkswaterstaat | **42** | **41** | 10 | 0 |
| FR SHOM | 20 | 35 | 55 | 48 |
| FR SIGCables | 2 | 5 | 15 | **21** |
| ES CICA | 0 | 0 | 1 | **18** |

"Ruggedness" is partly a proxy for *which agency drew this line*. Within each
source — holding fidelity and cartographic convention constant — **no agency
reaches significance**:

| Source | n | ρ(ruggedness, Δslope) | p |
|---|---|---|---|
| FR SHOM | 158 | −0.153 | 0.058 |
| FR SIGCables | 43 | −0.181 | 0.242 |
| DE BSH-CONTIS | 23 | −0.226 | 0.297 |
| NL Rijkswaterstaat | 93 | −0.080 | 0.443 |

All four are negative — the direction is consistent — but the gradient is
**largely between-source, not terrain**. The dose-response hypothesis is not
supported.

---

## 4a. Test 4 — does terrain-aware routing predict real cables better?

The percentile effect above says cables *prefer* flatter ground. It does not
say what that preference is worth. A 1.6 percentile shift could correspond to a
router that reproduces real routes closely or one that barely beats a ruler, and
the percentile cannot distinguish them.

**Design.** Give each method only the two endpoints, have it predict the route,
and measure the mean distance from the cable actually laid. Every terrain-aware
method uses the **same A\* over the same bathymetry**, differing only in cost
weights — so a difference between them cannot come from the search, grid,
corridor or endpoint handling. Leave-one-source-out cross-validation, because
routes from one agency share a sea and a survey convention.

**Result (216 held-out routes, 40–500 km):**

| Method | Median error | Mean | p90 |
|---|---|---|---|
| Great circle (no bathymetry) | 7.0 km | 11.2 | 26.3 |
| All terms, weights fitted on other sources | 7.1 km | 11.0 | 23.8 |
| Slope-avoiding | 7.3 km | 10.7 | 22.4 |
| All terms, hand-set weights | 7.8 km | 11.2 | 24.9 |
| Shortest sea path (terrain ignored) | 9.6 km | 13.5 | 30.3 |
| Depth-avoiding | 9.7 km | 14.7 | 33.5 |

Read naively this says every bathymetry-aware method is worse than a straight
line. **That reading is wrong**, and the control below is why.

### The discretisation control

The geodesic is a smooth analytic curve. Every other method is a path over an
8-connected 460 m grid that can only step in 45° increments and must snap its
endpoints to water cells. Those are properties of the *search*, not of terrain.

Measuring the zero-weight router — terrain entirely ignored, so over open water
it is trying to reproduce the great circle — against the true great circle, on
the 51 route pairs whose geodesic never touches land:

**Median discretisation penalty: 7.85 km** (mean 10.2, p90 26.1).

That handicap is **larger than the 2.58 km gap** between the geodesic and the
shortest sea path. So "A\* is worse than a straight line" measures the grid, not
the bathymetry, and cannot support a claim either way.

### The comparison that is sound

Weighted versus unweighted A\* share the discretisation handicap exactly, so it
cancels and only the terrain preference differs:

| Comparison | Better on | p |
|---|---|---|
| **Fitted terrain preference vs shortest sea path** | **133/216 (62%)** | **0.0009** |
| Hand-set terrain preference vs shortest sea path | 125/216 (58%) | 0.0247 |
| Fitting the weights vs guessing them | 108/208 (52%) | 0.63 |

Median error falls from **9.61 km to 7.08 km — a 26% reduction** — when terrain
preference is added to the same search.

Two things follow, and the second is as important as the first.

**Terrain preference genuinely improves route prediction.** Not by a little: a
quarter of the error, on 62% of held-out routes, across sources the weights were
never fitted on.

**Fitting the weights does not beat guessing them** (52%, p = 0.63). Whatever
the terrain signal is, it is coarse enough that a sensible hand-set weighting
captures it. That is a direct and unflattering finding about learned cost
surfaces for this problem.

### Fitted weights across folds

| Held out | depth | slope | rough |
|---|---|---|---|
| FR SIGCables | 1 | 1 | 0 |
| FR SHOM | 0 | 1 | 0 |
| NL Rijkswaterstaat | 1 | 1 | 0 |
| ES CICA | 0 | 0 | 1 |
| DE BSH-CONTIS | 1 | 1 | 0 |

Slope is selected in 4 of 5 folds, roughness in 1, depth in 3. The partial
agreement matters: **slope is the term that transfers**, which is the same term
the placebo test found the strongest effect on, arrived at by a completely
different method.


---

## 4b. Test 5 — if not terrain, then what?

The terrain effect is real but modest, and the prediction experiment showed it
buys a 26% error reduction inside a search that still lands ~7 km from the real
cable. That leaves the interesting question open, and the most plausible answer
is not exotic: **cable projects reuse corridors.** Existing routes carry survey
data, established permits, known burial conditions and proven landing
approaches, all expensive to obtain afresh.

**Design.** Identical instrument to the terrain test: measure the median
distance from each route to the nearest *other* cable, then displace that route
20–50 km sideways and measure again. Whatever the displaced line finds is what
that corridor of ocean offers by chance.

**The confound that decides it.** EMODnet publishes route *segments*. If a
route's nearest neighbour is another segment of the same physical cable, the
result is true by construction and worthless. The same applies one level up: a
single agency densely surveying one busy corridor produces many nearby features
that say nothing about operators reusing each other's routes. So the
measurement runs at three exclusion strengths.

| Compared against | n | Real | Control | Closer on | p |
|---|---|---|---|---|---|
| Any other route | 336 | 2.1 km | 9.8 km | 90% | <1e-4 |
| Excluding the same named cable | 336 | 2.2 km | 9.9 km | 90% | <1e-4 |
| **Excluding the same agency entirely** | 301 | **7.1 km** | **22.2 km** | **83%** | **<1e-4** |

It survives all three. Even when a route may only be compared against cables
published by a *different country's* hydrographic office, it sits **68% closer**
than the same line displaced sideways in the same water.

The absolute distances rise under the strictest exclusion (7.1 km rather than
2.1 km) because foreign cables are simply farther away on average. That does not
weaken the result — the displaced control faces exactly the same constraint,
which is what the placebo design exists to absorb.

### The confound those three exclusions do not remove

All three exclude candidates by *identity* — same segment, same cable, same
agency. None of them touches the obvious alternative explanation: **cables
converge at landing points because they have to.** Two systems making landfall
on the same beach are close there for reasons that have nothing to do with
reusing a surveyed corridor, and a different operator's cable landing beside
mine passes all three tests above. Because the displacement is applied
per-vertex, it moves the real route's endpoints out of those convergence zones
along with everything else — so the real line samples crowded landfall water and
its placebo samples emptier water beside it.

Two further controls, run in `analyse-corridor-endpoint-control.mjs` on top of
the strictest exclusion, with the placebo receiving identical treatment:

**Trim the approaches.** Discard samples within *T* km along the route of either
of its own ends, so landfalls are not measured at all.

| trim | n | real | placebo | closer | reduction | p |
|---:|---:|---:|---:|---:|---:|---:|
| 0 km | 301 | 7.1 km | 22.2 km | 83% | 68% | <1e-4 |
| 10 km | 227 | 9.3 km | 22.7 km | 79% | 59% | <1e-4 |
| 20 km | 204 | 10.7 km | 24.8 km | 77% | 57% | <1e-4 |
| 30 km | 183 | 11.6 km | 23.6 km | 78% | 51% | <1e-4 |
| 50 km | 158 | 11.5 km | 22.3 km | 79% | 48% | <1e-4 |

The effect decays and then **plateaus**. Pure landfall geometry would keep
falling toward zero once the trim exceeded the width of a convergence zone;
instead it settles near 50% and stays significant on ~79% of routes. Cables
follow other cables in mid-route water, where nothing forces them together.

**Exclude cables that land where I land.** Association is decided by
TeleGeography's 1,920 published landing points, a source independent of the
EMODnet routes being measured. Two routes are excluded from each other only when
both resolve to the *same named* landing point, so an administrative segment cut
in open water — which has no landing point near it — excludes nothing. At a
10 km association radius, 283 of 412 routes (69%) resolve to a named landfall.

| association radius | n | real | placebo | closer | reduction | p |
|---:|---:|---:|---:|---:|---:|---:|
| 5 km | 182 | 18.4 km | 26.6 km | 74% | 31% | <1e-4 |
| **10 km** | **182** | **19.0 km** | **26.6 km** | **74%** | **29%** | **<1e-4** |
| 20 km | 182 | 20.1 km | 27.0 km | 75% | 26% | <1e-4 |

Stable across the association radius, which is what a real effect looks like and
a threshold artefact does not.

**So the honest figure is 29%, not 68%.** Roughly half the uncontrolled effect
was the landfall approaches, and a further part was cables genuinely sharing a
landfall. What remains — a quarter to a third — is corridor reuse in open water,
on three quarters of routes, at p < 1e-4.

*(A cruder version of this control, excluding any route with a polyline terminus
within 50 km of one of mine, collapses the median gap to −1% while the sign test
still holds at 67%. It is not reported as a result: EMODnet endpoints are
frequently administrative cuts, so it strips out genuine corridor neighbours
along with landfall twins. It is a lower bound produced by a blunt instrument,
which is why the named-landing-point version above replaced it.)*

### Against the terrain effect

Both figures below are fully controlled — placebo-corrected for terrain,
landfall-controlled for corridors.

| | Routes showing it | Effect |
|---|---|---|
| Terrain (slope, placebo-corrected) | 68% | −1.65 percentile |
| **Corridor reuse** (landfall-controlled) | **74%** | **29% closer** |

Corridor reuse remains the larger, more consistent and more interpretable
driver even after the confound is removed — and unlike bathymetry it requires no
survey data at all, because every planner already knows where the existing
cables are.

That reframes the whole study. Terrain-driven least-cost-path routing optimises
the weaker of two available signals while ignoring the stronger one, which is
sitting in a dataset every operator has.


---

## 4c. Test 6 — corridor reuse as a competing router

Test 5 showed cables sit closer to other cables than displaced controls do.
That is an observation about geometry. This turns it into a **competing model**
and puts it head to head with terrain, inside the same search.

**Design.** A fourth cost term: distance from each cell to the nearest existing
cable, zero at a cable and saturating 25 km away. Everything else is unchanged
— same A\*, same grid, same corridor, same endpoints — so the comparison
isolates the cost term.

**The exclusion is the whole experiment.** A router that can see the route it is
predicting traces it and scores perfectly, measuring nothing. Excluding just
that route is not enough either: adjacent segments of the same cable, and the
same agency's other surveys of the same corridor, leak the answer equally well.
So the corridor term is fed a **same-agency exclusion** — a route may only be
predicted from cables that a *different country's* hydrographic office
published.

**Result (217 held-out routes):**

| Method | Median | Mean | p90 | vs geodesic |
|---|---|---|---|---|
| **Corridor + terrain** | **6.4 km** | 9.8 | 21.0 | **−9.9%** |
| **Corridor only** | **6.9 km** | 10.8 | 25.1 | **−3.1%** |
| Great circle (no bathymetry) | 7.1 km | 11.2 | 26.3 | — |
| Terrain, weights fitted | 7.1 km | 11.0 | 24.6 | +0.2% |
| Terrain only (slope) | 7.3 km | 10.7 | 22.6 | +3.7% |
| Terrain, all terms hand-set | 7.9 km | 11.2 | 24.9 | +11.7% |
| Shortest sea path | 9.7 km | 13.6 | 30.3 | +37.2% |

**Corridor following is the first and only method to beat the great circle.**
Every terrain variant is worse than a straight line — and both corridor methods
carry the same 7.85 km discretisation handicap that made that comparison unfair
for terrain, so they clear the baseline in spite of it, not because the bar
moved.

### Paired comparisons

| Comparison | Better on | p |
|---|---|---|
| Corridor vs shortest sea path | 130/196 (66%) | **<1e-4** |
| Corridor vs hand-set terrain | 131/217 (60%) | **0.0028** |
| Fitted terrain vs shortest sea path | 134/217 (62%) | **0.0007** |
| Corridor vs *fitted* terrain | 120/217 (55%) | 0.14 |
| Adding terrain on top of corridor | 115/217 (53%) | 0.42 |

Three things follow, and the last two are the ones to be careful about.

**Corridor following beats the terrain-free baseline decisively** (66%,
p < 1e-4) and beats hand-set terrain (60%, p = 0.003).

**It is not statistically distinguishable from *fitted* terrain** (55%,
p = 0.14). Corridor reuse is at least as good a predictor as a terrain cost
surface tuned on other agencies' data — but the claim that it is *better* is not
supported at this sample size.

**The combination has the best median but no significant per-route gain**
(6.4 km, yet 53% and p = 0.42 for adding terrain to corridor). Terrain helps
markedly on some routes and hurts on others, so the median moves while the win
rate sits at chance. Reporting "corridor + terrain is best" on the median alone
would overstate what the paired test supports.

### What this means

Terrain-driven least-cost-path routing optimises the weaker of two available
signals. The stronger one requires no bathymetry, no survey, and no model — it
is the location of the cables already there, which every operator has.

The landfall control in §4b does not apply to this test. There the concern was
that proximity is manufactured near landing points; here both endpoints are
*given* to every method, and the question is what happens between them. The
prediction result is unaffected by that confound.

The honest ceiling: even the best method lands ~6.4 km from the real cable,
against a 7.85 km grid handicap. Route choice is substantially driven by
factors in neither dataset — landing-point contracts, permitting, seasonal
vessel availability, commercial relationships.


---

## 4d. Test 7 — does any of this hold for long-haul cables?

**The objection this answers is the strongest one available.** Tests 4–6 cap
routes at 500 km and sit inside EMODnet's envelope, so their conclusions are
about *regional*, mostly shelf-and-margin routing. The literature they argue
with is about trans-oceanic systems. Testing on one regime and generalising to
the other is not a limitation to note in passing; it is a reason to reject.

96 corpus routes exceed 500 km, 49 exceed 1,000 km, 11 exceed 3,000 km.

### Why the grid had to get coarser, and what that cost

A\* searches a corridor around the endpoints' bounding box, and that area grows
with the *square* of route length. Measured at 240 cells/degree: the median
corridor is 478,000 cells for a 40–500 km route and **37.5 million** for a
3,000 km one, against a 2,000,000 expansion cap. Long-haul at 460 m is not
slow, it is impossible. At 60 cells/degree (~1.85 km) the same bands are 30,000
and 2.3 million.

Coarsening is legitimate only if the instrument can still see the effect. So
the placebo measurement was re-run at **both** resolutions on the same 235
routes:

| | 460 m | 1.85 km | retained |
|---|---|---|---|
| slope percentile | −17.47 | −8.24 | **47%** |
| relief percentile | −21.33 | −11.80 | **55%** |
| depth percentile | −7.55 | −7.39 | **98%** |

Same sign throughout, roughly half the sensitivity on slope and relief, almost
none lost on depth. The coarse grid can carry the experiment, with a
sensitivity cost that must be stated rather than assumed away. Note this is an
*internal* comparison — the percentile scale here differs from §3's, because the
pool is the real sample plus two displacements rather than a bucketed local
distribution.

### A data defect found while validating, which affects §1.3

**EMODnet encodes out-of-coverage as exactly `0`, not as a nodata sentinel.**
Measured over the 789 Phase 1 tiles: 4.85% of cells are exactly zero, and 36
tiles are **100% zero** — among them 13–15°N/−59° (Barbados) and 40–41°N/−38 to
−42° (mid-Atlantic), which are simply outside the DTM. NOAA's exact-zero rate
is 0.03%, i.e. genuine sea level.

This matters twice. Averaged into a block mean it fabricates a shallow shelf
where there is no data at all. And because depth is read as null for any
elevation ≥ 0, a zero-filled cell reads as **land** — the router treats a
stretch of open Atlantic as coastline and goes around it, silently and
confidently. 2,203,460 such cells were discarded and back-filled from the NOAA
mosaic.

Once the fill is excluded, the two products agree where both report seabed:
mean signed difference **+5.0 m**, median |difference| 18 m, p90 97 m, against
relief of thousands of metres. The −1,550 m apparent disagreement on first
measurement was entirely the fill value.

### Result: the corridor effect strengthens with length

Median km from the cable actually laid, all bands on one 1.85 km grid:

| Band | n | Great circle | Sea path | Terrain (hand-set) | **Corridor** | Corridor+terrain |
|---|---|---|---|---|---|---|
| 40–500 km | 253 | 7.1 | 9.8 | 8.1 | **6.5** | **5.8** |
| 500–1,000 km | 47 | 43.1 | 51.6 | 27.8 | 37.6 | 29.8 |
| 1,000–2,000 km | 28 | 149.4 | 86.1 | 84.3 | **52.7** | **36.9** |
| 2,000+ km | 15 | 268.3 | 248.0 | 178.6 | **55.6** | 97.4 |

Paired, per route:

| Comparison | Band | Better on | p |
|---|---|---|---|
| Corridor vs hand-set terrain | 2,000+ km | **15/15 (100%)** | **0.0003** |
| Corridor vs shortest sea path | 2,000+ km | 13/14 (93%) | 0.0033 |
| Corridor vs shortest sea path | 1,000–2,000 km | 19/22 (86%) | 0.0014 |
| Corridor vs shortest sea path | 500–1,000 km | 32/43 (74%) | 0.0023 |
| Adding terrain on top of corridor | 2,000+ km | 4/15 (27%) | 0.12 |

A reviewer's natural assumption is that corridor reuse is a shallow-water,
landing-point artefact that will not survive in deep ocean. **The data says the
reverse.** It is weakest on the shelf and dominant trans-oceanically, and above
2,000 km adding terrain on top of it actively *hurts*.

### The regional result replicates at the coarser resolution

Same routes, coarser grid: great circle 7.1 (identical, as it must be — the
geodesic does not touch the grid), corridor 6.5 against the published 6.9,
corridor+terrain 5.8 against 6.4, sea path 9.8 against 9.7. The method ordering
is unchanged.

One comparison moved: **corridor vs *fitted* terrain was 55%, p = 0.14 at 460 m
(n = 217) and is 57%, p = 0.0275 at 1.85 km (n = 252).** Both the sample and the
grid changed, so this is a second independent run and not a correction to the
first. It is reported alongside, not in place of, the earlier figure.

### What limits this

**Fold structure collapses above 1,000 km.** Those bands are 24/29 and 13/15
FR SHOM, so fewer than two sources reach the 8-route minimum and
leave-one-source-out cannot run. The fixed-weight methods carry the headline
and need no fitting; the fitted method is reported as unavailable there rather
than quietly fitted on the routes it is tested on.

**The 2,000+ band is essentially two corridors.** Checked directly: five
transatlantic routes (Brittany/Vendée → New York/New Jersey, ~6,000 km) and
four Mediterranean (Marseille → Beirut / Tel Aviv / Alexandria, ~3,000 km).
Real long-haul, but geographically concentrated and single-agency, at n = 15.


---

## 4e. Test 8 — is the corridor result an artefact of a thin candidate set?

**The weakness.** Corridor distance in §4c and §4d is measured against the
412-route EMODnet corpus under same-agency exclusion. For a transatlantic route
that leaves a handful of candidates, all European. Measured: the median distance
from a real route to its nearest corpus candidate is 7.9 km at 40–500 km but
**98.1 km above 2,000 km** — beyond the 25 km saturation scale, so the corridor
term is flat across most of the route. The strongest result in the study rested
on the sparsest possible candidate set.

TeleGeography catalogues 724 systems worldwide. The same measurement against it:
5.1 km, 7.9 km, 9.2 km, **9.0 km** across the four bands — dense everywhere.

### Two problems had to be solved first

**Its geometry is schematic.** 7.3 vertices per 1,000 km, median segment 69 km,
so paths are densified to 2 km before indexing. A densified chord is still a
chord: this is a more *representative* instrument than the corpus, and a
*noisier* one.

**The subject cable is in the candidate set,** and a router that can see the
route it is predicting traces it. There is no agency structure to exclude on —
TeleGeography is one global publisher.

**A fixed exclusion radius does not work on this data, and finding that out was
the useful part.** The best-matching TeleGeography system sits at a median of
12.3 km from a 40–500 km subject, 27.1 km at 1,000–2,000 km and 44.3 km at
2,000+ km, and **no corpus route anywhere has a TeleGeography system within
5 km.** A radius small enough to mean "this is the same cable" fires on nothing;
one large enough to fire discards genuine corridor-mates with it. So systems are
ranked by how closely they shadow the subject and the top *k* are dropped.

### Result

Median km, and share of routes beating a great circle:

| Band | Corpus | TG *k*=0 | TG *k*=1 | TG *k*=3 |
|---|---|---|---|---|
| 40–500 km | 6.4 — 57%, p=0.025 | 7.3 — 52%, ns | 11.0 — **36%, p<1e-4 worse** | 12.3 — **32%, p<1e-4 worse** |
| 500–1,000 km | 37.6 — 57%, ns | 28.5 — 64%, p=0.08 | 39.0 — 53%, ns | 39.1 — 55%, ns |
| 1,000–2,000 km | 52.7 — 82%, p=0.0013 | 36.2 — 79%, p=0.005 | 63.0 — 79%, p=0.005 | 79.7 — **75%, p=0.014** |
| 2,000+ km | 55.6 — 100%, p=0.0003 | 130.1 — 100% | 149.6 — 100% | 155.5 — **100%, p=0.0003** |

**Long-haul survives.** An independent candidate set, an unrelated exclusion
mechanism, three closest-tracking systems removed — and corridor following still
beats a great circle on 75% of 1,000–2,000 km routes and 15/15 above 2,000 km.

**Regionally it fails**, and the reason is measurable rather than mysterious:

| Band | TG geometry error | great-circle error | ratio | outcome |
|---|---|---|---|---|
| 40–500 km | 12.3 km | 7.0 km | **1.76** | hurts |
| 1,000–2,000 km | 27.1 km | 149.4 km | **0.18** | helps |
| 2,000+ km | 44.3 km | 268.3 km | **0.17** | helps |

**Corridor following helps when the error in the neighbour geometry is small
relative to the scale of the prediction, and hurts when it is not.** A corridor
known only to ±12 km cannot improve a 7 km prediction. This also explains why
the corpus beats TeleGeography at 2,000+ km (55.6 against 130.1) despite being
nearly saturated: a handful of *surveyed* transatlantic routes is worth more
than many schematic ones.

### The rule tested per route, not per band

Three band-level points will fit almost any story, and length is confounded
with everything — sea, agency, depth, corridor density. So the ratio was
computed for each route individually, from quantities already recorded by the
run above: how far that route's closest-tracking TeleGeography system sits from
it, over how far a great circle lands from it.

| ratio range | n | median ratio | % of routes helped | median gain |
|---|---|---|---|---|
| 0.04–0.26 | 58 | 0.15 | **90%** | −52.7% |
| 0.26–0.49 | 58 | 0.36 | 67% | −22.9% |
| 0.51–0.93 | 58 | 0.69 | 41% | +22.9% |
| 0.96–1.58 | 58 | 1.25 | 31% | +44.3% |
| 1.59–3.63 | 58 | 2.46 | 29% | +73.6% |
| 3.73–92.88 | 58 | 6.73 | **7%** | +352.1% |

Monotonic across every bin, **Spearman ρ = +0.656 on 348 routes (z = 12.2)**.
Cutting at a ratio of 0.3: 86% of routes below it are improved by corridor
following, against 33% above it.

So the rule is not a post-hoc reading of three bands. It holds route by route
across every band, which makes it a statement about the mechanism rather than
about length — and it is the most directly useful thing in this study for
anyone building such a router, because it says in advance when the method will
fail.

**It is descriptive, not causal.** The ratio and the gain share the
great-circle error as a denominator, so a route that is simply hard to predict
moves both. The binned pattern is the load-bearing part; the correlation
coefficient inherits that shared term and should not be read as an effect size.

**Caveat, against this test's own design.** In the regional band the *k*-sweep
cannot cleanly separate "removed the leak" from "removed the signal", because
TeleGeography's entry for the subject and for its genuine corridor-mates sit at
similar distances. The long bands do not have this problem — there the effect
survives removing three systems.


---

## 4f. Test 9 — do cables avoid fishing grounds?

§6 lists the likely real drivers as "landing-point constraints, existing
infrastructure, fishing and anchoring zones, jurisdiction". Two are measured in
§4b and §4c. This measures the third, and it is the best-motivated of them:
80–86% of cable faults are fishing and anchoring, overwhelmingly in water
shallower than 200 m.

**Data.** EMODnet Human Activities `vesseldensity_01avg` — "Vessel Density
Annual Averages – Fishing", AIS-derived, ~1.7 km native, hours per km² per
month, 2022. Global Fishing Watch (Kroodsma et al., *Science* 2018) is the
citable global source and is downloadable without an account, but its public
grid is 0.1° (~11 km), which cannot resolve a decision on a 1.85 km routing
grid. Staying inside the EMODnet service family also keeps the study's "no API
key, no account, Node only" property.

1,643 tiles built; 144 have no data granule; 1,370 corridor tiles fall outside
coverage entirely (the Pacific and southern-hemisphere routes). **79.9% of
corpus route samples are scoreable.**

**Instrument.** The same placebo-displaced control, with two changes forced by
the data. Percentiles use **midrank** for ties, because fishing effort is
heavily zero-inflated and a cable with both its controls in empty water must
score 50, not 0. Significance is computed **across routes on per-route means**,
never across samples — adjacent vertices sit in the same fishing ground, and
treating 10,000 correlated samples as independent would manufacture
significance out of a handful of routes.

### Result: nothing survives the landfall control

Effect = mean percentile − 50. **Positive means the cable sits in *heavier*
fishing than the water beside it.** `*` marks p < 0.05 across routes.

| displacement | no trim | trim 10 km | trim 25 km | **trim 50 km** |
|---|---|---|---|---|
| 3 km | 0.90\* | 1.34\* | 1.30\* | **0.24** |
| 5 km | **2.05\*** | 1.34\* | 1.47\* | **0.15** |
| 10 km | 0.92 | 0.62 | 0.65 | −0.28 |
| 20 km | 0.86 | 0.11 | −0.43 | −0.50 |
| 50 km | 1.21 | 0.53 | −0.09 | −0.40 |

**There is no fishing-avoidance signal.** What effect exists points the wrong
way — cables in slightly *heavier* fishing — and it vanishes once 50 km of each
end is removed. It is landfall geometry: coastal water is busy, and a
perpendicular control near shore moves offshore into quieter water. The same
confound that took the corridor effect from 68% to 29% in §4b.

Depth stratification agrees. At 5 km displacement the effect is 54.6 on the
shelf, 51.6 on the slope and 49.9 in deep water — confined to exactly the zone
where a coastal artefact would live, and absent where trawling avoidance would
have to show up if it were real.

### Two instrument limits, both fatal to sub-parts of the design

**The reverse-causality test could not be run.** Cable protection zones restrict
fishing near cables, so light fishing beside a cable could be a *consequence* of
the cable. The displacement sweep was designed to discriminate this: suppression
predicts a step as the control leaves the zone, route choice predicts a smooth
rise. It cannot, because the grid is ~1.85 km per cell and a control displaced
1–2 km usually lands in the **same cell** and scores 50 by construction. Those
rows measure the grid, not the sea. The suppression hypothesis is **untested,
not rejected** — a typical zone is narrower than one native cell, and no
resampling fixes that.

**The trim-50 column is biased toward long routes.** n falls from 249 to 150,
because the median corpus route is 171 km and trimming 50 km from each end
removes everything under 100 km.

**Temporal direction**, applying to every number above: the fishing data is 2022
and most corpus cables were laid earlier. Nothing here can establish that route
planners avoided fishing grounds; at most it establishes that cables and fishing
effort are not spatially separated today.


---

## 5. Threats to validity

**The flattest quartile sits at the measurement floor.** Q1's local relief is
0.0–1.5 m, the same order as the downsampling error measured on those very
shelf tiles (0.46–1.28 m RMS). Its near-null effect is partly an instrument
limit, not demonstrated absence of preference. This cuts *against* the
dose-response reading from the flat end as well.

**One source contradicts the main effect — and it is now explained.** DE
BSH-CONTIS shows Δslope **+1.57**, cables on *steeper* ground. It is also the
only source whose median terrain relief (1.0 m) falls **below the grid's own
downsampling error** (1.28 m RMS on shelf tiles). Measured across all sources,
the relief-to-noise ratio is 0.78 for BSH and 1.56–21.5 for every other source
— and every source above the floor agrees with the main finding, with the one
sitting marginally at the boundary (NL Rijkswaterstaat, 1.56) showing the
weakest agreement. The contradiction tracks the measurement floor, not the
agency. This is a **scope condition** — the method needs relief above the
bathymetry's noise — rather than a contradiction of the result.

**The corridor effect was inflated by landfall geometry, and is corrected.**
The three exclusion levels in §4b remove candidates by identity and leave
untouched the fact that cables converge at landing points by necessity. Trimming
the landfall approaches and excluding cables sharing a named landing point takes
the effect from 68% to **29%** (74% of routes, still p < 1e-4). The finding
holds; the uncontrolled figure did not, and any comparison against the terrain
effect must use the controlled one.

**The corridor is bounded.** Bathymetry was loaded within ±1° (~111 km) of each
route. Generous for the median 171 km route, tight for the 49 routes over
1,000 km, whose plausible alternatives may lie outside it.

**Not all features were tested.** Bathymetry (§2–§4a), existing infrastructure
(§4b–§4e) and fishing intensity (§4f) are now measured. Sediment type, anchoring
zones, protected areas and jurisdiction are not. The bathymetric finding is
about *bathymetry*, and the study as a whole still covers only part of what a
route planner weighs.

**Geographic scope.** 75% of corpus length is NW Europe/Mediterranean. The
long-haul extension does not fix this — it *sharpens* it, because the 2,000+ km
band is 13 of 15 routes from one agency and reduces in practice to two
corridors, transatlantic and Marseille–Levant.

**The long bands have no fold structure.** Above 1,000 km, fewer than two
sources reach the 8-route minimum, so leave-one-source-out cannot run and the
fitted-weight method is unavailable there. Fixed-weight methods carry those
results and need no fitting, but the spatially blocked design that protects
§4a's fitted result does not protect §4d's.

**Two resolutions are in play, and they are not interchangeable.** §2–§4c run at
460 m; §4d–§4e at 1.85 km. The coarser grid retains 47% of the slope effect and
55% of the relief effect measured on the same routes (§4d), so long-haul terrain
results carry roughly half the sensitivity. This biases *against* terrain in the
comparison where terrain loses, which is the conservative direction, but it is
not neutral and figures should not be quoted across the two.

**The fishing null has a hole in it.** §4f cannot test whether cable protection
zones suppress fishing near cables, because the surface's ~1.7 km native cell is
wider than a typical zone. That mechanism is untested, not excluded.

**EMODnet's zero-fill was in the data for §2–§4c.** The defect described in §4d
— out-of-coverage encoded as exactly 0, which reads as land — was found while
building the long-haul grid and corrected there. The 460 m tiles used by the
earlier tests were not rebuilt. Those tests filter to routes with valid
elevations and drop null-depth samples, so zero-filled cells are excluded from
terrain statistics rather than counted as shallow seabed; but any route whose
*corridor* crossed a zero-filled region in §4a would have been routed around it
as though around land. The affected regions are Barbados and mid-Atlantic, both
outside the 40–500 km band's coverage box, so the exposure is believed to be
nil — believed, not verified.

---

## 6. What this means

Cables do prefer flatter, less rugged seabed — the effect is real, controlled,
and consistent in sign across five of six independent national sources (one of
those five, MT IOI-MOC, has only 5 routes and should not be leaned on). It is also
**small**, and it does not scale with terrain difficulty in any way that
survives controlling for who published the data.

The most useful reading is the negative one: **bathymetry exerts a weak
influence on local cable position**, and the dominant factors are things not
in the dataset — landing-point constraints, existing infrastructure, fishing
and anchoring zones, jurisdiction.

Two of those are now measured rather than speculated about. Landing-point
constraint and existing infrastructure were separated in §4b: the first accounts
for well over half of what looked like corridor reuse, and the second still
accounts for a 29% effect on three quarters of routes after it is removed. Both
are larger than the bathymetric signal this study set out to test.

That is a direct challenge to the premise of terrain-driven least-cost-path
cable routing, **including the engine in this repository**, which optimises on
depth and seabed difficulty and would, on this evidence, be modelling a
minority of the real decision. It does not make such tools useless — a route
that ignores terrain would be worse — but it does mean their output should be
presented as one input to a decision rather than as an optimum.

### What the extension changed

**The challenge gets stronger with distance, not weaker.** The obvious defence
of terrain-driven routing is that the regional corpus is the wrong test — that
deep-ocean routing is where bathymetry earns its place. §4d tests that directly
and finds the opposite: above 2,000 km, corridor following beats hand-set
terrain on every route measured, and adding terrain on top of corridor actively
hurts (4/15, p = 0.12). The regime the method is marketed for is the regime
where it does worst against a bathymetry-free alternative.

**Corridor reuse is a real mechanism with a stated operating range.** §4e turns
it from an observation into a rule: it helps when the neighbour geometry's error
is small relative to the prediction's scale, and hurts otherwise. That range is
not academic. It says a planner with access to *surveyed* neighbour routes —
which operators have — can beat a bathymetric optimiser, while one working from
public schematic geometry cannot. It also predicts its own failure, which a
purely empirical finding does not.

**And the most-cited explanation for the terrain null is now measured and
wrong.** It is natural to assume that if cables are not following terrain they
must be avoiding the hazard that actually breaks them — fishing gear and
anchors, 80–86% of faults, in water under 200 m. §4f finds no such signal at
all once the landfall approaches are removed. Cables are not routed away from
fishing grounds; the hazard is evidently managed after the route is chosen, by
burial and armouring, rather than by choosing where to go.

Taken together the three results say something narrower and more useful than
"bathymetry is weak". Of the four drivers this study set out to weigh —
terrain, existing infrastructure, fishing, and everything unmeasured — the
second dominates, the first is small, the third is absent, and the residual
error of ~6.4 km against a 7.85 km grid handicap says the fourth is still doing
most of the work.

---

## 7. Reproducing

Every number in this document comes from one of the commands below. No API key,
no account, no prerequisite beyond Node (verified on 24.19). Each script writes
its result to `scripts/research/.cache/` and prints the figures quoted here. The
full cache is about 615 MB, most of it bathymetry tiles.

Runtimes are wall-clock on the machine the study was run on, and are given so a
reader can tell which steps are cheap. Acquisition dominates: after the cache is
built, every test except the prediction fit re-runs in under a minute combined.

### Phase 1 — corpus

```bash
node scripts/research/build-cable-corpus.mjs      # fetch + characterise 412 routes -> cable-corpus.json
```

### Phase 2 — European bathymetry (EMODnet)

Measure the downsampling error *before* downloading against it: the acceptance
threshold for the whole study is that terrain relief exceed this error, and §5
turns it into a scope condition.

```bash
node scripts/research/plan-bathymetry-tiles.mjs        # size the download before committing to it
node scripts/research/validate-scaling.mjs             # downsampling fidelity: 0.46-1.28 m RMS on shelf
node scripts/research/validate-scaling-bias.mjs        # is that error biased, or symmetric noise?
node scripts/research/build-bathymetry-tiles.mjs       # 789 tiles, 90 MB   [~25 min]
node scripts/research/validate-bathymetry-coverage.mjs # orientation, coverage, independent agreement
```

### Phase 3 — global bathymetry (NOAA NCEI mosaic)

EMODnet stops at lat 11..90, lng -70.5..43, which excludes 56 corpus routes --
the French overseas territories, which are also the deepest and longest. This
phase is what the §5 geographic-scope note is measured against; skip it and the
corpus is Europe only.

```bash
node scripts/research/build-global-bathymetry.mjs      # 1,196 tiles, 136 MB   [~40 min]
node scripts/research/validate-global-bathymetry.mjs   # as above, plus: do the two sources agree where they overlap?
```

### Phase 4 — the tests

Ordered as they appear in this document. All read the cache; none re-download.

```bash
node scripts/research/analyse-route-deviation.mjs      # Test 1, section 2          [<1 s]
node scripts/research/analyse-local-preference.mjs     # Test 2 + placebo, section 3   [~17 s]
node scripts/research/analyse-terrain-stratified.mjs   # Test 3, section 4          [~5 s]
node scripts/research/analyse-dose-response.mjs        # the source confound, section 4   [~5 s]
node scripts/research/analyse-bsh-anomaly.mjs          # the contradicting source, section 5   [<1 s]
node scripts/research/evaluate-route-prediction.mjs    # Test 4, section 4a -- leave-one-source-out   [~28 min]
node scripts/research/measure-discretisation-penalty.mjs  # the discretisation control, section 4a   [~21 s]
node scripts/research/analyse-corridor-following.mjs   # Tests 5 and 6, sections 4b and 4c   [~11 s]
node scripts/research/analyse-corridor-endpoint-control.mjs  # the landfall confound, sections 4b and 5   [~12 s]
```

`evaluate-route-prediction.mjs` is by far the slow one, and the only step here
measured in hours rather than seconds: it runs one leave-one-source-out fold per
national source, and each fold searches 8 weight combinations with a full A*
over the 460 m grid for every route, then scores the held-out routes the same
way. Measured at 27 min 40 s across five folds; run it detached. Everything else
in Phase 4 finishes in under 20 seconds.

### Phase 5 — the long-haul extension (sections 4d, 4e)

A second grid, uniform at 60 cells/degree (~1.85 km), covering the A\* search
corridor of every corpus route rather than a dilation around the routes
themselves. That distinction is the point: for a long route the endpoints'
bounding box is enormously larger than the route, and bathymetry downloaded
around the route leaves holes the router reads as land.

```bash
node scripts/research/plan-longhaul-extension.mjs      # size the search and the shortfall first   [~2 s]
node scripts/research/build-longhaul-grid.mjs          # downsample what we hold, fetch the rest   [~15 min]
node scripts/research/validate-longhaul-grid.mjs       # can 1.85 km still see the effect?   [~40 s]
node scripts/research/evaluate-longhaul-prediction.mjs # Test 7, all four bands, section 4d   [~35 min]
node scripts/research/evaluate-corridor-candidates.mjs # Test 8, TeleGeography candidates, section 4e   [~90 min]
node scripts/research/analyse-error-ratio.mjs          # the per-route rule, section 4e   [<1 s]
```

Run `validate-longhaul-grid.mjs` **before** quoting any long-haul number. If the
placebo preference does not survive coarsening, a long-haul null is
indistinguishable from a grid too blunt to see the effect, and §4d would be
uninterpretable rather than negative.

`build-longhaul-grid.mjs` is resumable and takes `--rebuild` to recompute the
derived tiles from source. The download is ~10 MB: 1,706 tiles are block-meaned
from the 240/degree products already in cache and only 1,451 are fetched.

### Phase 6 — fishing effort (section 4f)

```bash
node scripts/research/build-fishing-surface.mjs        # EMODnet vessel density, Fishing, to 60/deg   [~10 min]
node scripts/research/analyse-fishing-preference.mjs   # Test 9, placebo + trim sweep, section 4f   [~15 s]
```

`build-fishing-surface.mjs` takes `--year` (2017–2024, default 2022) and
`--dry-run`. Tiles the service cannot serve return HTTP 500 and are recorded as
uncovered rather than retried; 144 of 1,787 in-envelope tiles have no granule.

### Cheapest way to check the two load-bearing results

The corridor result -- the largest effect in the paper -- is measured purely on
route geometry and touches no bathymetry at all. It needs **Phase 1 only**, so
it can be checked in a couple of minutes without downloading a single tile:

```bash
node scripts/research/build-cable-corpus.mjs                 # Phase 1
node scripts/research/analyse-corridor-following.mjs         # the raw effect   [~11 s]
node scripts/research/analyse-corridor-endpoint-control.mjs  # the controlled 29% figure   [~12 s]
```

The control script additionally reads `public/data/landing-points.json`, which
is committed, so this still needs no download.

The discretisation control reads the EMODnet grid, so it additionally needs
Phase 2, but not Phase 3:

```bash
node scripts/research/measure-discretisation-penalty.mjs  # the control that flipped Test 4's sign   [~21 s]
```

Between them these two cover the finding this paper's conclusion rests on and
the control that reversed one of its headlines -- which is where a sceptical
reader should start.

### Utility

```bash
node scripts/research/inspect-geotiff.mjs <file.tif>   # dump a raster's bbox, resolution, value range
```

Not part of the pipeline. It exists because the EMODnet WCS's resolution,
elevation convention and nodata handling had to be established empirically
before the tile downloader could be written against them.

**Sources.** EMODnet Human Activities (national hydrographic office cable
routes); EMODnet Bathymetry DTM; NOAA NCEI global DEM mosaic (a multi-source
composite, not a single uniform-accuracy product -- labelled as such rather
than as "GEBCO"); TeleGeography (for the fidelity comparison only). All
statistics are permutation- or sign-tested; no distributional assumptions are
made about these heavily skewed quantities.

## 8. Contribution

Four methodological points, each of which changed a headline in this study.

**The placebo-displaced control** for route-preference inference: take the
observed geometry, displace it sideways, re-run the identical measurement to
establish what the instrument reads when no preference exists. Comparing
against a nominal null of 50 would have overstated the depth effect by roughly
70%, and no amount of significance testing would have revealed it.

**The discretisation control** for route-prediction evaluation: measure what a
grid search costs you when it is trying to reproduce a known answer, before
comparing it against an analytic baseline. Without it, this study would have
reported that bathymetry-aware routing is worse than a straight line — a
conclusion that is both wrong and quotable, and that follows directly from the
prediction table if the control is not run.

**The resolution gate** for extending a measurement onto a coarser grid: before
reporting anything from the 1.85 km grid, re-run the *original* measurement at
both resolutions on the same routes and report what fraction of the effect
survives. Coarsening was unavoidable — a 3,000 km corridor is 37.5 million cells
at 460 m against a 2 million expansion cap — and without the gate, a long-haul
null could not be distinguished from an instrument too blunt to see the effect.
The gate passed at 47%/55%/98% retention (§4d), which is why §4d is a finding
rather than an artefact.

**The error-ratio rule** for corridor-based prediction: a corridor term helps
only when the error in the neighbour geometry is small relative to the scale of
the prediction being made. Tested per route on 348 routes it is monotonic across
six bins — 90% of routes helped at the low end, 7% at the high end, Spearman
ρ = +0.656 — so it is a property of the mechanism rather than of route length.
Without it, §4e reads as two contradictory results (corridor following works
long-haul and fails regionally) instead of one rule that predicts both, and
says in advance where the method will fail next.

All four point the same way. An evaluation of route-choice models needs a stated
zero point for its instrument — and neither the nominal null, nor the analytic
baseline, nor the finer grid it was calibrated on, is automatically that zero
point. Each has to be measured.

**A note on what is not claimed as novel.** The displaced control is a variant
of the used-availability design that movement ecology has used for two decades
(step-selection functions; and the shift-and-rotate null model is its closest
published analogue). What is new here is the transfer to engineered linear
infrastructure and the measured consequence of omitting it, not the design
itself. Likewise, reporting the share of admissible weightings under which a
recommendation holds is rank acceptability analysis, which has a name (SMAA) and
a literature. See `docs/literature.md`.
