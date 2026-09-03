# Literature search — annotated, organised by the role each work plays

**Status:** first pass, September 2026. Every entry below was returned by a
literature search and its abstract or full text read; entries marked
**[VERIFY]** still need the bibliographic record confirmed at source before
they go in a reference list.

This file exists to close the gap flagged in `related-work.md`:

> Locate and cite specific peer-reviewed least-cost-path submarine cable
> routing papers rather than referring to the category.

That gap is now closed, and the search changed two things about the paper's
positioning. Both are recorded in §7.

---

## 1. The headline result of this search

**Two independent peer-reviewed submarine-cable routing papers explicitly
decline to validate their generated routes against as-laid cables.**

This matters more than any single citation. Until now the claim "nobody has
published the number" rested on a patent that is silent on validation —
arguing from absence in a document that had no obligation to report it. It can
now be made from the peer-reviewed record, where the omission is *stated by the
authors themselves*:

- **Wang et al. (2024, PLOS ONE)** compare Fast Marching, Dijkstra and great
  circle over Mediterranean bathymetry and describe their own output as
  *"an initial guideline or benchmark rather than the final route."* No accuracy
  metric against deployed cables appears anywhere in the paper.
- **Makrakis et al. (2023, Applied Sciences)** build an AHP + least-cost-path
  tool over SRTM+ bathymetry with seismic fault criteria, applied to real case
  studies — and report no comparison against the cables that were actually laid.

So the field optimises, compares optimisers against *each other* on cost, and
does not ask whether the optimum resembles reality. That is a clean,
documentable gap, and it is the paper's opening paragraph.

---

## 2. Submarine cable route optimisation — the method under test

The methods this study evaluates. Cite these as the category; cite Wang 2024
and Makrakis 2023 specifically for the validation gap.

1. **Wang, T., Wang, Z., Moran, B., Wang, X., & Zukerman, M. (2024).**
   Evaluating and refining undersea cable path planning algorithms: A
   comparative study. *PLOS ONE*, 19(12), e0315074.
   <https://doi.org/10.1371/journal.pone.0315074>
   — FMM vs Dijkstra vs great circle; GMRT bathymetry, Mediterranean
   (45°N–36°N, 0°E–11°E); cost = length + depth + slope + risk penalty at
   $25,000/km. FMM 2.1–28% lower weighted cost than Dijkstra, 1.5–3× slower.
   **Open access, most recent, and the single most important citation for us:
   it is a 2024 comparative evaluation that evaluates on cost, not on fidelity.**

2. **Makrakis, N., Psarropoulos, P. N., & Tsompanakis, Y. (2023).**
   GIS-Based Optimal Route Selection of Submarine Cables Considering Potential
   Seismic Fault Zones. *Applied Sciences*, 13(5), 2995.
   <https://doi.org/10.3390/app13052995>
   — AHP-weighted multi-criteria + LCPA; SRTM+ 30 arc-second bathymetry; adds
   fault-crossing strain assessment. Open access. **[VERIFY]** volume/article
   number confirmed via Google Scholar record; PDF at vliz.be was partly
   unextractable.

3. **Wang, Q., Guo, J., Wang, Z., Tahchi, E., Wang, X., Moran, B., &
   Zukerman, M. (2019).** Cost-Effective Path Planning for Submarine Cable
   Network Extension. *IEEE Access*, 7.
   <https://doi.org/10.1109/ACCESS.2019.2915125>

4. **Wang, Z., Wang, X., Moran, B., & Zukerman, M. (2018).** Application of the
   fast marching method for path planning of long-haul optical fiber cables with
   shielding. *IEEE Access*, 6, 41367–41378. **[VERIFY]** DOI.

5. **Wang, Z., et al. (2017).** Multiobjective path optimization for critical
   infrastructure links with consideration to seismic resilience.
   **[VERIFY]** journal — likely *Computer-Aided Civil and Infrastructure
   Engineering*.

6. **Optimal Submarine Cable Path Planning and Trunk-and-Branch Tree Network
   Topology Design (2020).** *IEEE/ACM Transactions on Networking*.
   <https://doi.org/10.1109/TNET.2020.2988047> — Steiner-tree formulation,
   Lagrangian Fast Marching (LAFM). **[VERIFY]** author list.

