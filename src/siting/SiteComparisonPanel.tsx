// Side-by-side comparison of candidate data-centre sites.
//
// The rest of the tool answers "what is this location like". This answers
// "which of these should I choose", which is the question a siting decision
// actually starts from.
//
// Two presentation rules the engine's honesty depends on:
//   - Excluded criteria are shown WITH their reason, not hidden. A user who
//     cannot see that water stress was dropped has no way to know the ranking
//     ignored it.
//   - Every column carries its provenance. The PUE column is modelled and the
//     rest are measured or directly derived, and a table that presents them
//     identically misrepresents all of them.
import { useCallback, useMemo, useRef, useState } from "react";
import { geocodeLocation } from "../design/geocoding";
import type { GeocodeResult } from "../design/geocoding";
import { COOLING_SPECS } from "../calculator/facilityCalculator";
import type { CoolingConfig } from "../calculator/types";
import type { CableFeature, LandingPoint } from "../types";
import {
  compareSites,
  evaluateSites,
  rawValue,
  SITE_CRITERIA,
  DEFAULT_SITE_WEIGHTS,
  type SiteCriterionId,
  type SiteWeights,
  type SiteComparisonResult,
  type EvaluateSiteInput,
} from "./siteComparison";
import CloseButton from "../CloseButton";
import "./siteComparison.css";

interface CandidateSite {
  id: string;
  label: string;
  lat: number;
  lng: number;
  countryCode?: string;
}

interface Props {
  cables: CableFeature[];
  landingPoints: LandingPoint[];
  onClose: () => void;
  onFocusSite?: (lat: number, lng: number) => void;
}

const MAX_SITES = 6;
const CRITERION_ORDER: SiteCriterionId[] = [
  "freeCooling",
  "adjustedPue",
  "waterStress",
  "gridCarbon",
  "connectivity",
];

function formatValue(id: SiteCriterionId, v: number | null): string {
  if (v === null) return "—";
  switch (id) {
    case "freeCooling":
      return `${v.toFixed(0)}%`;
    case "adjustedPue":
      return v.toFixed(3);
    case "waterStress":
      return v.toFixed(2);
    case "gridCarbon":
      return v.toFixed(0);
    case "connectivity":
      return String(v);
  }
}

