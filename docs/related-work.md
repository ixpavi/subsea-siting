# Related work, and what is actually new here

Written for the paper's positioning section. Every claim about prior art below
was checked against the source, not recalled — the one that matters most turned
out to be closer to this work than assumed, and it changes the framing.

**Covers the study through Test 9.** Two things changed since the first draft.
The validation gap is now documented from the peer-reviewed record rather than
inferred from a patent's silence (§3), and two of what were presented as
contributions turn out to have established homes in other literatures — the
displaced control in movement ecology, the weight-robustness reporting in SMAA.
Both are now claimed as transfers, which is both honest and harder to reject.
See `literature.md` for the annotated bibliography behind this.

---

## 1. The closest prior art: US 11,031,757 B2 (Google LLC)

**"Submarine cable route planning tool"**, filed from provisional 62/903,230
(Sep 2019), published Mar 2021.
<https://patents.google.com/patent/US11031757B2/en>

The independent claim covers:

> receiving bathymetry data; receiving existing route data for a plurality of
> existing underwater cable routes; generating, based on the bathymetry data and
> the existing route data, a model for determining underwater cable routes;
> receiving a request for an underwater cable route connecting a first location
> and a second location; and generating one or more potential underwater cable
> routes using the model.

The specification describes **training a machine learning model using the
received bathymetry data and the existing route data as training data** — the
bathymetry around existing routes as input, the route coordinates as the
target.

### What this means for us, stated plainly

Two things, and the second is the useful one.

**It rules out one of our planned directions.** Fitting a cost surface from
observed routes and bathymetry, then using it to generate routes, is
substantially what this patent claims. As a *routing method* contribution, that
is prior art with a large assignee behind it. It should not be the headline.

**It creates the gap this work fills.** The patent trains on existing routes
because it **assumes those routes are the outcome of optimising over
bathymetry**. That assumption is never tested in the document: it reports **no
validation, no accuracy metric, and no comparison of generated routes against
as-laid ones**. The premise is taken as given and the machinery is built on top
of it.

That is precisely the premise this study measures.

> The patent assumes bathymetry explains where cables go.
> This work tests whether it does, and by how much.

A validation of an assumption underpinning a granted patent and a commercial
product category is a legitimate and well-defined contribution. It is also a
harder claim to dismiss than another routing tool, because nobody else has
published the number.

---

## 2. Commercial route planning

**MakaiPlan** (Makai Ocean Engineering) is the established commercial submarine
cable route planning package, used in real cable projects for route engineering,
slack management and installation planning.

It is prior art for the *tool*: interactive cable route design over bathymetry
with cost estimation is a solved, commercially available problem. Any framing
that presents this project's application as novel software would be rejected on
that basis alone.

It is **not** prior art for the measurement. Commercial tools optimise; they do
not publish evaluations of whether their optimisation reproduces routes that
were actually laid.

---

## 3. Academic least-cost-path routing

Least-cost path and A\* over a rasterised cost surface is textbook, and its
application to submarine cables is a small but active literature dominated by
one group. Multi-criteria decision analysis over normalised weighted criteria
is likewise standard.

The methods used in this project's routing engine are therefore entirely
conventional, and that is deliberate: the engine exists so the study has a
concrete instance of the thing being tested, not because the search is novel.

**Nothing in this project claims a new routing algorithm.**

### The gap is documented, not asserted

This is the most important change to this document. The claim that nobody has
validated generated routes against as-laid cables previously rested on a patent
that was *silent* on validation — an argument from absence in a document with no
obligation to report it. It can now be made from the peer-reviewed record, where
the omission is stated by the authors themselves.

**Wang, T., Wang, Z., Moran, B., Wang, X., & Zukerman, M. (2024).** Evaluating
and refining undersea cable path planning algorithms: A comparative study.
*PLOS ONE* 19(12), e0315074. <https://doi.org/10.1371/journal.pone.0315074>

> Compares Fast Marching, a Dijkstra variant and a great circle over
> Mediterranean bathymetry, with a cost function of length, depth, slope and a
> risk penalty. It describes its own output as **"an initial guideline or
> benchmark rather than the final route"**, and contains no accuracy metric
> against any deployed cable. This is the single most important citation here:
> a 2024 comparative *evaluation* that evaluates on modelled cost, never on
> fidelity to reality.

