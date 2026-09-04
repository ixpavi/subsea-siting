# Build the paper. Run from anywhere:  powershell -File docs\paper\build.ps1
#
# WHY A SCRIPT AND NOT JUST latexmk. Two things on this machine need working
# around, and both are silent failures if you do not know about them.
#
# 1. PATH contains FILE entries (C:\Program Files\nodejs\node.exe and npm),
#    which are not valid PATH entries. MiKTeX enumerates every PATH directory
#    and aborts outright -- "cannot retrieve attributes for the directory" --
#    before it does any TeX work at all. We filter them for this process only;
#    fixing the real PATH is the user's call, not a build script's.
#
# 2. MiKTeX writes a "you have not checked for updates" line to stderr on every
#    run. PowerShell turns any native stderr output into a NativeCommandError,
#    so a perfectly good build reports failure. We judge success on main.pdf
#    and on the log, not on the exit code.

$ErrorActionPreference = 'Continue'
$paper = Join-Path $PSScriptRoot ''
$miktex = "$env:LOCALAPPDATA\Programs\MiKTeX\miktex\bin\x64"

if (-not (Test-Path $miktex)) {
  Write-Host "MiKTeX not found at $miktex" -ForegroundColor Red
  exit 1
}

$clean = ($env:PATH -split ';' | Where-Object { $_ -and -not (Test-Path $_ -PathType Leaf) }) -join ';'
$env:PATH = "$miktex;$clean"

Push-Location $paper
try {
  # Regenerate everything derived, so the PDF can never be built from stale
  # tables while the cache has moved on.
  Write-Host "== generating tables and figures ==" -ForegroundColor Cyan
  node ..\..\scripts\research\make-paper-tables.mjs
  node ..\..\scripts\research\svg-to-pdf.mjs
  node ..\..\scripts\research\check-paper.mjs
  if ($LASTEXITCODE -ne 0) { Write-Host "check-paper failed" -ForegroundColor Red; exit 1 }

  Write-Host "`n== latex ==" -ForegroundColor Cyan
  foreach ($pass in 1..3) {
    if ($pass -eq 2) { bibtex main 2>&1 | Out-Null }
    pdflatex -interaction=nonstopmode -file-line-error main.tex 2>&1 | Out-Null
    Write-Host "  pass $pass done"
  }

  if (-not (Test-Path main.pdf)) { Write-Host "no main.pdf produced" -ForegroundColor Red; exit 1 }

  # The log is the real verdict. Errors first, then the quality warnings that a
  # reviewer would see as bad typesetting.
  $log = Get-Content main.log -Raw
  $errors    = [regex]::Matches($log, '(?m)^.*?:\d+: .*$')
  $undefRef  = [regex]::Matches($log, '(?m)^LaTeX Warning: (Reference|Citation) .*undefined.*$')
  $overfull  = [regex]::Matches($log, '(?m)^Overfull \\[hv]box.*$')
  $underfull = [regex]::Matches($log, '(?m)^Underfull \\hbox \(badness 10000\).*$')
  $pages     = [regex]::Match($log, 'Output written on main\.pdf \((\d+) pages')

  Write-Host "`n== result ==" -ForegroundColor Cyan
  Write-Host ("  pages            {0}" -f $pages.Groups[1].Value)
  Write-Host ("  errors           {0}" -f $errors.Count)
  Write-Host ("  undefined refs   {0}" -f $undefRef.Count)
  Write-Host ("  overfull boxes   {0}" -f $overfull.Count)
  Write-Host ("  underfull hboxes {0}" -f $underfull.Count)

  foreach ($e in $errors)   { Write-Host "  ! $($e.Value)" -ForegroundColor Red }
  foreach ($u in $undefRef) { Write-Host "  ! $($u.Value)" -ForegroundColor Red }
  foreach ($o in $overfull) { Write-Host "  ~ $($o.Value)" -ForegroundColor Yellow }

  if ($errors.Count -or $undefRef.Count) { exit 1 }
} finally {
  Pop-Location
}
