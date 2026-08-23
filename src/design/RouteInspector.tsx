// UI for the "Hypothetical Routes" pipeline stage -- consumes the
// structured RouteEngineResult produced by src/routing/hypotheticalRouting.ts
// (run in a Web Worker via useHypotheticalRoute) and presents it. No routing
// logic lives here; this only renders what the engine already computed.
import { useEffect, useState } from "react";
import { useHypotheticalRoute } from "../routing/useHypotheticalRoute";
import { DEFAULT_ROUTING_WEIGHTS } from "../routing/hypotheticalRouting";
import type { RankedRouteCandidate, RouteEngineResult, RoutingProfileId, RoutingWeights } from "../routing/routingTypes";
import "./design.css";

const WEIGHT_LEVELS = [0.5, 1, 1.5, 2];
const WEIGHT_LEVEL_LABELS: Record<number, string> = { 0.5: "Low", 1: "Normal", 1.5: "High", 2: "Highest" };

function fmtKm(km: number): string {
  return `${km.toLocaleString(undefined, { maximumFractionDigits: 0 })} km`;
}
function fmtUsd(usd: number): string {
  if (usd >= 1_000_000_000) return `$${(usd / 1_000_000_000).toFixed(2)}B`;
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(1)}M`;
  return `$${usd.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}
