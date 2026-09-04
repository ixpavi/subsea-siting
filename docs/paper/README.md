# The paper

IEEE submission draft of the study in
[`../seabed-route-preference-study.md`](../seabed-route-preference-study.md).
The study document is the full engineering record; this is the ~10-page argument
built from it.

**Compiles clean.** 9 pages, 0 errors, 0 undefined references, 0 overfull
boxes, 1 underfull hbox (cosmetic). Built with MiKTeX 25.12 / pdfTeX 1.40.28.

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

- [ ] Fill in the author affiliation in the `\thanks` block.
- [ ] Decide the author list. Currently one name.
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
