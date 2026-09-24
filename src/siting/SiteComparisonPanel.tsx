// Side-by-side comparison of candidate data-centre sites.
//
// The rest of the tool answers "what is this location like". This answers
// "which of these should I choose", which is the question a siting decision
// actually starts from.
//
// With a destination ("connect to"), every site is also routed to it, and the
// cable it would need is ranked alongside climate, water, carbon and existing
// connectivity -- siting and routing answering one question together.
//
// Two presentation rules the engine's honesty depends on:
//   - Excluded criteria are shown WITH their reason, not hidden. A user who
//     cannot see that water stress was dropped has no way to know the ranking
//     ignored it.
//   - Every column carries its provenance. The PUE column is modelled and the
//     rest are measured or directly derived, and a table that presents them
//     identically misrepresents all of them.
import { useCallback, useRef, useState } from "react";
import { geocodeLocation } from "../design/geocoding";
import type { GeocodeResult } from "../design/geocoding";
import { LAND_COOLING_OPTIONS } from "../calculator/facilityCalculator";
import { routeOnce } from "../routing/useHypotheticalRoute";
import { roundTripMs } from "../routing/latency";
import type { CableFeature, LandingPoint } from "../types";
import {
  compareSites,
  evaluateSites,
  rawValue,
  SITE_CRITERIA,
  DEFAULT_SITE_WEIGHTS,
  type SiteCriterionId,
  type SiteEvaluation,
  type SiteRoute,
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

interface Destination {
  label: string;
  lat: number;
  lng: number;
}

interface Props {
  cables: CableFeature[];
  landingPoints: LandingPoint[];
  onClose: () => void;
  onFocusSite?: (lat: number, lng: number) => void;
}

const MAX_SITES = 6;
const BASE_CRITERIA: SiteCriterionId[] = ["freeCooling", "adjustedPue", "waterStress", "gridCarbon", "connectivity"];

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
    case "route":
      return `${Math.round(v).toLocaleString("en-US")}`;
  }
}

/** "Bengaluru, Karnataka, India" -> "Bengaluru". */
function shortPlace(label: string): string {
  return label.split(",")[0].trim() || label;
}

/**
 * Debounced place search. Only the newest search's response is applied -- see
 * LocationSearchField in design/PlanningPanel.tsx for the out-of-order reply
 * this prevents.
 */
function usePlaceSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<number | null>(null);
  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const search = useCallback((q: string) => {
    setQuery(q);
    setError(null);
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    abortRef.current?.abort();
    const id = ++requestIdRef.current;
    if (q.trim().length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    debounceRef.current = window.setTimeout(async () => {
      const controller = new AbortController();
      abortRef.current = controller;
      setSearching(true);
      try {
        const found = await geocodeLocation(q, { signal: controller.signal });
        if (id === requestIdRef.current) setResults(found);
      } catch {
        if (id !== requestIdRef.current || controller.signal.aborted) return;
        setError("Couldn't reach the place search service.");
        setResults([]);
      } finally {
        if (id === requestIdRef.current) setSearching(false);
      }
    }, 250);
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    requestIdRef.current++;
    setSearching(false);
    setQuery("");
    setResults([]);
  }, []);

  return { query, results, searching, error, search, reset };
}

/** The top-ranked route from a site to the destination, or null if none could be found. */
async function routeSite(site: CandidateSite, destination: Destination): Promise<SiteRoute | null> {
  try {
    const r = await routeOnce({
      sourceLat: site.lat,
      sourceLng: site.lng,
      sourceLabel: site.label,
      destLat: destination.lat,
      destLng: destination.lng,
      destLabel: destination.label,
    });
    const top = r.candidates[0]?.candidate;
    if (!top) return null;
    return {
      totalKm: top.analysis.totalDistanceKm,
      marineKm: top.analysis.marineDistanceKm,
      overlandCrossingKm: top.analysis.overlandCrossingKm,
      roundTripMs: roundTripMs(top.analysis.totalDistanceKm),
      costUsd: top.cost.totalUsd,
      crossings: top.crossings.map((c) => c.name),
    };
  } catch {
    return null;
  }
}

