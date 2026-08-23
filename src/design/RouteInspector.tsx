// UI for the "Hypothetical Routes" pipeline stage -- consumes the structured
// RouteEngineResult produced by src/routing/hypotheticalRouting.ts (run in a
// Web Worker via useHypotheticalRoute) and presents it. No routing logic
// lives here; this only renders what the engine already computed.
//
// Every displayed routing value is rendered through <Metric>, which requires
// a RouteMetricId from routing/provenance.ts. That is a compile-time
// constraint, not a convention: a metric with no provenance classification
// cannot be rendered here at all.
import { useEffect, useState } from "react";
import { useHypotheticalRoute } from "../routing/useHypotheticalRoute";
import { DEFAULT_ROUTING_WEIGHTS } from "../routing/hypotheticalRouting";
import { PROVENANCE_LABEL, ROUTE_METRIC_PROVENANCE } from "../routing/provenance";
import { analyzeWeightSensitivity, SELECTABLE_WEIGHT_LEVELS } from "../routing/weightSensitivity";
import type { RouteMetricId } from "../routing/provenance";
import type {
  CriterionOutcome,
  RankedRouteCandidate,
  RouteEngineResult,
  RoutingProfileId,
  RoutingWeights,
} from "../routing/routingTypes";
import "./design.css";

// Single source of truth lives with the sensitivity analysis, which sweeps
// exactly these levels -- two copies would silently drift apart and the
// analysis would then describe weightings the UI cannot produce.
const WEIGHT_LEVELS = SELECTABLE_WEIGHT_LEVELS;
const WEIGHT_LEVEL_LABELS: Record<number, string> = { 0.5: "Low", 1: "Normal", 1.5: "High", 2: "Highest" };