function fmtM(m: number): string {
  return `${m.toLocaleString(undefined, { maximumFractionDigits: 0 })} m`;
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

  // Auto-select the recommended candidate the first time a result arrives (or the input changed and the previous selection no longer exists).
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
        <strong>derived bathymetric depth-band grid</strong> (see <RiSourceNote inline />), not a straight line
        between the two cities. This grid does not model artificial waterways (Suez, Panama) as navigable -- a
        route whose realistic path uses one of those canals is instead routed around the connecting continent,
        which can significantly overstate marine distance and cost for those specific city pairs.
      </p>

      <div className="ri-prototype-notice">
        <span className="ri-prototype-notice-title">Planning/research prototype -- not survey-grade</span>
        <p>
          This is a decision-support prototype, not a certified route survey. It does <strong>not</strong> claim
          survey-grade routing, actual installation cost, guaranteed environmental compliance, exact seabed
          conditions, exact construction cost, or exact cable failure probability. Every figure below is a
          disclosed model output from public-domain data, meant to compare candidates against each other -- not a
          number to build a contract on.
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
                  label="Cost"
                  value={weights.cost}
                  onChange={(v) => setWeights((w) => ({ ...w, cost: v }))}
                />
                <RiWeightControl
                  label="Resilience / diversity"
                  value={weights.resilience}
                  onChange={(v) => setWeights((w) => ({ ...w, resilience: v }))}
                />
                <RiWeightControl
                  label="Directness (length)"
                  value={weights.length}
                  onChange={(v) => setWeights((w) => ({ ...w, length: v }))}
                />
                <div className="ri-weight-row ri-weight-row-disabled">
                  <span className="ri-weight-label">Environmental</span>
                  <span className="design-field-note ri-weight-unavailable">unavailable -- no weight applied</span>
                </div>
              </div>

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

const BATHYMETRY_PROVENANCE_TEXT =
  "Derived bathymetric depth-band grid: Natural Earth v5.1.1 10m bathymetry contours (Natural Earth's own " +
  "cartographic simplification of the GEBCO/ETOPO compilations, not raw GEBCO values), rasterized to a 0.5° x 0.5° " +
  "grid (~55km cell width at the equator) and classified into depth BANDS, not continuous depth -- every depth " +
  "figure in this app is a band lower bound (\"at least this deep\"), never a point sounding. Not suitable for " +
  "final engineering or survey-grade route planning.";

function RiSourceNote({ inline }: { inline?: boolean }) {
  return inline ? (
    <span title={BATHYMETRY_PROVENANCE_TEXT}>derived bathymetric depth-band grid provenance</span>
  ) : (
    <p className="design-field-note">{BATHYMETRY_PROVENANCE_TEXT}</p>
  );
}

function RiEndpointCard({ label, endpoint }: { label: string; endpoint: RouteEngineResult["sourceEndpoint"] }) {
  const badgeClass = endpoint.kind === "real-landing-point" ? "pp-real-badge" : "dc-modeled-badge";
  const badgeText =
    endpoint.kind === "real-landing-point"
      ? "REAL LANDING POINT"
      : endpoint.kind === "modeled-access-point"
        ? "MODELED ACCESS POINT"
        : "UNAVAILABLE";
  return (
    <div className="pp-detail-card ri-endpoint-card">
      <div className="ri-endpoint-head">
        <span className="design-label">{label}</span>
        <span className={badgeClass}>{badgeText}</span>
      </div>
      {endpoint.terrestrialAccessKm != null && (
        <div className="ri-endpoint-metric">
          <span className="dc-mono">{fmtKm(endpoint.terrestrialAccessKm)}</span> terrestrial access from{" "}
          {endpoint.businessLabel}
        </div>
      )}
      <p className="design-field-note">{endpoint.note}</p>
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

const DIFFICULTY_CLASS: Record<string, string> = { LOW: "ri-difficulty-low", MEDIUM: "ri-difficulty-medium", HIGH: "ri-difficulty-high" };

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
        <span className={`dc-mono ${DIFFICULTY_CLASS[candidate.analysis.seabedDifficulty]}`}>
          {candidate.analysis.seabedDifficulty}
        </span>
        <span className="dc-mono">{fmtUsd(candidate.cost.totalUsd)}</span>
        <span className="dc-mono">{(candidate.resilience.diversityScore * 100).toFixed(0)}% diverse</span>
      </div>
      <div className="ri-candidate-row-score">
        <span className="design-label">Overall score</span>
        <span className="dc-mono">{ranked.score.toFixed(2)}</span>
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
        <div className="design-metric">
          <span className="design-label">Marine distance</span>
          <span className="dc-mono">{fmtKm(analysis.marineDistanceKm)}</span>
        </div>
        <div className="design-metric">
          <span className="design-label">Total connection distance</span>
          <span className="dc-mono">{fmtKm(analysis.totalDistanceKm)}</span>
        </div>
        <div className="design-metric">
          <span className="design-label">Minimum depth band</span>
          <span className="dc-mono">≥ {fmtM(analysis.minDepthM)}</span>
        </div>
        <div className="design-metric">
          <span className="design-label">Maximum depth band</span>
          <span className="dc-mono">≥ {fmtM(analysis.maxDepthM)}</span>
        </div>
        <div className="design-metric">
          <span className="design-label">Mean depth band</span>
          <span className="dc-mono">≥ {fmtM(analysis.meanDepthM)}</span>
        </div>
        <div className="design-metric">
          <span className="design-label">Seabed difficulty</span>
          <span className={`dc-mono ${DIFFICULTY_CLASS[analysis.seabedDifficulty]}`}>{analysis.seabedDifficulty}</span>
        </div>
        <div className="design-metric">
          <span className="design-label">Existing-cable corridor overlap</span>
          <span className="dc-mono">{(resilience.corridorOverlapFraction * 100).toFixed(0)}%</span>
        </div>
        <div className="design-metric">
          <span className="design-label">Route diversity score</span>
          <span className="dc-mono">{resilience.diversityScore.toFixed(2)}</span>
        </div>
        <div className="design-metric">
          <span className="design-label">Estimated modeled cost</span>
          <span className="dc-mono">{fmtUsd(cost.totalUsd)}</span>
        </div>
        <div className="design-metric">
          <span className="design-label">Overall score</span>
          <span className="dc-mono">{ranked.score.toFixed(2)}</span>
        </div>
      </div>

      <p className="ri-dominant-band">{analysis.dominantDepthBandLabel}</p>

      <p className="design-field-note">
        Depth values are band lower bounds ("at least this deep"), not point soundings -- see{" "}
        <RiSourceNote inline />. Seabed difficulty basis: {analysis.seabedDifficultyBasis}. {resilience.methodNote}
      </p>

      <span className="design-label ri-chart-label">Depth profile (distance along route → depth band)</span>
      <DepthProfileChart profile={analysis.depthProfile} />

      <p className="design-field-note">
        {environmental.available
          ? `Environmental exposure: ${((environmental.penaltyScore ?? 0) * 100).toFixed(0)}%`
          : `Environmental analysis: ${environmental.reason}`}
      </p>
    </div>
  );
}

function DepthProfileChart({ profile }: { profile: { distanceAlongRouteKm: number; depthM: number }[] }) {
  if (profile.length < 2) return null;
  const width = 340;
  const height = 90;
  const padL = 42;
  const padB = 14;
  const padT = 6;
  const maxDist = profile[profile.length - 1].distanceAlongRouteKm || 1;
  const maxDepth = Math.max(...profile.map((p) => p.depthM), 1);

  const x = (d: number) => padL + (d / maxDist) * (width - padL - 4);
  const y = (depth: number) => padT + (depth / maxDepth) * (height - padT - padB);

  const points = profile.map((p) => `${x(p.distanceAlongRouteKm)},${y(p.depthM)}`).join(" ");
  const areaPoints = `${padL},${y(0)} ${points} ${x(maxDist)},${y(0)}`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="ri-depth-chart" role="img" aria-label="Depth profile chart">
      <line x1={padL} y1={padT} x2={padL} y2={height - padB} stroke="var(--dc-border)" />
      <line x1={padL} y1={height - padB} x2={width - 4} y2={height - padB} stroke="var(--dc-border)" />
      <text x={2} y={padT + 8} className="ri-chart-axis-label">
        0m
      </text>
      <text x={2} y={height - padB} className="ri-chart-axis-label">
        {fmtM(maxDepth)}
      </text>
      <polygon points={areaPoints} fill="rgba(79,209,255,0.12)" stroke="none" />
      <polyline points={points} fill="none" stroke="var(--dc-accent)" strokeWidth={1.5} />
    </svg>
  );
}