7. **Zhao, et al. (2023).** Multi-Objective Optimization for Submarine Cable
   Route Planning Based on the Ant Colony Optimization Algorithm. **[VERIFY]**
   venue and year.

8. **Zhao, et al. (2016).** Route Selection for Cabling Considering Cost
   Minimization and Earthquake Survivability Via a Semi-Supervised Probabilistic
   Model. **[VERIFY]** venue — appears to be an IEEE transactions.

9. **Blaise & Spinewine (2021).** Curvature-constrained undersea cable path
   optimisation on parallel architectures. **[VERIFY]**

10. **Huang, et al. (2017).** A* path planning with AUV motion constraints.
    **[VERIFY]**

11. **Optimising submarine cable routes from offshore wind farms (2026).**
    *Journal of Ocean Engineering and Marine Energy*.
    <https://doi.org/10.1007/s40722-026-00472-7> — paywalled, not yet read.
    Recent and directly adjacent; **must be read before submission** in case it
    contains the validation this paper claims is absent.

12. **Optimized routing of interconnected subsea pipelines using geospatial
    cost-surface modelling (2025).** **[VERIFY]** — pipelines, not cables, but
    the same cost-surface method and worth one sentence.

13. **Submarine Cable Network Design for Regional Connectivity.**
    arXiv:2201.05802 — preprint; check for a published version.

**Positioning note.** Zukerman's group at City University of Hong Kong is the
dominant cluster here (entries 1, 3, 4, 5, 6). A submission to an IEEE venue
will very likely be reviewed by someone from or adjacent to it. That is an
argument for scrupulous fairness to their work: the paper should say these are
well-built optimisers whose objective function has never been checked against
reality, not that they are wrong.

---

## 3. The placebo control has a mature home in another field

**This is the finding that most affects the paper's novelty claim, and it needs
handling head-on.**

Comparing an observed path against displaced or resampled alternatives that
share its geometry is the foundational design of **step-selection analysis** in
movement ecology, where it is a matched case-control / used-availability design
fitted by conditional logistic regression. The displaced-control idea is not new
as a *statistical design*; what is new is applying it to engineered linear
infrastructure and to the evaluation of a routing tool.

14. **Thurfjell, H., Ciuti, S., & Boyce, M. S. (2014).** Applications of
    step-selection functions in ecology and conservation. *Movement Ecology*,
    2:4. <https://doi.org/10.1186/2051-3933-2-4>
    — The standard review. Observed "steps" matched against random available
    steps from the same origin.

15. **Avgar, T., Potts, J. R., Lewis, M. A., & Boyce, M. S. (2016).**
    Integrated step selection analysis: bridging the gap between resource
    selection and animal movement. *Methods in Ecology and Evolution*, 7(5),
    619–630. <https://doi.org/10.1111/2041-210X.12528>

16. **Michelot, T., et al. (2019).** Linking resource selection and step
    selection models for habitat preferences in animals. *Ecology*, 100(1),
    e02452. <https://doi.org/10.1002/ecy.2452>

17. **Ridder, et al. (2024).** Generating spatially realistic environmental null
    models with the shift-&-rotate approach helps evaluate false positives in
    species distribution modelling. *Methods in Ecology and Evolution*.
    <https://doi.org/10.1111/2041-210X.14443>
    — **The closest published analogue to the displaced placebo.** Shift-and-
    rotate preserves the spatial structure of the predictor while destroying its
    alignment with the response, exactly the logic of displacing a cable
    sideways. Cite this as the precedent the method adapts.

18. **Wagner, H. H., & Dray, S. (2015).** Generating spatially constrained null
    models for irregularly spaced data using Moran spectral randomization
    methods. *Methods in Ecology and Evolution*, 6(10).
    <https://doi.org/10.1111/2041-210X.12407>
    — Relevant caveat: Moran spectral randomization is *sensitive to linear
    trend*. Worth one line, since displaced controls along a heading may inherit
    a depth trend.

**How to handle this.** Do not claim the placebo control as an invention. Claim
it as a transfer, and let the *measurement* carry the novelty: the finding that
a nominal null would have overstated the depth effect by ~70% is the
contribution, and it stands regardless of who invented the design. Framed this
way it gets stronger, not weaker — "a design validated in movement ecology,
applied here for the first time to engineered infrastructure, and it changes the
answer" is a better sentence than "we invented a control."

---

