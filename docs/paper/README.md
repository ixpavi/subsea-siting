# The paper

*Corridor Reuse Outperforms Bathymetry in Submarine Cable Route Prediction: A
Controlled Evaluation on 412 As-Laid Routes* — **Pavitra Sharma and Dhanush D**.

IEEE submission version of the study in
[`../seabed-route-preference-study.md`](../seabed-route-preference-study.md).
The study document is the full engineering record; this is the ~10-page argument
built from it.

**Final. Compiles clean.** 10 pages, 8 figures, 11 tables, 25 references;
0 errors, 0 undefined references, 0 overfull and 0 underfull boxes. Built with
MiKTeX 25.12 / pdfTeX 1.40.28. Every reference with a DOI was checked against
Crossref, and both patents against Google Patents.

## Build

One command does everything — regenerate, convert, check, compile, report:

```bash
powershell -ExecutionPolicy Bypass -File docs/paper/build.ps1
```

It reports pages, errors, undefined references and overfull boxes from the log,
and exits non-zero on anything that would embarrass you in review.

The steps individually, if you want them:

```bash
node scripts/research/make-paper-tables.mjs   # tables/ + numbers.tex, from .cache/
node scripts/research/svg-to-pdf.mjs          # docs/figures/*.svg -> figures/*.pdf
node scripts/research/check-paper.mjs         # cross-file checks, no TeX needed
```

then, from `docs/paper/`, `latexmk -pdf main` or `pdflatex` → `bibtex` →
`pdflatex` → `pdflatex`.

### Two local quirks the build script works around

**PATH contains file entries.** `C:\Program Files\nodejs\node.exe`, `npm` and
`npm.cmd` are on `PATH` as if they were directories. MiKTeX enumerates every
`PATH` directory and aborts outright — *"cannot retrieve attributes for the
directory"* — before doing any TeX work. `build.ps1` filters them for its own
process only. Fixing the real `PATH` is worth doing; other tools that scan it
will hit the same wall.

**MiKTeX writes to stderr on every run** ("you have not checked for updates"),
and PowerShell turns any native stderr output into a `NativeCommandError`. A
perfectly good build therefore reports failure if you judge it by exit code.
`build.ps1` judges by `main.pdf` and the log instead.

No local TeX? Upload this directory to Overleaf — `IEEEtran` is in its image, so
it compiles with no setup.

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

- [ ] **Affiliation.** IEEE journals require one. Set `\authoraffiliation` near
      the top of `main.tex` (one line), then rebuild. While it is empty the
      first-page footnote gives the corresponding author only, so the PDF never
      prints a placeholder.
- [x] Authors: Pavitra Sharma and Dhanush D; Pavitra Sharma corresponding.
- [x] *Optimising submarine cable routes from offshore wind farms* (Walsh,
      Holloway & Lim, 2026) — now open access. It routes export cables by
      least-cost path with existing cables as an exclusion layer and does not
      compare with installed routes, so the "never measured" framing stands. Cited.
- [x] US 11,031,757 B2 is active with no reexamination or correction listed;
      US 10,425,280 B2 (City University of Hong Kong) is least-cost optimisation,
      not learning, and is cited in Related Work.
- [x] Access dates on every dataset and web entry in `refs.bib`.
- [x] Bibliography checked against Crossref: two author lists corrected
      (Wang et al. 2018 and 2020), one co-author name (J. Guo), and missing
      pages, issues and DOIs filled.
- [ ] Optional: the remaining `[VERIFY]` entries in `../literature.md`. None
      of them is cited here, so this can only add citations, never correct one.

For the submission portal, upload `main.tex`, `numbers.tex`, `refs.bib`,
`main.bbl`, `tables/` and `figures/` — or just `main.pdf` where a PDF is
enough.