**Makrakis, N., Psarropoulos, P. N., & Tsompanakis, Y. (2023).** GIS-Based
Optimal Route Selection of Submarine Cables Considering Potential Seismic Fault
Zones. *Applied Sciences* 13(5), 2995. <https://doi.org/10.3390/app13052995>

> AHP-weighted multi-criteria plus least-cost-path over SRTM+ bathymetry, with
> fault-crossing strain assessment, applied to real case studies — and no
> comparison against the cables that were actually laid.

The rest of the cluster, cited as the category rather than individually
attacked:

- **Wang, Q., Guo, J., Wang, Z., Tahchi, E., Wang, X., Moran, B., & Zukerman, M.
  (2019).** Cost-effective path planning for submarine cable network extension.
  *IEEE Access* 7. <https://doi.org/10.1109/ACCESS.2019.2915125>
- **Wang, Z., Wang, X., Moran, B., & Zukerman, M. (2018).** Application of the
  fast marching method for path planning of long-haul optical fibre cables with
  shielding. *IEEE Access* 6, 41367–41378.
- **Optimal submarine cable path planning and trunk-and-branch tree network
  topology design (2020).** *IEEE/ACM Transactions on Networking* 28(4).
  <https://doi.org/10.1109/TNET.2020.2988047>
- **Wang, X., Wang, Z., Wang, T., & Zukerman, M. (2023).** Designing
  cost-effective and reliable submarine communications cable path: lessons from
  the Tonga volcano disaster. *IEEE Communications Magazine* 61.

**A positioning note that matters more than any single citation.** This cluster
is substantially one group at City University of Hong Kong. A submission to an
IEEE venue will very likely be reviewed by someone from or adjacent to it. The
line must therefore be *these are well-built optimisers whose objective function
has never been checked against reality* — not that they are wrong. They are not
wrong; they are unvalidated, and they say so.

**Still to read before submission:** *Optimising submarine cable routes from
offshore wind farms* (2026), *Journal of Ocean Engineering and Marine Energy*,
<https://doi.org/10.1007/s40722-026-00472-7>. Paywalled and not yet obtained. It
is the one recent paper that could plausibly contain the validation this work
claims is missing, and the framing has to be checked against it rather than
after a reviewer finds it.

---

## 4. Where this work sits

| | Prior work | This work |
|---|---|---|
| Bathymetry → route | Generates routes | Tests whether bathymetry explains real routes |
| Existing routes | Used as training data | Used as **ground truth to evaluate against** |
| Validation | Not reported | The entire contribution |
| Controls | None | Placebo-displaced controls, landfall trim, discretisation, resolution gate |
| Route length | Trans-oceanic, untested | **Every band, 40 km to 6,400 km, measured** |
| Outcome reported | A route | Prediction error vs baselines, in km |
| When the method fails | Not stated | **Predicted in advance by a measured rule** |

### The four specific contributions

**1. A placebo control for route-preference inference.**
Take the observed geometry, displace it sideways, re-run the identical
measurement. Displaced lines are not cables and cannot express engineering
preference, but they share shape, length, heading and terrain — so whatever
they score is what the instrument reads when no preference exists.

This is not a refinement. On our data, comparing against a nominal null instead
of the placebo would have **overstated the depth effect by roughly 70%**, and no
amount of significance testing would have revealed it, because the bias is in
the instrument rather than in the sampling.

**2. Prediction error against as-laid routes, with baselines.**
Every method is given only two endpoints and asked to predict the route; the
error is the distance from the cable that was really laid. Crucially, all
terrain-aware methods use the **same search over the same bathymetry**,
differing only in cost weights — so any difference between them is attributable
to the terrain preference and not to the search, grid, or corridor.

The geodesic baseline is the floor: it does not even know where the water is.
The question the paper answers is how far above that floor terrain optimisation
actually gets.

**3. A resolution gate for extending a measurement onto a coarser grid.**
Long-haul routing cannot be tested at 460 m — a 3,000 km corridor is 37.5
million cells against a 2 million expansion cap. Coarsening to 1.85 km is
unavoidable, and without a gate a long-haul null would be indistinguishable from
an instrument too blunt to see the effect. So the *original* measurement is
re-run at both resolutions on the same routes and the retained fraction is
reported before any new number is quoted: 47% of the slope effect, 55% of
relief, 98% of depth, same sign throughout.