## 4. Learning route cost from observed paths

This is the literature that has already formalised "recover the cost function
that explains observed routes." It is the natural home for the §4a prediction
fit, and it also supplies the honest framing for why fitting weights did not
beat guessing them.

19. **A deep inverse reinforcement learning approach to route choice modeling
    with context-dependent rewards (2023).** *Transportation Research Part C*.
    Preprint: arXiv:2206.10598. **[VERIFY]** volume/DOI.
    — Adversarial IRL adapted to link-based route choice; validated on taxi GPS
    against classical discrete-choice models.

20. **Zimmermann, M., & Frejinger, E. (2019).** A tutorial on recursive models
    for analyzing and predicting path choice behavior. arXiv:1905.00883.
    **[VERIFY]** published venue.
    — Recursive logit. The canonical reference for path choice as sequential
    decision-making.

21. **A state-based inverse reinforcement learning approach to model
    activity-travel choices behavior with reward function recovery (2023).**
    *Transportation Research Part C*. **[VERIFY]**

22. **Learning Sequential Mobility Choice: A Review of Route and Activity Choice
    through Inverse Reinforcement and Imitation Learning.** arXiv:2608.15339 —
    recent review, useful for a one-paragraph summary of the field.

**Why this matters for the paper.** Google's US 11,031,757 B2 is, in this
vocabulary, an IRL-flavoured approach with no reported validation. Naming the
transport-science literature lets the paper say precisely what the patent does
and what it omits, in terms a reviewer already accepts. It also pre-empts
"why didn't you just fit a richer model?" — the answer is §4a's, that fitting
did not beat guessing, which is a *result about the signal*, not a modelling
shortcoming.

---

## 5. How to measure the distance between two routes

The prediction error in §4a is currently a median distance. Reviewers in this
area will expect the standard metrics, or a justification for not using them.

23. **Tao, Y., et al. (2021).** A comparative analysis of trajectory similarity
    measures. *GIScience & Remote Sensing*, 58(5). **[VERIFY]** author list
    and DOI.
    — Compares DTW, EDR, LCSS, discrete Fréchet, Fréchet. Fréchet is sensitive
    to global path geometry; DTW to point-wise fidelity.

24. **An effective and versatile distance measure for spatiotemporal
    trajectories (2019).** *Data Mining and Knowledge Discovery*.
    <https://doi.org/10.1007/s10618-019-00615-5> **[VERIFY]** authors.

**Action.** Either add discrete Fréchet alongside the median deviation, or state
explicitly why median cross-track distance is the right measure for a route
whose *endpoints are given* (the usual argument: Fréchet is dominated by the
worst point, and for a fixed-endpoint prediction the quantity a cable engineer
cares about is typical corridor offset, not worst-case excursion). One sentence
either way; leaving it unaddressed is a reviewer opening.

---

## 6. Domain context — why route choice matters, and the corridor debate

25. **Carter, L., Burnett, D., Drew, S., Marle, G., Hagadorn, L.,
    Bartlett-McNeil, D., & Irvine, N. (2009).** *Submarine Cables and the
    Oceans – Connecting the World.* UNEP-WCMC Biodiversity Series No. 31.
    ICPC/UNEP/UNEP-WCMC.
    — The standard domain reference. ICPC fault records 1958–2007: external
    damage accounts for **75%** of all cable faults.

26. **Fishing and anchoring account for ~80–86% of submarine cable faults**,
    ~150–200 faults/year globally, overwhelmingly in **water shallower than
    ~200 m**. Sourced to ITU/ICPC. **[VERIFY]** — trace to a primary ITU or ICPC
    document rather than the trade-press restatements found in search.
    — **Directly load-bearing for this paper.** If the dominant fault mechanism
    is anthropogenic and shallow-water, then a router optimising deep-water
    bathymetric difficulty is optimising the wrong variable. This is
    independent corroboration of the study's negative result, from operational
    fault statistics rather than geometry.

27. **FCC CSRIC IV, Working Group 8 (2014).** *Protection of Submarine Cables
    Through Spatial Separation.*
    <https://transition.fcc.gov/pshs/advisory/csric4/CSRIC_IV_WG8_Report1_3Dec2014.pdf>

28. **FCC CSRIC V, Working Group 4A (2016).** Submarine cable resiliency.
    <https://transition.fcc.gov/bureaus/pshs/advisory/csric5/WG4A_Final_091416.pdf>

