# Do submarine cables avoid difficult seabed? A placebo-controlled test on 355 as-laid routes

**Status:** complete analysis, negative-leaning result. Reproducible from the scripts in `scripts/research/`.

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

**The corridor is bounded.** Bathymetry was loaded within ±1° (~111 km) of each
route. Generous for the median 171 km route, tight for the 49 routes over
1,000 km, whose plausible alternatives may lie outside it.

**Only bathymetric features were tested.** No sediment type, fishing intensity,
anchoring zones, protected areas, existing infrastructure, or jurisdiction.
The finding is about *bathymetry*, not about route choice in general.

**Geographic scope.** 75% of corpus length is NW Europe/Mediterranean.

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

That is a direct challenge to the premise of terrain-driven least-cost-path
cable routing, **including the engine in this repository**, which optimises on
depth and seabed difficulty and would, on this evidence, be modelling a
minority of the real decision. It does not make such tools useless — a route
that ignores terrain would be worse — but it does mean their output should be
presented as one input to a decision rather than as an optimum.

---

## 7. Reproducing

```bash
node scripts/research/build-cable-corpus.mjs        # fetch + characterise the corpus
node scripts/research/plan-bathymetry-tiles.mjs     # size the download first
node scripts/research/validate-scaling.mjs          # downsampling fidelity
node scripts/research/validate-scaling-bias.mjs     # is the error biased?
node scripts/research/build-bathymetry-tiles.mjs    # ~789 tiles, 90 MB
node scripts/research/validate-bathymetry-coverage.mjs   # acceptance test
node scripts/research/analyse-route-deviation.mjs   # Test 1
node scripts/research/analyse-local-preference.mjs  # Test 2 + placebo
node scripts/research/analyse-terrain-stratified.mjs # Test 3
node scripts/research/analyse-dose-response.mjs     # confound check
```

**Sources.** EMODnet Human Activities (national hydrographic office cable
routes); EMODnet Bathymetry DTM; TeleGeography (for the fidelity comparison
only). All statistics are permutation- or sign-tested; no distributional
assumptions are made about these heavily skewed quantities.

## 8. Contribution

Two methodological points, both of which changed a headline in this study.

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

Both corrections point the same way. An evaluation of route-choice models needs
a stated zero point for its instrument, and neither the nominal null nor the
analytic baseline is that zero point.
