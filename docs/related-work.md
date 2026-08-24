# Related work, and what is actually new here

Written for the paper's positioning section. Every claim about prior art below
was checked against the source, not recalled — the one that matters most turned
out to be closer to this work than assumed, and it changes the framing.

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

Least-cost path and A* over a rasterised cost surface is textbook, and its
application to submarine cables appears in the literature (e.g. work on
submarine cable path planning using cost surfaces derived from bathymetry and
seabed conditions). Multi-criteria decision analysis over normalised weighted
criteria is likewise standard.

The methods used in this project's routing engine are therefore entirely
conventional, and that is deliberate: the engine exists so the study has a
concrete instance of the thing being tested, not because the search is novel.

**Nothing in this project claims a new routing algorithm.**

---

## 4. Where this work sits

| | Prior work | This work |
|---|---|---|
| Bathymetry → route | Generates routes | Tests whether bathymetry explains real routes |
| Existing routes | Used as training data | Used as **ground truth to evaluate against** |
| Validation | Not reported | The entire contribution |
| Controls | None | Placebo-displaced controls |
| Outcome reported | A route | Prediction error vs baselines, in km |

### The two specific contributions

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
Europe/Mediterranean, because the matched bathymetry product is regional. This
limits generalisation and is the main reason to move to a global product.

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

---

## Citation checklist before submission

- [ ] Verify MakaiPlan's current published capability description and cite the vendor documentation directly
- [ ] Locate and cite specific peer-reviewed least-cost-path submarine cable routing papers rather than referring to the category
- [ ] Confirm the patent's claim set has not been amended post-grant
- [ ] Cite EMODnet Human Activities and EMODnet Bathymetry with their DOIs and access dates
- [ ] Cite ERA5 / Open-Meteo, WRI Aqueduct and Our World in Data for the siting side if the tool is described at all
