# Technical report

*Corridor Reuse Outperforms Bathymetry in Submarine Cable Route Prediction: A
Controlled Evaluation on 412 As-Laid Routes* — Pavitra Sharma and Dhanush D,
Department of Computing Technologies, SRM Institute of Science and Technology.

The full written account of the study in
[`../seabed-route-preference-study.md`](../seabed-route-preference-study.md),
which remains the complete engineering record. PDF: [`main.pdf`](main.pdf).

## Build

One command regenerates the tables, figures and number macros from the
analysis cache, checks the cross-references and compiles:

```bash
powershell -ExecutionPolicy Bypass -File docs/paper/build.ps1
```

The steps individually:

```bash
node scripts/research/make-paper-tables.mjs   # tables/ + numbers.tex, from .cache/
node scripts/research/svg-to-pdf.mjs          # docs/figures/*.svg -> figures/*.pdf
node scripts/research/check-paper.mjs         # cross-file checks, no TeX needed
```

then, from `docs/paper/`, `latexmk -pdf main` or `pdflatex` → `bibtex` →
`pdflatex` → `pdflatex`. Without a local TeX installation the directory also
compiles on Overleaf, which includes `IEEEtran`.

`build.ps1` works around two quirks of some Windows setups: file entries on
`PATH` (which stop MiKTeX before it starts) and MiKTeX's update notice on
stderr (which PowerShell reports as a failure). It judges the build by
`main.pdf` and the log instead.

## What is generated and what is written

| Path | Origin |
|---|---|
| `main.tex` | written by hand |
| `refs.bib` | written by hand |
| `tables/*.tex` | **generated** by `make-paper-tables.mjs` |
| `numbers.tex` | **generated** — the `\n…` macros used in prose |
| `figures/*.pdf` | **generated** from `../figures/*.svg` |

Do not edit the generated files; re-run the generator. Every headline number in
the prose is a macro, so the text cannot silently drift from the analysis
cache.