function fmtKm(km: number): string {
  return `${km.toLocaleString(undefined, { maximumFractionDigits: 0 })} km`;
}
function fmtUsd(usd: number): string {
  if (usd >= 1_000_000_000) return `$${(usd / 1_000_000_000).toFixed(2)}B`;
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(1)}M`;
  return `$${usd.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

const BATHYMETRY_PROVENANCE_TEXT =
  "Derived bathymetric depth-band grid: Natural Earth v5.1.1 10m bathymetry contours (Natural Earth's own " +
  "cartographic simplification of the GEBCO/ETOPO compilations, not raw GEBCO values), rasterized to a 0.5° x 0.5° " +
  "grid (~55km cell width at the equator) and classified into depth BANDS, not continuous depth. Not suitable for " +
  "final engineering or survey-grade route planning.";

/** Renders a provenance class chip. The id must exist in the registry, so an unclassified metric is a type error. */
function ProvenanceChip({ metric }: { metric: RouteMetricId }) {
  const d = ROUTE_METRIC_PROVENANCE[metric];
  return (
    <span className={`prov-chip prov-${d.provenance.toLowerCase().replace("_", "-")}`} title={d.basis}>
      {PROVENANCE_LABEL[d.provenance]}
    </span>
  );
}

/** A labelled value carrying its provenance classification. */
function Metric({ label, value, metric, tone }: { label: string; value: string; metric: RouteMetricId; tone?: string }) {
  return (
    <div className="design-metric">
      <span className="design-label">
        {label} <ProvenanceChip metric={metric} />
      </span>
      <span className={`dc-mono ${tone ?? ""}`}>{value}</span>
    </div>
  );
}

interface Props {
  sourceLat: number | null;
  sourceLng: number | null;
  sourceLabel: string;
  destLat: number | null;
  destLng: number | null;
  destLabel: string;
  selectedCandidateId: RoutingProfileId | null;
  onSelectCandidate: (id: RoutingProfileId | null) => void;
  onResult: (result: RouteEngineResult | null) => void;
}

export default function RouteInspector({
  sourceLat,
  sourceLng,
  sourceLabel,
  destLat,
  destLng,
  destLabel,
  selectedCandidateId,
  onSelectCandidate,
  onResult,
}: Props) {
  const [weights, setWeights] = useState<RoutingWeights>(DEFAULT_ROUTING_WEIGHTS);
  const [showAssumptions, setShowAssumptions] = useState(false);

  const { status, result, error } = useHypotheticalRoute({
    sourceLat,
    sourceLng,
    sourceLabel,
    destLat,
    destLng,
    destLabel,
    weights,
  });

  useEffect(() => {
    onResult(result);
  }, [result, onResult]);

  useEffect(() => {
    if (!result || result.candidates.length === 0) return;
    const stillValid = result.candidates.some((c) => c.candidate.id === selectedCandidateId);
    if (!stillValid) onSelectCandidate(result.candidates[0].candidate.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  if (sourceLat == null || sourceLng == null) {
    return (
      <section>
        <h2 className="pp-section-title">Hypothetical Routes</h2>
        <p className="design-step-intro">Resolve the proposed site first.</p>
      </section>
    );
  }
  if (destLat == null || destLng == null) {
    return (
      <section>
        <h2 className="pp-section-title">Hypothetical Routes</h2>
        <p className="design-step-intro">
          Add a connectivity destination on the previous step to generate hypothetical marine cable routes between
          the two sites.
        </p>
      </section>
    );
  }

  const selected = result?.candidates.find((c) => c.candidate.id === selectedCandidateId) ?? null;

  return (
    <section>
      <span className="dc-modeled-badge">MODELED / HYPOTHETICAL -- NOT A REAL CABLE ROUTE</span>
      <h2 className="pp-section-title">Hypothetical Routes</h2>
      <p className="design-step-intro">
        A candidate new-cable route is computed with a deterministic A* search over a{" "}
        <strong>derived bathymetric depth-band grid</strong> (<span title={BATHYMETRY_PROVENANCE_TEXT}>provenance</span>
        ), not a straight line between the two cities. This grid does not model artificial waterways (Suez, Panama)
        as navigable -- a route whose realistic path uses one of those canals is instead routed around the
        connecting continent, which can significantly overstate marine distance and cost for those pairs.
      </p>

      <div className="ri-prototype-notice">
        <span className="ri-prototype-notice-title">Planning/research prototype -- not survey-grade</span>
        <p>
          This is a decision-support prototype, not a certified route survey. It does <strong>not</strong> claim
          survey-grade routing, actual installation cost, guaranteed environmental compliance, exact seabed
          conditions, exact construction cost, or exact cable failure probability. Each value below carries a
          provenance chip stating what was done to the source data to produce it.
        </p>
      </div>

      {status === "loading" && <p className="design-field-note">Computing candidate marine routes…</p>}
      {status === "error" && <p className="pp-conn-unavailable">Routing engine error: {error}</p>}

      {result && (
        <>
          <RiEndpointCard label="Source marine access" endpoint={result.sourceEndpoint} />
          <RiEndpointCard label="Destination marine access" endpoint={result.destinationEndpoint} />

          {result.unavailableReason && <p className="pp-conn-unavailable">{result.unavailableReason}</p>}

          {result.candidates.length > 0 && (
            <>
              <div className="design-field-group">
                <span className="design-label">Priority weighting</span>
                <RiWeightControl
                  label="Directness (length)"
                  value={weights.length}
                  onChange={(v) => setWeights((w) => ({ ...w, length: v }))}
                />
                <RiWeightControl
                  label="Seabed difficulty"
                  value={weights.seabedDifficulty}
                  onChange={(v) => setWeights((w) => ({ ...w, seabedDifficulty: v }))}
                />
                <RiWeightControl
                  label="Resilience / diversity"
                  value={weights.resilience}
                  onChange={(v) => setWeights((w) => ({ ...w, resilience: v }))}
                />
                <div className="ri-weight-row ri-weight-row-disabled">
                  <span className="ri-weight-label">Environmental</span>
                  <span className="design-field-note ri-weight-unavailable">unavailable -- no weight applied</span>
                </div>
                <p className="design-field-note">
                  Cost is deliberately <strong>not</strong> a weighting axis: the cost model is a deterministic
                  function of route length and the seabed-difficulty index, both already weighted above, so scoring
                  it separately would double-count them. It is still computed and shown below as a derived estimate.
                </p>
              </div>

              <RiCriteriaNotice criteria={result.criteria} />
              <RiDegeneracyNotice result={result} />
              <RiSensitivityNotice result={result} weights={weights} />

              <div className="ri-candidate-list">
                {result.candidates.map((rc) => (
                  <RiCandidateRow
                    key={rc.candidate.id}
                    ranked={rc}
                    active={rc.candidate.id === selectedCandidateId}
                    onClick={() => onSelectCandidate(rc.candidate.id)}
                  />
                ))}
              </div>

              {selected && <RiCandidateDetail ranked={selected} />}

              <button className="design-disclosure-toggle" onClick={() => setShowAssumptions((v) => !v)}>
                {showAssumptions ? "▾" : "▸"} Cost model assumptions
              </button>
              {showAssumptions && selected && <RiCostAssumptions ranked={selected} />}
            </>
          )}
        </>
      )}
    </section>
  );
}

/** States plainly which criteria took part in the ranking and which were excluded, so a criterion can never appear to have influenced a result it did not. */
function RiCriteriaNotice({ criteria }: { criteria: CriterionOutcome[] }) {
  const active = criteria.filter((c) => c.discriminates);
  const tied = criteria.filter((c) => c.available && !c.discriminates && c.weight > 0);
  const unavailable = criteria.filter((c) => !c.available);

  return (
    <div className="ri-criteria-notice">
      <span className="design-label">Criteria used in this ranking</span>
      {active.length === 0 ? (
        <p className="design-field-note">
          No criterion distinguishes these candidates -- they scored identically on everything available. The order
          shown is arbitrary.
        </p>
      ) : (
        <ul className="ri-criteria-list">
          {active.map((c) => (
            <li key={c.id}>
              <span className="ri-criteria-name">{c.label}</span>
              <span className="dc-mono ri-criteria-share">{(c.effectiveWeightShare * 100).toFixed(0)}%</span>
            </li>
          ))}
        </ul>
      )}
      {tied.length > 0 && (
        <p className="design-field-note">
          Excluded (all candidates tied, so it cannot differentiate them):{" "}
          {tied.map((c) => c.label).join(", ")}.
        </p>
      )}
      {unavailable.length > 0 && (
        <p className="design-field-note">
          Excluded (no dataset available): {unavailable.map((c) => c.label).join(", ")}.
        </p>
      )}
    </div>
  );
}

/** Warns when two candidates are closer together than the resolution of the data that produced them. */
function RiDegeneracyNotice({ result }: { result: RouteEngineResult }) {
  if (result.degeneratePairs.length === 0) return null;
  const nameOf = (id: RoutingProfileId) => {
    const rc = result.candidates.find((c) => c.candidate.id === id);
    return rc ? `ROUTE ${rc.rank} (${rc.candidate.shortName})` : id;
  };
  return (
    <div className="ri-degeneracy-notice">
      <span className="ri-degeneracy-title">
        Geometrically similar candidates <ProvenanceChip metric="candidateSeparation" />
      </span>
      {result.degeneratePairs.map((p) => (
        <p key={`${p.a}-${p.b}`} className="design-field-note">
          <strong>{nameOf(p.a)}</strong> and <strong>{nameOf(p.b)}</strong> follow effectively the same corridor --
          mean separation {p.meanSeparationKm.toFixed(0)} km (max {p.maxSeparationKm.toFixed(0)} km), below the{" "}
          {result.separationThresholdKm.toFixed(0)} km width of one grid cell. They are kept below for comparison,
          but they do <strong>not</strong> represent independent route options: the underlying bathymetry cannot
          resolve a difference at this scale.
        </p>
      ))}
    </div>
  );
}

function RiEndpointCard({ label, endpoint }: { label: string; endpoint: RouteEngineResult["sourceEndpoint"] }) {
  const isReal = endpoint.kind === "real-landing-point";
  return (
    <div className="pp-detail-card ri-endpoint-card">
      <div className="ri-endpoint-head">
        <span className="design-label">{label}</span>
        {endpoint.kind === "unavailable" ? (
          <span className="dc-modeled-badge">UNAVAILABLE</span>
        ) : (
          <ProvenanceChip metric={isReal ? "marineEndpointReal" : "marineEndpointModeled"} />
        )}
      </div>
      {endpoint.terrestrialAccessKm != null && (
        <div className="ri-endpoint-metric">
          <span className="dc-mono">{fmtKm(endpoint.terrestrialAccessKm)}</span> terrestrial access from{" "}
          {endpoint.businessLabel} <ProvenanceChip metric="terrestrialAccessKm" />
        </div>
      )}
      <p className="design-field-note">{endpoint.note}</p>
    </div>
  );
}

/**
 * How much the recommendation depends on where the sliders happen to sit.
 *
 * Without this the panel presents "ROUTE 1 is recommended" identically whether
 * that holds under every weighting the UI can produce or flips the moment one
 * slider moves. Those are completely different findings, and a planner has no
 * way to tell them apart from the ranking alone.
 */
function RiSensitivityNotice({
  result,
  weights,
}: {
  result: RouteEngineResult;
  weights: RoutingWeights;
}) {
  const applicable = result.criteria.filter((c) => c.discriminates && c.available).map((c) => c.id);
  const candidates = result.candidates.map((rc) => ({
    id: rc.candidate.id,
    label: rc.candidate.shortName,
    normalized: rc.normalized,
  }));
  if (candidates.length < 2 || applicable.length === 0) return null;

  const s = analyzeWeightSensitivity(candidates, weights, applicable);
  const nameOf = (id: string) =>
    result.candidates.find((rc) => rc.candidate.id === id)?.candidate.shortName ?? id;

  const flips = s.perCriterion.filter((c) => c.applicable && c.flipsAt !== null);

  return (
    <div className={`ri-sensitivity ${s.unconditional ? "is-robust" : s.winShare < 0.4 ? "is-fragile" : ""}`}>
      <div className="ri-sensitivity-head">
        <span className="design-label">Does this depend on the weights?</span>
        <span className="ri-sensitivity-share dc-mono">
          {Math.round(s.winShare * 100)}% of {s.gridPoints}
        </span>
      </div>
      <p className="design-field-note">{s.summary}</p>

      {flips.length > 0 && (
        <ul className="ri-sensitivity-flips">
          {flips.map((c) => {
            const label = result.criteria.find((x) => x.id === c.id)?.label ?? c.id;
            return (
              <li key={c.id}>
                Set <strong>{label}</strong> to{" "}
                <span className="dc-mono">{WEIGHT_LEVEL_LABELS[c.flipsAt!] ?? c.flipsAt}</span> and{" "}
                <strong>{nameOf(c.flipsTo!)}</strong> becomes the recommendation instead.
              </li>
            );
          })}
        </ul>
      )}

      {s.contenders.length > 1 && (
        <p className="design-field-note ri-sensitivity-contenders">
          Across every weighting available here:{" "}
          {s.contenders
            .map((c) => `${nameOf(c.id)} wins ${Math.round(c.share * 100)}%`)
            .join(", ")}
          .
        </p>
      )}
    </div>
  );
}

function RiWeightControl({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="ri-weight-row">
      <span className="ri-weight-label">{label}</span>
      <div className="design-segmented ri-weight-segmented">
        {WEIGHT_LEVELS.map((lvl) => (
          <button key={lvl} className={value === lvl ? "active" : ""} onClick={() => onChange(lvl)}>
            {WEIGHT_LEVEL_LABELS[lvl]}
          </button>
        ))}
      </div>
    </div>
  );
}

function RiCandidateRow({ ranked, active, onClick }: { ranked: RankedRouteCandidate; active: boolean; onClick: () => void }) {
  const { candidate } = ranked;
  return (
    <button className={`ri-candidate-row ${active ? "active" : ""}`} onClick={onClick}>
      <div className="ri-candidate-row-head">
        <span className="ri-candidate-name">
          ROUTE {ranked.rank} <span className="ri-candidate-shortname">— {candidate.shortName}</span>
        </span>
        {ranked.isRecommended && <span className="pp-real-badge ri-recommended-badge">RECOMMENDED</span>}
      </div>
      <div className="ri-candidate-row-metrics">
        <span className="dc-mono">{fmtKm(candidate.analysis.marineDistanceKm)} marine</span>
        <span className="dc-mono">difficulty {candidate.analysis.difficultyIndex.toFixed(3)}</span>
        <span className="dc-mono">{fmtUsd(candidate.cost.totalUsd)}</span>
        <span className="dc-mono">{(candidate.resilience.diversityScore * 100).toFixed(0)}% diverse</span>
      </div>
      <div className="ri-candidate-row-score">
        <span className="design-label">Overall score</span>
        <span className="dc-mono">{ranked.score.toFixed(3)}</span>
      </div>
    </button>
  );
}

function RiCandidateDetail({ ranked }: { ranked: RankedRouteCandidate }) {
  const { candidate } = ranked;
  const { analysis, cost, resilience, environmental } = candidate;
  return (
    <div className="pp-detail-card ri-detail-card">
      <div className="ri-detail-heading">
        <span className="design-label">
          ROUTE {ranked.rank} — {candidate.shortName}
        </span>
        {ranked.isRecommended && <span className="pp-real-badge ri-recommended-badge">RECOMMENDED</span>}
      </div>
      <p className="design-field-note">{candidate.description}</p>
      <p className="pp-why">{ranked.whyText}</p>

      <div className="design-metrics-grid ri-metrics-grid">
        <Metric label="Marine distance" value={fmtKm(analysis.marineDistanceKm)} metric="marineDistanceKm" />
        <Metric label="Total connection distance" value={fmtKm(analysis.totalDistanceKm)} metric="totalDistanceKm" />
        <Metric
          label="Shallowest band crossed"
          value={analysis.shallowestBand?.label ?? "unavailable"}
          metric="depthBand"
        />
        <Metric label="Deepest band crossed" value={analysis.deepestBand?.label ?? "unavailable"} metric="depthBand" />
        <Metric
          label="Mean band lower bound"
          value={
            analysis.meanBandLowerBoundM == null
              ? "unavailable"
              : `${Math.round(analysis.meanBandLowerBoundM / 50) * 50} m`
          }
          metric="meanBandLowerBound"
        />
        <Metric
          label="Seabed difficulty index"
          value={analysis.difficultyIndex.toFixed(3)}
          metric="difficultyIndex"
        />
        <Metric
          label="Existing-cable corridor overlap"
          value={`${(resilience.corridorOverlapFraction * 100).toFixed(0)}%`}
          metric="corridorOverlap"
        />
        <Metric label="Route diversity score" value={resilience.diversityScore.toFixed(2)} metric="diversityScore" />
        <Metric label="Estimated cost" value={fmtUsd(cost.totalUsd)} metric="costEstimate" />
        <Metric label="Overall score" value={ranked.score.toFixed(3)} metric="overallScore" />
      </div>

      <p className="ri-dominant-band">{analysis.dominantDepthBandLabel}</p>

      <p className="design-field-note">
        Seabed difficulty index basis: {analysis.difficultyIndexBasis}. Lower is better; 1.000 would mean no modeled
        difficulty penalty anywhere along the route. {resilience.methodNote}
      </p>

      {analysis.unclassifiedSampleCount > 0 && (
        <p className="design-field-note">
          {analysis.unclassifiedSampleCount} of {analysis.unclassifiedSampleCount + analysis.classifiedSampleCount}{" "}
          route samples fell on cells the grid does not classify as ocean (typically the coastal end-points at this
          grid's ~55 km resolution). They are excluded from the depth statistics above rather than counted as
          shallow water.
        </p>
      )}

      <span className="design-label ri-chart-label">
        Depth profile (distance along route → depth band lower bound) <ProvenanceChip metric="depthBand" />
      </span>
      <DepthProfileChart profile={analysis.depthProfile} />

      <p className="design-field-note">
        Environmental analysis <ProvenanceChip metric="environmental" />: {environmental.reason}
      </p>
    </div>
  );
}

function DepthProfileChart({ profile }: { profile: { distanceAlongRouteKm: number; depthM: number }[] }) {
  if (profile.length < 2) return null;
  const width = 340;
  const height = 90;
  const padL = 46;
  const padB = 14;
  const padT = 6;
  const maxDist = profile[profile.length - 1].distanceAlongRouteKm || 1;
  const maxDepth = Math.max(...profile.map((p) => p.depthM), 1);

  const x = (d: number) => padL + (d / maxDist) * (width - padL - 4);
  const y = (depth: number) => padT + (depth / maxDepth) * (height - padT - padB);

  const points = profile.map((p) => `${x(p.distanceAlongRouteKm)},${y(p.depthM)}`).join(" ");
  const areaPoints = `${padL},${y(0)} ${points} ${x(maxDist)},${y(0)}`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="ri-depth-chart" role="img" aria-label="Depth band profile chart">
      <line x1={padL} y1={padT} x2={padL} y2={height - padB} stroke="var(--dc-border)" />
      <line x1={padL} y1={height - padB} x2={width - 4} y2={height - padB} stroke="var(--dc-border)" />
      <text x={2} y={padT + 8} className="ri-chart-axis-label">
        0 m
      </text>
      <text x={2} y={height - padB} className="ri-chart-axis-label">
        {maxDepth.toLocaleString()} m
      </text>
      <polygon points={areaPoints} fill="rgba(79,209,255,0.12)" stroke="none" />
      <polyline points={points} fill="none" stroke="var(--dc-accent)" strokeWidth={1.5} />
    </svg>
  );
}

function RiCostAssumptions({ ranked }: { ranked: RankedRouteCandidate }) {
  const { cost, analysis } = ranked.candidate;
  const a = cost.assumptions;
  return (
    <div className="ri-cost-breakdown">
      <div className="design-review-row">
        <span className="design-review-key">
          Base cost / km <ProvenanceChip metric="costCoefficient" />
        </span>
        <span className="dc-mono">{fmtUsd(a.baseCostPerKmUsd)}</span>
      </div>
      <div className="design-review-row">
        <span className="design-review-key">Length cost</span>
        <span className="dc-mono">{fmtUsd(cost.lengthCostUsd)}</span>
      </div>
      <div className="design-review-row">
        <span className="design-review-key">
          Installation ({(a.installationFactor * 100).toFixed(0)}%) <ProvenanceChip metric="costCoefficient" />
        </span>
        <span className="dc-mono">{fmtUsd(cost.installationCostUsd)}</span>
      </div>
      <div className="design-review-row">
        <span className="design-review-key">
          Terrain penalty (difficulty index {analysis.difficultyIndex.toFixed(3)})
        </span>
        <span className="dc-mono">{fmtUsd(cost.terrainPenaltyUsd)}</span>
      </div>
      <div className="design-review-row">
        <span className="design-review-key">Environmental penalty</span>
        <span className="dc-mono">{fmtUsd(cost.environmentalPenaltyUsd)}</span>
      </div>
      <div className="design-review-row">
        <span className="design-review-key">
          Shore-end costs (x2) <ProvenanceChip metric="costCoefficient" />
        </span>
        <span className="dc-mono">{fmtUsd(cost.shoreEndCostUsd)}</span>
      </div>
      <div className="design-review-row">
        <span className="design-review-key">
          Contingency ({(a.contingencyPct * 100).toFixed(0)}%) <ProvenanceChip metric="costCoefficient" />
        </span>
        <span className="dc-mono">{fmtUsd(cost.contingencyUsd)}</span>
      </div>
      <div className="design-review-row">
        <span className="design-review-key">
          <strong>Total (modeled estimate)</strong>
        </span>
        <span className="dc-mono">
          <strong>{fmtUsd(cost.totalUsd)}</strong>
        </span>
      </div>
      <p className="design-field-note">
        Every coefficient above is an unsourced modeling assumption held fixed for reproducibility -- not a
        contractor quotation or market price. The model also omits several real cost drivers entirely: repeater
        count, depth-dependent cable armouring, burial, survey, and EEZ/permitting. Terrestrial backhaul is not
        included. Treat the total as a comparison device between candidates, not as a budget figure.
      </p>
    </div>
  );
}