export default function SiteComparison({ cables, landingPoints, onClose, onFocusSite }: Props) {
  const [sites, setSites] = useState<CandidateSite[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [weights, setWeights] = useState<SiteWeights>(DEFAULT_SITE_WEIGHTS);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SiteComparisonResult | null>(null);
  const debounceRef = useRef<number | null>(null);

  const coolingOptions = useMemo(() => Object.keys(COOLING_SPECS) as CoolingConfig[], []);

  const handleQuery = useCallback((q: string) => {
    setQuery(q);
    setSearchError(null);
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    debounceRef.current = window.setTimeout(async () => {
      setSearching(true);
      try {
        setResults(await geocodeLocation(q));
      } catch {
        setSearchError("Couldn't reach the geocoding service.");
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 400);
  }, []);

  function addSite(r: GeocodeResult) {
    setSites((prev) => {
      if (prev.length >= MAX_SITES) return prev;
      // Same place twice would produce two identical rows and a meaningless
      // tie, so refuse it rather than rank a site against itself.
      const id = `${r.lat.toFixed(3)},${r.lng.toFixed(3)}`;
      if (prev.some((s) => s.id === id)) return prev;
      return [...prev, { id, label: r.displayName, lat: r.lat, lng: r.lng, countryCode: r.countryCode }];
    });
    setQuery("");
    setResults([]);
    // A newly added site invalidates the previous ranking.
    setResult(null);
  }

  function removeSite(id: string) {
    setSites((prev) => prev.filter((s) => s.id !== id));
    setResult(null);
  }

  async function run() {
    if (sites.length < 2) return;
    setRunning(true);
    try {
      const inputs: EvaluateSiteInput[] = sites.map((s) => ({
        id: s.id,
        label: s.label,
        lat: s.lat,
        lng: s.lng,
        countryCode: s.countryCode,
        coolingOptions,
        cables,
        landingPoints,
      }));
      const evaluations = await evaluateSites(inputs);
      setResult(compareSites(evaluations, weights));
    } finally {
      setRunning(false);
    }
  }

  // Re-rank instantly when weights move: the evaluations are already gathered,
  // and only the MCDA needs redoing. Re-fetching climate data for a slider
  // change would be both slow and pointless.
  function updateWeight(id: SiteCriterionId, w: number) {
    const next = { ...weights, [id]: w };
    setWeights(next);
    setResult((prev) => {
      if (!prev) return prev;
      const evals = [...prev.ranked.map((r) => r.evaluation), ...prev.failed];
      return compareSites(evals, next);
    });
  }

  const excluded = result?.criteria.filter((c) => !c.discriminates) ?? [];

  return (
    <aside className="site-compare" aria-label="Compare candidate sites">
      <header className="site-compare-head">
        <div>
          <h2>Compare candidate sites</h2>
          <p>
            Rank several locations against each other on measured climate, national
            water stress and grid carbon, real cable connectivity, and modelled PUE.
          </p>
        </div>
        <CloseButton onClick={onClose} label="Close site comparison" />
      </header>

      <section className="site-compare-add">
        <label htmlFor="site-compare-search">Add a site ({sites.length}/{MAX_SITES})</label>
        <input
          id="site-compare-search"
          type="text"
          value={query}
          placeholder="City or place name…"
          disabled={sites.length >= MAX_SITES}
          onChange={(e) => handleQuery(e.target.value)}
          autoComplete="off"
        />
        {searching && <p className="site-compare-hint">Searching…</p>}
        {searchError && <p className="site-compare-error">{searchError}</p>}
        {results.length > 0 && (
          <ul className="site-compare-results">
            {results.map((r) => (
              <li key={`${r.lat},${r.lng}`}>
                <button type="button" onClick={() => addSite(r)}>
                  {r.displayName}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {sites.length > 0 && (
        <ul className="site-compare-chips">
          {sites.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className="site-compare-chip-label"
                onClick={() => onFocusSite?.(s.lat, s.lng)}
                title="Show on globe"
              >
                {s.label}
              </button>
              <button
                type="button"
                className="site-compare-chip-remove"
                onClick={() => removeSite(s.id)}
                aria-label={`Remove ${s.label}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        className="site-compare-run"
        onClick={run}
        disabled={sites.length < 2 || running}
      >
        {running ? "Evaluating…" : sites.length < 2 ? "Add at least two sites" : `Compare ${sites.length} sites`}
      </button>

      {result && (
        <>
          <section className="site-compare-weights">
            <h3>Weights</h3>
            <p className="site-compare-hint">
              Re-ranks immediately — the site data is already gathered, only the
              weighting changes.
            </p>
            {CRITERION_ORDER.map((id) => (
              <div key={id} className="site-compare-weight-row">
                <label htmlFor={`w-${id}`}>{SITE_CRITERIA[id].label}</label>
                <input
                  id={`w-${id}`}
                  type="range"
                  min={0}
                  max={3}
                  step={0.5}
                  value={weights[id]}
                  onChange={(e) => updateWeight(id, Number(e.target.value))}
                />
                <span>{weights[id].toFixed(1)}</span>
              </div>
            ))}
          </section>

          {result.indeterminate && result.ranked.length > 0 && (
            <p className="site-compare-warning">
              No criterion separates these sites on the available data. The order below
              is arbitrary and should not be read as a preference.
            </p>
          )}

          {result.ranked.length > 0 && (
            <div className="site-compare-table-wrap">
              <table className="site-compare-table">
                <thead>
                  <tr>
                    <th scope="col">#</th>
                    <th scope="col">Site</th>
                    <th scope="col">Score</th>
                    {CRITERION_ORDER.map((id) => {
                      const c = result.criteria.find((x) => x.id === id);
                      return (
                        <th key={id} scope="col" className={c?.discriminates ? "" : "is-excluded"}>
                          {SITE_CRITERIA[id].label}
                          <span className="site-compare-unit">{SITE_CRITERIA[id].unit}</span>
                          <span className={`site-compare-prov prov-${SITE_CRITERIA[id].provenance}`}>
                            {SITE_CRITERIA[id].provenance}
                          </span>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {result.ranked.map((r) => (
                    <tr key={r.evaluation.id}>
                      <td className="site-compare-rank">{r.rank}</td>
                      <th scope="row">
                        <button type="button" onClick={() => onFocusSite?.(r.evaluation.lat, r.evaluation.lng)}>
                          {r.evaluation.label}
                        </button>
                      </th>
                      <td className="site-compare-score">
                        {result.indeterminate ? "—" : r.score.toFixed(3)}
                      </td>
                      {CRITERION_ORDER.map((id) => {
                        const c = result.criteria.find((x) => x.id === id);
                        const cls = [
                          c?.discriminates ? "" : "is-excluded",
                          r.winsOn.includes(id) ? "is-best" : "",
                          r.losesOn.includes(id) ? "is-worst" : "",
                        ].filter(Boolean).join(" ");
                        return (
                          <td key={id} className={cls}>
                            {formatValue(id, rawValue(r.evaluation, id))}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {result.ranked.length > 0 && (
            <section className="site-compare-why">
              <h3>Why this order</h3>
              {result.ranked.map((r) => (
                <p key={r.evaluation.id}>{r.whyText}</p>
              ))}
            </section>
          )}

          {excluded.length > 0 && (
            <section className="site-compare-excluded">
              <h3>Criteria excluded from scoring</h3>
              <ul>
                {excluded.map((c) => (
                  <li key={c.id}>
                    <strong>{c.meta.label}</strong> — {c.excludedReason}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {result.failed.length > 0 && (
            <section className="site-compare-failed">
              <h3>Could not be evaluated</h3>
              <ul>
                {result.failed.map((f) => (
                  <li key={f.id}>
                    <strong>{f.label}</strong> — {f.error}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="site-compare-sources">
            <h3>Where each column comes from</h3>
            <dl>
              {CRITERION_ORDER.map((id) => (
                <div key={id}>
                  <dt>
                    {SITE_CRITERIA[id].label}
                    <span className={`site-compare-prov prov-${SITE_CRITERIA[id].provenance}`}>
                      {SITE_CRITERIA[id].provenance}
                    </span>
                  </dt>
                  <dd>{SITE_CRITERIA[id].source}</dd>
                </div>
              ))}
            </dl>
          </section>
        </>
      )}
    </aside>
  );
}