This is the same discipline as the discretisation control, applied to a
different axis. An evaluation that changes its instrument owes the reader a
measurement of what the change cost.

**4. The error-ratio rule, which says in advance when corridor following will
fail.** A corridor cost term helps only when the error in the neighbour geometry
is small relative to the scale of the prediction being made. Measured per route
on 348 routes it is monotonic across six bins — 90% of routes improved at the
low end, 7% at the high end, Spearman ρ = +0.656 — and it holds *within* every
length band, so it is a property of the mechanism rather than of route length.

This is the most directly useful result here for anyone building such a router,
and the only one that is predictive rather than descriptive. It also resolves
what would otherwise read as two contradictory findings: corridor following
works trans-oceanically and fails regionally, because public schematic geometry
is accurate enough for a 268 km problem and not for a 7 km one.

### What is NOT claimed as novel, stated before a reviewer says it

**The displaced control is a transfer, not an invention.** Comparing an observed
path against displaced alternatives that share its geometry is the foundational
design of step-selection analysis in movement ecology — a matched case-control
used-availability design fitted by conditional logistic regression (Fortin et
al. 2005, *Ecology* 86(5); Thurfjell, Ciuti & Boyce 2014, *Movement Ecology*
2:4; Avgar et al. 2016, *Methods Ecol. Evol.* 7(5)). Ridder et al. (2024,
*Methods Ecol. Evol.*) publish a shift-and-rotate null model that is closer
still.

What is new is the application to *engineered linear infrastructure* and to the
evaluation of a routing tool, plus the measured consequence of omitting it. That
framing is stronger, not weaker: "a design validated in movement ecology,
applied here for the first time to engineered infrastructure, and it changes the
answer by 70%" survives a reviewer who knows that literature. "We invented a
control" does not.

**The weight-robustness reporting is SMAA.** Reporting the share of admissible
weightings under which a recommendation holds is rank acceptability analysis
(Lahdelma, Hokkanen & Salminen 1998, *EJOR* 106(1); Lahdelma & Salminen 2001,
SMAA-2, *Operations Research* 49(3), 444–454). The application's restriction to
*selectable* weight levels — so a reported flip point is one the user can
actually reach — is a defensible refinement of SMAA practice and should be
presented as exactly that.

---

## 5. Scope conditions we can now state

Both come from measurements in this study rather than from caution.

**The method requires relief above the bathymetry's noise floor.** One national
source (DE BSH-CONTIS, German Bight) contradicts the main finding. It is also
the only source whose median terrain relief (1.0 m) falls *below* the
downsampling error of the grid itself (1.28 m RMS on shelf tiles). Every source
with relief above that floor agrees with the main finding, and the source
sitting marginally at the boundary shows the weakest agreement. The
contradiction tracks the measurement floor, not the agency — so it is a stated
scope condition, not an unexplained result.

**Geographic coverage is Europe-weighted.** 75% of corpus length is NW
Europe/Mediterranean, because the matched bathymetry product is regional. The
long-haul extension does not fix this — it *sharpens* it. The 2,000+ km band is
13 of 15 routes from one agency and reduces in practice to two corridors,
transatlantic and Marseille–Levant. Broadening it needs as-laid geometry from
non-European hydrographic offices, which is a data-acquisition project rather
than an analysis one.

**Corridor following requires accurate neighbour geometry.** Measured
explicitly: it helps at an error ratio below ~0.3 and hurts above ~1. In
practice that means an operator with surveyed neighbour routes can beat a
bathymetric optimiser, and someone working from public schematic geometry
cannot. The method has an operating range and it is stated.

**The fishing null has a hole that cannot be closed with this instrument.** The
protection-zone reverse-causality mechanism — light fishing beside a cable being
a *consequence* of the cable — is untestable at a ~1.7 km native cell, because a
typical zone is narrower than one cell. Reported as untested, not excluded.

---

## 6. What a reviewer will ask, and the answer

**"Isn't this just least-cost-path routing?"**
No. The routing engine is conventional and is not claimed. The contribution is
the evaluation of whether that class of method reproduces reality.

**"Google already patented learning routes from existing cables."**
Yes — and it reports no validation of the assumption it rests on. This work
supplies that validation. The patent is the strongest argument that the question
matters, since a major operator built machinery on the assumption without
publishing a test of it.

