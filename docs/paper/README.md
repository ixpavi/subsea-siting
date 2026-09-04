# The paper

IEEE submission draft of the study in
[`../seabed-route-preference-study.md`](../seabed-route-preference-study.md).
The study document is the full engineering record; this is the ~10-page argument
built from it.

**Not yet compiled.** There is no LaTeX toolchain on the machine this was
written on. `check-paper.mjs` verifies every cross-file coupling a compile would
catch — macros, labels, citations, includes, environment balance, table column
counts — but it cannot see layout. Overfull boxes, float placement and the real
page count need `pdflatex`.

## Build

```bash
node scripts/research/make-paper-tables.mjs   # tables/ + numbers.tex, from .cache/
node scripts/research/svg-to-pdf.mjs          # docs/figures/*.svg -> figures/*.pdf
node scripts/research/check-paper.mjs         # cross-file checks
```

Then, from `docs/paper/`:

```bash
latexmk -pdf main
```

or `pdflatex main` → `bibtex main` → `pdflatex main` → `pdflatex main`.

With no local TeX, upload this whole directory to Overleaf — `IEEEtran` is
already in its TeX Live image, so it compiles with no further setup.

## What is generated and what is written

| Path | Origin |
|---|---|
| `main.tex` | written by hand |
| `refs.bib` | written by hand, from `../literature.md` |
| `tables/*.tex` | **generated** by `make-paper-tables.mjs` |
| `numbers.tex` | **generated** — the `\n…` macros used in prose |
| `figures/*.pdf` | **generated** from `../figures/*.svg` |

Do not edit anything in the generated rows; re-run the generator. Every headline
figure in the prose is a macro, so the argument cannot silently drift from the
analysis cache. Secondary values are read off the generated table on the same
page — cheaper to read, but the generator cannot check them, so re-read the
prose after any re-analysis.

## Venue

Set for an IEEE journal: `\documentclass[journal]{IEEEtran}`. The direct
competitors are published in *IEEE Access*, which makes it a proven fit for the
topic and open-access, at the cost of an article processing charge.

For a conference, change the class option to `[conference]` and cut
Sections VI-B, VII-C and Tables VI and IX — those exist to survive a journal
reviewer rather than to carry the argument.

## Before submitting

- [ ] Compile it. Fix overfull boxes and float placement.
- [ ] Fill in the author affiliation in the `\thanks` block.
- [ ] Read *Optimising submarine cable routes from offshore wind farms* (2026),
      *J. Ocean Eng. Marine Energy*, doi:10.1007/s40722-026-00472-7 — paywalled,
      and the one recent paper that could contain the validation this work
      claims is missing.
- [ ] Clear the remaining `[VERIFY]` entries in `../literature.md`. Nothing
      marked `[VERIFY]` is cited here, so this only adds citations; it does not
      correct any.
- [ ] Confirm US 11,031,757 B2's claim set has not been amended post-grant, and
      check US 10,425,280 — a second patent changes the prior-art paragraph.
- [ ] Add access dates to the dataset entries in `refs.bib`.