export default function SiteComparison({ cables, landingPoints, onClose, onFocusSite }: Props) {
  const [sites, setSites] = useState<CandidateSite[]>([]);
  const [destination, setDestination] = useState<Destination | null>(null);
  const siteSearch = usePlaceSearch();
  const destSearch = usePlaceSearch();
  const [weights, setWeights] = useState<SiteWeights>(DEFAULT_SITE_WEIGHTS);
  const [running, setRunning] = useState<string | null>(null);
  const [result, setResult] = useState<SiteComparisonResult | null>(null);
  // Only the newest comparison run is applied: a run that finishes after the
  // site list has changed describes sites that are no longer on it.
  const runIdRef = useRef(0);

  /** Any change to what is being compared retires the ranking and any run in flight. */
  function invalidate() {
    runIdRef.current++;
    setRunning(null);
    setResult(null);
  }

  function addSite(r: GeocodeResult) {
    setSites((prev) => {
      if (prev.length >= MAX_SITES) return prev;
      // Same place twice would produce two identical rows and a meaningless
      // tie, so refuse it rather than rank a site against itself.
      const id = `${r.lat.toFixed(3)},${r.lng.toFixed(3)}`;
      if (prev.some((s) => s.id === id)) return prev;
      return [...prev, { id, label: r.displayName, lat: r.lat, lng: r.lng, countryCode: r.countryCode }];
    });
    siteSearch.reset();
    invalidate();
  }

  function removeSite(id: string) {
    setSites((prev) => prev.filter((s) => s.id !== id));
    invalidate();
  }

  function chooseDestination(r: GeocodeResult | null) {
    setDestination(r ? { label: r.displayName, lat: r.lat, lng: r.lng } : null);
    destSearch.reset();
    invalidate();
  }

  async function run() {
    if (sites.length < 2) return;
    const runId = ++runIdRef.current;
    setRunning("Gathering climate, water and carbon data…");
    try {
      const inputs: EvaluateSiteInput[] = sites.map((s) => ({
        id: s.id,
        label: s.label,
        lat: s.lat,
        lng: s.lng,
        countryCode: s.countryCode,
        // Land cooling only. Seawater exchange is a subsea option, and scoring
        // it for an inland city is not a question anyone is asking.
        coolingOptions: LAND_COOLING_OPTIONS,
        cables,
        landingPoints,
      }));
      const evaluations: SiteEvaluation[] = await evaluateSites(inputs);
      if (destination) {
        // One after another: they share one routing worker anyway.
        for (let i = 0; i < sites.length; i++) {
          if (runId !== runIdRef.current) return;
          setRunning(`Routing ${shortPlace(sites[i].label)} to ${shortPlace(destination.label)} (${i + 1} of ${sites.length})…`);
          evaluations[i].route = await routeSite(sites[i], destination);
        }
      }
      if (runId === runIdRef.current) setResult(compareSites(evaluations, weights));
    } finally {
      if (runId === runIdRef.current) setRunning(null);
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

  const routed = result?.ranked.some((r) => r.evaluation.route !== undefined) ?? false;
  const criterionOrder: SiteCriterionId[] = routed ? [...BASE_CRITERIA, "route"] : BASE_CRITERIA;
  const excluded = result?.criteria.filter((c) => !c.discriminates) ?? [];
  const destName = destination ? shortPlace(destination.label) : "";

  return (
    <aside className="site-compare" aria-label="Compare candidate sites">
      <header className="site-compare-head">
        <div>
          <h2>Compare candidate sites</h2>
          <p>
            Rank several locations against each other on measured climate, national water stress and grid carbon,
            real cable connectivity, modelled PUE -- and, if you set a destination, the cable each site would need to
            reach it.
          </p>
        </div>
        <CloseButton onClick={onClose} label="Close site comparison" />
      </header>

      <section className="site-compare-add">
        <label htmlFor="site-compare-search">
          Add a site ({sites.length}/{MAX_SITES})
        </label>
        <input
          id="site-compare-search"
          type="text"
          value={siteSearch.query}
          placeholder="City or place name…"
          disabled={sites.length >= MAX_SITES}
          onChange={(e) => siteSearch.search(e.target.value)}
          autoComplete="off"
        />
        {siteSearch.searching && <p className="site-compare-hint">Searching…</p>}
        {siteSearch.error && <p className="site-compare-error">{siteSearch.error}</p>}
        {siteSearch.results[0]?.offline && (
          <p className="site-compare-hint">Place search is unreachable, so these are from a built-in list of major cities.</p>
        )}
        {siteSearch.results.length > 0 && (
          <ul className="site-compare-results">
            {siteSearch.results.map((r) => (
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

      <section className="site-compare-add">
        <label htmlFor="site-compare-destination">
          Connect to <span className="site-compare-optional">(optional)</span>
        </label>
        {destination ? (
          <div className="site-compare-destination">
            <span>{destination.label}</span>
            <button type="button" className="site-compare-chip-remove" onClick={() => chooseDestination(null)} aria-label="Remove destination">
              ×
            </button>
          </div>
        ) : (
          <>
            <input
              id="site-compare-destination"
              type="text"
              value={destSearch.query}
              placeholder="Where the data centre must connect to, e.g. New York"
              onChange={(e) => destSearch.search(e.target.value)}
              autoComplete="off"
            />
            {destSearch.searching && <p className="site-compare-hint">Searching…</p>}
            {destSearch.error && <p className="site-compare-error">{destSearch.error}</p>}
            {destSearch.results[0]?.offline && (
              <p className="site-compare-hint">Place search is unreachable, so these are from a built-in list of major cities.</p>
            )}
            {destSearch.results.length > 0 && (
              <ul className="site-compare-results">
                {destSearch.results.map((r) => (
                  <li key={`${r.lat},${r.lng}`}>
                    <button type="button" onClick={() => chooseDestination(r)}>
                      {r.displayName}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        <p className="site-compare-hint">
          Each site is routed to the destination and the cable it needs is ranked with everything else.
        </p>
      </section>

      <button type="button" className="site-compare-run" onClick={run} disabled={sites.length < 2 || running !== null}>
        {running ?? (sites.length < 2 ? "Add at least two sites" : `Compare ${sites.length} sites`)}
      </button>

      {result && (
        <>
          <section className="site-compare-weights">
            <h3>Weights</h3>
            <p className="site-compare-hint">
              Re-ranks immediately — the site data is already gathered, only the weighting changes.
            </p>
            {criterionOrder.map((id) => (
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
              No criterion separates these sites on the available data. The order below is arbitrary and should not be
              read as a preference.
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
                    {criterionOrder.map((id) => {
                      const c = result.criteria.find((x) => x.id === id);
                      return (
                        <th key={id} scope="col" className={c?.discriminates ? "" : "is-excluded"}>
                          {id === "route" ? `Route to ${destName}` : SITE_CRITERIA[id].label}
                          <span className="site-compare-unit">{SITE_CRITERIA[id].unit}</span>
                          <span className={`site-compare-prov prov-${SITE_CRITERIA[id].provenance}`}>
                            {SITE_CRITERIA[id].provenance}
                          </span>
                        </th>
                      );
                    })}
                    {routed && (
                      <th scope="col">
                        Round trip
                        <span className="site-compare-unit">ms, minimum</span>
                        <span className="site-compare-prov prov-DERIVED">DERIVED</span>
                      </th>
                    )}
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
                      <td className="site-compare-score">{result.indeterminate ? "—" : r.score.toFixed(3)}</td>
                      {criterionOrder.map((id) => {
                        const c = result.criteria.find((x) => x.id === id);
                        const cls = [
                          c?.discriminates ? "" : "is-excluded",
                          r.winsOn.includes(id) ? "is-best" : "",
                          r.losesOn.includes(id) ? "is-worst" : "",
                        ]
                          .filter(Boolean)
                          .join(" ");
                        return (
                          <td key={id} className={cls}>
                            {formatValue(id, rawValue(r.evaluation, id))}
                            {id === "route" && (r.evaluation.route?.crossings.length ?? 0) > 0 && (
                              <span className="site-compare-note">
                                via {r.evaluation.route!.crossings.map((x) => x.split(" ")[0]).join(", ")}
                              </span>
                            )}
                          </td>
                        );
                      })}
                      {routed && (
                        <td>{r.evaluation.route ? `~${Math.round(r.evaluation.route.roundTripMs)}` : "—"}</td>
                      )}
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
              {criterionOrder.map((id) => (
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
              {routed && (
                <div>
                  <dt>
                    Round trip
                    <span className="site-compare-prov prov-DERIVED">DERIVED</span>
                  </dt>
                  <dd>
                    Minimum round-trip time over the route&apos;s length of optical fibre, at about 4.9 microseconds per
                    kilometre each way. Real latency is higher: switching and routing only add to it.
                  </dd>
                </div>
              )}
            </dl>
          </section>
        </>
      )}
    </aside>
  );
}