**"Your effect is small. Is that a result?"**
It is the result. A small effect means terrain-driven route optimisation
accounts for a minority of real route choice, which is directly actionable for
anyone building or buying such a tool — including us.

**"One of your sources disagrees."**
It does, and it is the only one below the grid's own error floor. Reported as a
scope condition with the supporting measurement.

**"You tested regional routes and generalised to trans-oceanic ones."**
No longer true, and this was the strongest version of the objection. The
experiment now runs on every length band from 40 km to 6,400 km. The finding
does not merely survive the extension — it *inverts* the expected direction:
corridor following is weakest on the shelf and beats hand-set terrain on 15 of
15 routes above 2,000 km.

**"Your corridor result depends on a thin, Europe-only candidate set."**
It did, and above 2,000 km the corpus index was effectively saturated (98 km
median to the nearest candidate, against a 25 km cost saturation). Re-run
against TeleGeography's 724 systems with the three closest-tracking systems
removed, the long-haul result holds at 75% and 100% of routes. Two unrelated
candidate sets, two unrelated exclusion mechanisms, same conclusion.

**"Your displaced control is just a used-availability design."**
Correct, and §4's contribution list says so first. The transfer to engineered
infrastructure and the measured 70% consequence of omitting it are the claim,
not the design.

**"Isn't the weight-robustness figure just SMAA?"**
Yes. Cited as such. The refinement is restricting the swept space to weightings
the user can actually select, so a reported flip point is reachable.

**"If cables aren't following terrain, aren't they avoiding fishing grounds?"**
That is the natural next hypothesis and it was tested. There is no such signal:
the apparent effect is landfall geometry and vanishes once 50 km of each route
end is removed. The hazard responsible for 80–86% of faults appears to be
managed after the route is chosen — by burial and armouring — rather than by
choosing where to go.

**"Two resolutions are used. Are the numbers comparable?"**
Not across sections, and the study says so. The resolution gate reports what
coarsening costs (47%/55%/98% retention), and the regional band is deliberately
re-run on the coarse grid so the two can be set side by side rather than
silently mixed.

---

## Citation checklist before submission

- [x] ~~Locate and cite specific peer-reviewed least-cost-path submarine cable routing papers rather than referring to the category~~ — done, §3
- [ ] **Read *Optimising submarine cable routes from offshore wind farms* (2026), J. Ocean Eng. Marine Energy — paywalled, and the one paper that could contain the validation this work claims is missing**
- [ ] Verify every `[VERIFY]`-marked entry in `literature.md` at source
- [ ] Verify MakaiPlan's current published capability description and cite the vendor documentation directly
- [ ] Confirm the patent's claim set has not been amended post-grant
- [ ] Check US 10,425,280 ("Method for determining optimal laying arrangement of infrastructure link") — assignee and claim scope unknown; a second patent changes the prior-art paragraph
- [ ] Cite EMODnet Human Activities and EMODnet Bathymetry with their DOIs and access dates
- [ ] Cite the NOAA NCEI global DEM mosaic as a multi-source composite, **not** as "GEBCO"
- [ ] Cite Kroodsma et al. (2018), *Science* 359(6378), 904–908 for Global Fishing Watch, with Amoroso et al.'s published resolution critique alongside it
- [ ] Cite the step-selection literature (Fortin 2005; Thurfjell 2014; Avgar 2016) and Ridder et al. (2024) for the displaced control
- [ ] Cite SMAA (Lahdelma, Hokkanen & Salminen 1998; Lahdelma & Salminen 2001) for weight robustness
- [ ] Cite the nearest siting competitor: *Macro-Regional Spatial Decision Support for Geo-Distributed Data Center Siting in Europe*, IJGI 15(7), 294 (2026) — it tests four weighting scenarios where this work enumerates the space
- [ ] Trace the 80–86% fishing/anchoring fault figure to a primary ITU or ICPC document, not trade-press restatements
- [ ] Cite ERA5 / Open-Meteo, WRI Aqueduct and Our World in Data for the siting side if the tool is described at all
- [ ] Cite the sources the app uses but the report does not name: Google's data-centre efficiency disclosures (the PUE fit), NASA POWER (its climate predictor), Uptime Institute (tier availability)