function RiCostAssumptions({ ranked }: { ranked: RankedRouteCandidate }) {
  const { cost } = ranked.candidate;
  const a = cost.assumptions;
  return (
    <div className="ri-cost-breakdown">
      <div className="design-review-row">
        <span className="design-review-key">Base cost / km (modeled)</span>
        <span className="dc-mono">{fmtUsd(a.baseCostPerKmUsd)}</span>
      </div>
      <div className="design-review-row">
        <span className="design-review-key">Length cost</span>
        <span className="dc-mono">{fmtUsd(cost.lengthCostUsd)}</span>
      </div>
      <div className="design-review-row">
        <span className="design-review-key">Installation ({(a.installationFactor * 100).toFixed(0)}%)</span>
        <span className="dc-mono">{fmtUsd(cost.installationCostUsd)}</span>
      </div>
      <div className="design-review-row">
        <span className="design-review-key">Terrain/depth penalty</span>
        <span className="dc-mono">{fmtUsd(cost.terrainPenaltyUsd)}</span>
      </div>
      <div className="design-review-row">
        <span className="design-review-key">Environmental penalty</span>
        <span className="dc-mono">{fmtUsd(cost.environmentalPenaltyUsd)}</span>
      </div>
      <div className="design-review-row">
        <span className="design-review-key">Shore-end costs (x2)</span>
        <span className="dc-mono">{fmtUsd(cost.shoreEndCostUsd)}</span>
      </div>
      <div className="design-review-row">
        <span className="design-review-key">Contingency ({(a.contingencyPct * 100).toFixed(0)}%)</span>
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
        Every coefficient above is an explicit, configurable modeling assumption -- not a sourced contractor
        quotation or market price. Terrestrial backhaul cost (data-centre site to marine access point) is not
        included in this total.
      </p>
    </div>
  );
}