29. **Submarine Cable Systems: A Review of Installation, Monitoring, and
    Maintenance Processes and Technologies.** *Processes*.
    <https://doi.org/10.3390/pr14050821> **[VERIFY]** year/volume.

30. **ASEAN Academic Reports on Submarine Cables**, NUS Centre for International
    Law Academic Symposium, May 2024. — policy framing for corridors.

### The corridor finding has a live policy debate waiting for it

This is the most valuable non-obvious result of the search. The literature
records an unresolved tension:

- **Regulators** propose mandatory cable corridors and protection zones to
  separate cables from fishing and anchoring (Indonesia's marine spatial plan
  under Government Regulation No. 32/2019 already designates them; the FCC
  CSRIC work examines spatial separation).
- **Operators generally disfavour** mandatory corridors, on the grounds that
  they force geographic clustering of routes and landings, and clustering
  **magnifies correlated failure** — one anchor drag, several systems.

The §4c result measures how much clustering operators do *voluntarily*, under
controls that remove shared landing points and landfall convergence: **29%
closer than displaced controls on 74% of routes**. That is a number this debate
does not currently have. It says corridor formation is already happening
without a mandate, which cuts at the operators' objection to corridors and
simultaneously quantifies a correlated-failure exposure that nobody has sized.

**Recommendation: this becomes the paper's second contribution and probably its
abstract.** It converts a geometric finding into a policy-relevant measurement,
and it is the part a reviewer will find hardest to call incremental.

---

## 7. What this search changed

**1. The gap is now documented, not asserted.** Cite Wang et al. (2024) and
Makrakis et al. (2023) for routing tools that do not validate against as-laid
cables. The Google patent moves from being the main evidence to being one
example among three — and a commercially significant one, which is exactly the
role it should play.

**2. The placebo control must be repositioned as a transfer.** The
used-availability / step-selection design and the shift-&-rotate null model are
established. Claiming invention here invites a reviewer who knows movement
ecology to reject on novelty. Claiming the *transfer* plus the measured
consequence (~70% overstatement without it) is both honest and sturdier.

**3. Fault statistics independently corroborate the negative result.** 80–86% of
faults are fishing and anchoring, in <200 m water. Terrain-optimising routers
are optimising a variable that is not where the failures come from. Worth a
paragraph in the discussion — it turns a geometric null into an operational
argument.

**4. The corridor result has a policy audience.** See §6. This is the strongest
argument for leading with the corridor finding rather than the terrain null.

---

## 8. Still to do

**Must read before drafting**
- [ ] *Optimising submarine cable routes from offshore wind farms* (2026,
      J. Ocean Eng. Marine Energy) — paywalled. The one recent paper that could
      plausibly contain the validation this study claims is missing. Check first.
- [ ] Wang et al. (2024) PLOS ONE in full, including its reference list — it is
      open access and is the best single map of this literature.
- [ ] Makrakis et al. (2023) in full — confirm no as-laid validation.

**Must verify**
- [ ] Every entry marked **[VERIFY]** above.
- [ ] US 10,425,280, "Method for determining optimal laying arrangement of
      infrastructure link" — surfaced in search, assignee and claim scope not yet
      checked. A second patent in this space changes the prior-art paragraph.
- [ ] Confirm US 11,031,757 B2's claim set has not been amended post-grant
      (already on the `related-work.md` checklist).
- [ ] Primary ITU or ICPC source for the 80–86% fishing/anchoring figure.

**Gaps not yet searched**
- [ ] Cable route *engineering practice* literature — desktop study, route
      position list, survey corridor width. What tolerance does industry
      actually work to? If routes are engineered to a corridor of a few km, then
      a 6.4–7.1 km prediction error is a meaningful benchmark rather than an
      embarrassment, and that reframing needs a citation.
- [ ] Sediment / substrate as a routing criterion — the study tests bathymetry
      only, and a reviewer will ask why not substrate. Establish whether a
      pan-European substrate product at comparable resolution exists (EMODnet
      Geology). If it does, the limitation is a choice and needs defending; if it
      does not, that is a clean answer.
- [ ] Data centre siting MCDA — only needed if the tool's siting half is
      described in the paper at all. Recommend it is not; it dilutes the claim.
