import { useRef, useState } from "react";
import {
  ALL_REDUNDANCIES,
  ALL_TIERS,
  COOLING_SPECS,
  LAND_COOLING_OPTIONS,
  TIER_SPECS,
} from "../calculator/facilityCalculator";
import { recommendConfigurations } from "../calculator/recommend";
import { geocodeLocation, type GeocodeResult } from "./geocoding";
import {
  AVAILABILITY_OPTIONS,
  DEFAULT_DOWNTIME_COST_PER_HOUR_USD,
  INDUSTRIES,
  INDUSTRY_DEFAULTS,
  PRIORITY_AXES,
  PRIORITY_WEIGHT_PRIMARY,
  PRIORITY_WEIGHT_SECONDARY,
  buildPriorityWeights,
  tierAtLeast,
} from "./businessProfiles";
import type {
  BusinessContext,
  DesignRequirement,
  DesignResult,
  Industry,
  LocationRequirement,
  PipelineStageId,
  PlanningStep,
} from "./designTypes";
import { PIPELINE_STAGES, PLANNING_STEPS } from "./designTypes";
import type { ConnectivityAnalysis, RelevantCable } from "./connectivityAnalysis";
import RouteInspector from "./RouteInspector";
import type { RouteEngineResult, RoutingProfileId } from "../routing/routingTypes";
import CloseButton from "../CloseButton";
import "./design.css";

const STEP_LABELS: Record<PlanningStep, string> = {
  "business-requirement": "Business Requirement",
  "site-connectivity": "Site & Connectivity",
  routes: "Hypothetical Routes",
  review: "Review",
  recommendation: "Recommendation",
};

// Which pipeline stages a given wizard step lets the user work on. Used to
// drive the pipeline rail's done/current highlighting -- see buildRailStatus.
const STEP_STAGES: Record<PlanningStep, PipelineStageId[]> = {
  "business-requirement": ["business-requirement"],
  "site-connectivity": ["proposed-site", "existing-connectivity", "landing-points"],
  routes: ["hypothetical-routes", "environmental-analysis"],
  review: [],
  recommendation: ["data-centre-design", "resilience", "economics", "recommendation"],
};

function reverseStageToStep(stageId: PipelineStageId): PlanningStep | null {
  for (const step of PLANNING_STEPS) {
    if (STEP_STAGES[step].includes(stageId)) return step;
  }
  return null;
}

const LAND_POOL_SIZE = ALL_TIERS.length * ALL_REDUNDANCIES.length * LAND_COOLING_OPTIONS.length;

const EMPTY_LOCATION: LocationRequirement = { query: "" };

const EMPTY_REQUIREMENT: DesignRequirement = {
  businessContext: { industry: null, availabilityRequirement: null, capacityMW: null },
  locationConnectivity: { location: { ...EMPTY_LOCATION }, connectivityDestination: { ...EMPTY_LOCATION } },
  priorities: { primary: null, secondary: null },
};

function computeResult(requirement: DesignRequirement): DesignResult | null {
  const { businessContext, priorities } = requirement;
  if (!businessContext.availabilityRequirement || !priorities.primary) return null;

  const availability = AVAILABILITY_OPTIONS.find((a) => a.value === businessContext.availabilityRequirement);
  if (!availability) return null;

  const weights = buildPriorityWeights(priorities.primary, priorities.secondary);
  const pool = recommendConfigurations(false, DEFAULT_DOWNTIME_COST_PER_HOUR_USD, weights, LAND_POOL_SIZE);
  const filtered = pool.filter((c) => tierAtLeast(c.config.tier, availability.minTier));
  const shortlist = filtered.slice(0, 5);
  if (shortlist.length === 0) return null;

  return {
    requirement,
    weights,
    minTier: availability.minTier,
    top: shortlist[0],
    alternatives: shortlist,
  };
}

function buildExplanation(result: DesignResult): string {
  const { requirement, top } = result;
  const primaryLabel = PRIORITY_AXES.find((a) => a.value === requirement.priorities.primary)?.label ?? "your primary priority";
  const secondaryLabel = requirement.priorities.secondary
    ? PRIORITY_AXES.find((a) => a.value === requirement.priorities.secondary)?.label
    : null;
  const tagPhrase = top.tags.join(" and ").toLowerCase();

  const priorityPart = secondaryLabel
    ? `${primaryLabel} was weighted highest (${PRIORITY_WEIGHT_PRIMARY}), with ${secondaryLabel} as secondary (${PRIORITY_WEIGHT_SECONDARY})`
    : `${primaryLabel} was weighted highest (${PRIORITY_WEIGHT_PRIMARY})`;

  return `${priorityPart}. Among configurations meeting your Tier ${result.minTier}+ availability requirement, this option ranked highest for those weights -- it is tagged: ${tagPhrase}.`;
}

interface Props {
  onClose: () => void;
  onLocationResolved: (loc: LocationRequirement) => void;
  onDestinationResolved: (loc: LocationRequirement) => void;
  onResult: (result: DesignResult | null) => void;
  connectivityAnalysis: ConnectivityAnalysis | null;
  /** Hands off to the explore-mode cable explorer, emphasizing these relevant cable ids. */
  onExploreCables: (cableIds: string[]) => void;
  selectedRouteCandidateId: RoutingProfileId | null;
  onSelectRouteCandidate: (id: RoutingProfileId | null) => void;
  onRouteResult: (result: RouteEngineResult | null) => void;
  routeResult: RouteEngineResult | null;
}

export default function PlanningPanel({
  onClose,
  onLocationResolved,
  onDestinationResolved,
  onResult,
  connectivityAnalysis,
  onExploreCables,
  selectedRouteCandidateId,
  onSelectRouteCandidate,
  onRouteResult,
  routeResult,
}: Props) {
  const [step, setStep] = useState<PlanningStep>("business-requirement");
  const [requirement, setRequirement] = useState<DesignRequirement>(EMPTY_REQUIREMENT);
  const [result, setResult] = useState<DesignResult | null>(null);
  const [expandedDesign, setExpandedDesign] = useState(false);
  const [expandedWeights, setExpandedWeights] = useState(false);

  const stepIndex = PLANNING_STEPS.indexOf(step);

  // Stages covered by steps strictly before the current one are "done";
  // stages covered by the current step are "current". Everything else in the
  // pipeline is either "upcoming" (implemented, not reached yet) or
  // "planned" (not implemented -- see PIPELINE_STAGES).
  const doneStageIds = new Set<PipelineStageId>();
  for (let i = 0; i < stepIndex; i++) STEP_STAGES[PLANNING_STEPS[i]].forEach((s) => doneStageIds.add(s));
  const currentStageIds = new Set(STEP_STAGES[step]);

  function jumpToStage(stageId: PipelineStageId) {
    const target = reverseStageToStep(stageId);
    if (!target) return;
    const targetIndex = PLANNING_STEPS.indexOf(target);
    if (targetIndex <= stepIndex) setStep(target);
  }

  function updateBusinessContext(patch: Partial<BusinessContext>) {
    setRequirement((r) => ({ ...r, businessContext: { ...r.businessContext, ...patch } }));
  }

  function selectIndustry(industry: Industry) {
    const defaults = INDUSTRY_DEFAULTS[industry];
    setRequirement((r) => ({
      ...r,
      businessContext: {
        ...r.businessContext,
        industry,
        availabilityRequirement: r.businessContext.availabilityRequirement ?? defaults.availability,
        capacityMW: r.businessContext.capacityMW ?? defaults.capacityMW,
      },
    }));
  }

  const canLeaveBusinessRequirement =
    requirement.businessContext.industry != null &&
    requirement.businessContext.availabilityRequirement != null &&
    (requirement.businessContext.capacityMW ?? 0) > 0 &&
    requirement.priorities.primary != null;

  const location = requirement.locationConnectivity.location;
  const destination = requirement.locationConnectivity.connectivityDestination;
  const locationResolved = location.lat != null && location.lng != null;
  const destinationTyped = destination.query.trim().length > 0;
  const destinationResolved = destination.lat != null && destination.lng != null;
  const canLeaveSiteConnectivity = locationResolved && (!destinationTyped || destinationResolved);

  function next() {
    const idx = PLANNING_STEPS.indexOf(step);
    if (idx < PLANNING_STEPS.length - 1) setStep(PLANNING_STEPS[idx + 1]);
  }
  function back() {
    const idx = PLANNING_STEPS.indexOf(step);
    if (idx > 0) setStep(PLANNING_STEPS[idx - 1]);
  }

  function generateRecommendation() {
    const r = computeResult(requirement);
    setResult(r);
    onResult(r);
    setStep("recommendation");
  }

  return (
    <div className="pp-shell">
      <header className="pp-header">
        <div>
          <span className="dc-modeled-badge">PLANNING MODE</span>
          <h1>Design a Data Centre</h1>
        </div>
        <CloseButton onClick={onClose} />
      </header>

      <PipelineRail
        doneStageIds={doneStageIds}
        currentStageIds={currentStageIds}
        onSelectStage={jumpToStage}
      />

      <nav className="pp-steps" aria-label="Workflow steps">
        {PLANNING_STEPS.map((s, i) => (
          <button
            key={s}
            className={`pp-step-dot ${i === stepIndex ? "active" : ""} ${i < stepIndex ? "done" : ""}`}
            onClick={() => (i <= stepIndex ? setStep(s) : undefined)}
            disabled={i > stepIndex}
            title={STEP_LABELS[s]}
          >
            {i + 1}
          </button>
        ))}
        <span className="pp-step-caption-inline">{STEP_LABELS[step]}</span>
      </nav>

      <div className="pp-content">
        {step === "business-requirement" && (
          <section>
            <h2 className="pp-section-title">Business Requirement</h2>
            <div className="design-field-group">
              <span className="design-label">Industry</span>
              <div className="design-segmented">
                {INDUSTRIES.map((ind) => (
                  <button
                    key={ind}
                    className={requirement.businessContext.industry === ind ? "active" : ""}
                    onClick={() => selectIndustry(ind)}
                  >
                    {ind}
                  </button>
                ))}
              </div>
            </div>

            <div className="design-field-group">
              <span className="design-label">Availability requirement</span>
              <div className="design-option-list">
                {AVAILABILITY_OPTIONS.map((opt) => (
                  <label
                    key={opt.value}
                    className={`design-option-row ${
                      requirement.businessContext.availabilityRequirement === opt.value ? "active" : ""
                    }`}
                  >
                    <input
                      type="radio"
                      name="availability"
                      checked={requirement.businessContext.availabilityRequirement === opt.value}
                      onChange={() => updateBusinessContext({ availabilityRequirement: opt.value })}
                    />
                    <span className="design-option-text">
                      <strong>{opt.label}</strong>
                      <span className="design-option-caption">{opt.caption}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div className="design-field-group">
              <label className="design-label" htmlFor="capacity-input">
                IT capacity (MW)
              </label>
              <input
                id="capacity-input"
                className="design-number-input"
                type="number"
                min={0}
                step={1}
                value={requirement.businessContext.capacityMW ?? ""}
                onChange={(e) => updateBusinessContext({ capacityMW: Number(e.target.value) || null })}
              />
              <p className="design-field-note">
                Captured for context. Does not yet affect the recommendation score.
              </p>
            </div>

            <div className="design-field-group">
              <span className="design-label">Primary priority</span>
              <div className="design-option-list">
                {PRIORITY_AXES.map((axis) => (
                  <label
                    key={axis.value}
                    className={`design-option-row ${requirement.priorities.primary === axis.value ? "active" : ""}`}
                  >
                    <input
                      type="radio"
                      name="primary-priority"
                      checked={requirement.priorities.primary === axis.value}
                      onChange={() =>
                        setRequirement((r) => ({
                          ...r,
                          priorities: {
                            primary: axis.value,
                            secondary: r.priorities.secondary === axis.value ? null : r.priorities.secondary,
                          },
                        }))
                      }
                    />
                    <span className="design-option-text">
                      <strong>{axis.label}</strong>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div className="design-field-group">
              <span className="design-label">
                Secondary priority <span className="design-optional">(optional)</span>
              </span>
              <div className="design-option-list">
                {PRIORITY_AXES.filter((a) => a.value !== requirement.priorities.primary).map((axis) => (
                  <label
                    key={axis.value}
                    className={`design-option-row ${requirement.priorities.secondary === axis.value ? "active" : ""}`}
                  >
                    <input
                      type="radio"
                      name="secondary-priority"
                      checked={requirement.priorities.secondary === axis.value}
                      onChange={() =>
                        setRequirement((r) => ({ ...r, priorities: { ...r.priorities, secondary: axis.value } }))
                      }
                    />
                    <span className="design-option-text">
                      <strong>{axis.label}</strong>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <button className="design-disclosure-toggle" onClick={() => setExpandedWeights((v) => !v)}>
              {expandedWeights ? "▾" : "▸"} How priorities become weights
            </button>
            {expandedWeights && (
              <p className="design-field-note">
                Primary priority is weighted {PRIORITY_WEIGHT_PRIMARY}, secondary {PRIORITY_WEIGHT_SECONDARY}, and the
                remaining two priorities 20 each -- a fixed, disclosed mapping, not an industry-standard or empirical
                weighting.
              </p>
            )}

            <div className="design-nav">
              <span />
              <button className="design-btn-primary" disabled={!canLeaveBusinessRequirement} onClick={next}>
                Next →
              </button>
            </div>
          </section>
        )}

        {step === "site-connectivity" && (
          <section>
            <h2 className="pp-section-title">Proposed Site</h2>
            <LocationSearchField
              label="Preferred location"
              placeholder="e.g. Chennai"
              value={location}
              onResolved={(loc) => {
                setRequirement((r) => ({
                  ...r,
                  locationConnectivity: { ...r.locationConnectivity, location: loc },
                }));
                onLocationResolved(loc);
              }}
            />

            <h2 className="pp-section-title pp-section-title-spaced">Existing Connectivity</h2>
            <p className="design-step-intro">
              Where this site needs strong connectivity to, analyzed against real submarine cable and landing-point
              data. A modeled new-cable route between the two is generated on the next step.
            </p>
            <LocationSearchField
              label="Connectivity destination"
              optional
              placeholder="e.g. Singapore"
              value={destination}
              onResolved={(loc) => {
                setRequirement((r) => ({
                  ...r,
                  locationConnectivity: { ...r.locationConnectivity, connectivityDestination: loc },
                }));
                onDestinationResolved(loc);
              }}
            />

            {connectivityAnalysis && (
              <ConnectivityAnalysisPanel analysis={connectivityAnalysis} onExploreCables={onExploreCables} />
            )}

            <div className="design-nav">
              <button className="design-btn-secondary" onClick={back}>
                ← Back
              </button>
              <button className="design-btn-primary" disabled={!canLeaveSiteConnectivity} onClick={next}>
                Next →
              </button>
            </div>
          </section>
        )}

        {step === "routes" && (
          <>
            <RouteInspector
              sourceLat={location.lat ?? null}
              sourceLng={location.lng ?? null}
              sourceLabel={location.name ?? location.query}
              destLat={destination.lat ?? null}
              destLng={destination.lng ?? null}
              destLabel={destination.name ?? destination.query}
              selectedCandidateId={selectedRouteCandidateId}
              onSelectCandidate={onSelectRouteCandidate}
              onResult={onRouteResult}
            />
            <div className="design-nav">
              <button className="design-btn-secondary" onClick={back}>
                ← Back
              </button>
              <button className="design-btn-primary" onClick={next}>
                Next →
              </button>
            </div>
          </>
        )}

        {step === "review" && (
          <section>
            <span className="dc-modeled-badge">MODELED SCENARIO</span>
            <div className="design-review-block">
              <ReviewRow label="Industry" value={requirement.businessContext.industry} onEdit={() => setStep("business-requirement")} />
              <ReviewRow
                label="Availability"
                value={AVAILABILITY_OPTIONS.find((a) => a.value === requirement.businessContext.availabilityRequirement)?.label}
                onEdit={() => setStep("business-requirement")}
              />
              <ReviewRow
                label="IT capacity"
                value={requirement.businessContext.capacityMW ? `${requirement.businessContext.capacityMW} MW` : undefined}
                mono
                onEdit={() => setStep("business-requirement")}
              />
              <ReviewRow
                label="Primary priority"
                value={PRIORITY_AXES.find((a) => a.value === requirement.priorities.primary)?.label}
                onEdit={() => setStep("business-requirement")}
              />
              <ReviewRow
                label="Secondary priority"
                value={PRIORITY_AXES.find((a) => a.value === requirement.priorities.secondary)?.label ?? "-- not specified --"}
                onEdit={() => setStep("business-requirement")}
              />
              <ReviewRow
                label="Proposed site"
                value={location.name ?? location.query}
                onEdit={() => setStep("site-connectivity")}
              />
              <ReviewRow
                label="Connectivity target"
                value={destination.name ?? (destination.query || "-- not specified --")}
                onEdit={() => setStep("site-connectivity")}
              />
            </div>

            <div className="design-nav">
              <button className="design-btn-secondary" onClick={back}>
                ← Back
              </button>
              <button className="design-btn-primary" onClick={generateRecommendation}>
                Generate →
              </button>
            </div>
          </section>
        )}

        {step === "recommendation" &&
          (result ? (
            <section>
              <span className="dc-modeled-badge">MODELED / HYPOTHETICAL</span>

              <div className="pp-decision-card">
                <div className="pp-decision-label">Recommendation</div>
                <div className="pp-decision-site">{location.name ?? location.query}</div>
                <div className="design-result-config">
                  <span className="dc-mono design-result-tier">{TIER_SPECS[result.top.config.tier].label}</span>
                  <span className="design-result-sep">&middot;</span>
                  <span className="dc-mono">{result.top.config.redundancy}</span>
                  <span className="design-result-sep">&middot;</span>
                  <span className="dc-mono">{COOLING_SPECS[result.top.config.cooling].label}</span>
                </div>
                <div className="pp-decision-availability">
                  <span className="dc-mono">{result.top.profile.availabilityPct}%</span> availability
                  <span className="pp-decision-availability-sep">·</span>
                  Tier {result.minTier}+ requirement met
                </div>
                <p className="pp-why">{buildExplanation(result)}</p>
              </div>

              <h2 className="pp-section-title pp-section-title-spaced">Existing Connectivity</h2>
              {connectivityAnalysis && (
              <ConnectivityAnalysisPanel analysis={connectivityAnalysis} onExploreCables={onExploreCables} />
            )}
              {destinationResolved && (
                <div className="pp-connectivity">
                  <div className="pp-connectivity-chain">
                    <span>{location.name ?? location.query}</span>
                    <span className="pp-connectivity-arrow">↓</span>
                    <span className="pp-connectivity-req">Connectivity requirement</span>
                    <span className="pp-connectivity-arrow">↓</span>
                    <span>{destination.name ?? destination.query}</span>
                  </div>
                  <p className="design-field-note">
                    The relevant real cables listed above are the actual existing paths near each site.
                  </p>
                </div>
              )}

              <h2 className="pp-section-title pp-section-title-spaced">Hypothetical Route</h2>
              {routeResult && routeResult.candidates.length > 0 ? (
                (() => {
                  const chosen =
                    routeResult.candidates.find((c) => c.candidate.id === selectedRouteCandidateId) ?? routeResult.candidates[0];
                  return (
                    <div className="pp-detail-card">
                      <span className="dc-modeled-badge">MODELED / HYPOTHETICAL</span>
                      <div className="design-metrics-grid">
                        <div className="design-metric">
                          <span className="design-label">Selected candidate</span>
                          <span className="dc-mono">
                            ROUTE {chosen.rank} — {chosen.candidate.shortName}
                          </span>
                        </div>
                        <div className="design-metric">
                          <span className="design-label">Total distance</span>
                          <span className="dc-mono">
                            {chosen.candidate.analysis.totalDistanceKm.toLocaleString(undefined, { maximumFractionDigits: 0 })} km
                          </span>
                        </div>
                        <div className="design-metric">
                          <span className="design-label">Seabed difficulty index (modeled)</span>
                          <span className="dc-mono">{chosen.candidate.analysis.difficultyIndex.toFixed(3)}</span>
                        </div>
                        <div className="design-metric">
                          <span className="design-label">Estimated modeled cost</span>
                          <span className="dc-mono">
                            ${(chosen.candidate.cost.totalUsd / 1_000_000).toFixed(1)}M
                          </span>
                        </div>
                      </div>
                      <p className="design-field-note">
                        Full candidate comparison, depth profile, and cost breakdown are on the{" "}
                        <button className="design-edit-link" onClick={() => setStep("routes")}>
                          Hypothetical Routes
                        </button>{" "}
                        step.
                      </p>
                    </div>
                  );
                })()
              ) : (
                <p className="design-field-note">
                  {destinationResolved
                    ? "No hypothetical route was generated -- see the Hypothetical Routes step for details."
                    : "Add a connectivity destination to generate hypothetical marine cable routes."}
                </p>
              )}

              <h2 className="pp-section-title pp-section-title-spaced">Data Centre Design</h2>
              <div className="pp-detail-card">
                <div className="design-metrics-grid">
                  <div className="design-metric">
                    <span className="design-label">PUE</span>
                    <span className="dc-mono">{result.top.profile.pue}</span>
                  </div>
                  <div className="design-metric">
                    <span className="design-label">WUE</span>
                    <span className="dc-mono">{result.top.profile.wue} L/kWh</span>
                  </div>
                  <div className="design-metric">
                    <span className="design-label">CUE</span>
                    <span className="dc-mono">{result.top.profile.cue} kg/kWh</span>
                  </div>
                  <div className="design-metric">
                    <span className="design-label">Deployment complexity</span>
                    <span className="dc-mono">{result.top.deploymentComplexity}</span>
                  </div>
                </div>
                <p className="design-field-note">
                  IT capacity: <span className="dc-mono">{requirement.businessContext.capacityMW} MW</span> -- captured
                  for context; does not yet affect this recommendation's score.
                </p>
              </div>

              <h2 className="pp-section-title pp-section-title-spaced">Resilience</h2>
              <div className="pp-detail-card">
                <div className="design-metrics-grid">
                  <div className="design-metric">
                    <span className="design-label">Availability</span>
                    <span className="dc-mono">{result.top.profile.availabilityPct}%</span>
                  </div>
                  <div className="design-metric">
                    <span className="design-label">Annual downtime</span>
                    <span className="dc-mono">{result.top.profile.annualDowntimeHours} hrs</span>
                  </div>
                </div>
                <p className="design-field-note">
                  Tier availability figures are the published Uptime Institute standard values; the redundancy
                  downtime modifier is an illustrative benchmark.
                </p>
              </div>

              <h2 className="pp-section-title pp-section-title-spaced">Economics</h2>
              <div className="pp-detail-card">
                <div className="design-metrics-grid">
                  <div className="design-metric">
                    <span className="design-label">Downtime cost impact</span>
                    <span className="dc-mono">${result.top.profile.annualDowntimeCostUsd.toLocaleString()}/yr</span>
                  </div>
                </div>
                <p className="design-field-note">
                  Based on a ${DEFAULT_DOWNTIME_COST_PER_HOUR_USD.toLocaleString()}/hr illustrative baseline. Capital
                  and operating cost modeling is not yet implemented.
                </p>
              </div>

              <button className="design-disclosure-toggle" onClick={() => setExpandedDesign((v) => !v)}>
                {expandedDesign ? "▾" : "▸"} Weights &amp; scoring inputs used
              </button>
              {expandedDesign && (
                <p className="design-field-note">
                  Weights used:{" "}
                  {(["cost", "availability", "sustainability", "speed"] as const)
                    .map((k) => `${k} ${result.weights[k]}`)
                    .join(", ")}
                  .
                </p>
              )}

              <RoadmapNote />

              <div className="design-nav">
                <button className="design-btn-secondary" onClick={back}>
                  ← Back
                </button>
                <span />
              </div>
            </section>
          ) : (
            <section>
              <p className="design-step-intro">
                No configuration could be generated from these inputs. Go back and adjust your priorities or
                availability requirement.
              </p>
              <div className="design-nav">
                <button className="design-btn-secondary" onClick={back}>
                  ← Back
                </button>
                <span />
              </div>
            </section>
          ))}
      </div>
    </div>
  );
}

function PipelineRail({
  doneStageIds,
  currentStageIds,
  onSelectStage,
}: {
  doneStageIds: Set<PipelineStageId>;
  currentStageIds: Set<PipelineStageId>;
  onSelectStage: (id: PipelineStageId) => void;
}) {
  return (
    <div className="pp-rail" aria-label="Full analysis pipeline">
      {PIPELINE_STAGES.map((stage) => {
        const isDone = doneStageIds.has(stage.id);
        const isCurrent = currentStageIds.has(stage.id);
        const isPlanned = !stage.implemented;
        const clickable = stage.implemented && (isDone || isCurrent);
        const cls = [
          "pp-rail-chip",
          isCurrent ? "current" : "",
          isDone && !isCurrent ? "done" : "",
          isPlanned ? "planned" : "",
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <button
            key={stage.id}
            className={cls}
            title={isPlanned ? `${stage.label} -- planned, not yet implemented` : stage.label}
            onClick={() => (clickable ? onSelectStage(stage.id) : undefined)}
            disabled={!clickable}
          >
            {stage.shortLabel}
          </button>
        );
      })}
    </div>
  );
}

function RoadmapNote() {
  const planned = PIPELINE_STAGES.filter((s) => !s.implemented);
  if (planned.length === 0) return null;
  return (
    <div className="pp-roadmap-note">
      <span className="design-label">Not yet part of this analysis</span>
      <div className="pp-roadmap-chips">
        {planned.map((s) => (
          <span key={s.id} className="dc-modeled-badge pp-roadmap-chip">
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

const RELEVANCE_LABEL: Record<RelevantCable["relevance"], string> = {
  direct: "Direct",
  "source-side": "Source side",
  "destination-side": "Destination side",
};

/** Renders the real-data output of connectivityAnalysis.ts -- every number and cable listed here comes straight from the dataset, nothing modeled. */
function ConnectivityAnalysisPanel({
  analysis,
  onExploreCables,
}: {
  analysis: ConnectivityAnalysis;
  onExploreCables: (cableIds: string[]) => void;
}) {
  const hasDestination = analysis.destination != null;
  const sourceUnavailable = analysis.sourceLandingPointDiversity === 0;
  const destinationUnavailable = hasDestination && analysis.destinationLandingPointDiversity === 0;

  return (
    <div>
      <div className="pp-conn-header">
        <span className="pp-real-badge">REAL DATA</span>
        {analysis.relevantCables.length > 0 && (
          <button
            className="pp-explore-cables-btn"
            onClick={() => onExploreCables(analysis.relevantCables.map((c) => c.id))}
          >
            Explore existing cables →
          </button>
        )}
      </div>

      <div className="pp-conn-summary">
        <div className="pp-conn-stat">
          <span className="pp-conn-stat-value dc-mono">{analysis.cableSystemDiversity}</span>
          <span className="pp-conn-stat-label">Relevant cable systems</span>
        </div>
        <div className="pp-conn-stat">
          <span className="pp-conn-stat-value dc-mono">
            {analysis.sourceLandingPointDiversity}
            {hasDestination ? ` / ${analysis.destinationLandingPointDiversity}` : ""}
          </span>
          <span className="pp-conn-stat-label">
            Landing points{hasDestination ? " (source / destination)" : " (source)"}
          </span>
        </div>
        {hasDestination && (
          <div className="pp-conn-stat">
            <span className="pp-conn-stat-value dc-mono">{analysis.directCableSystemDiversity}</span>
            <span className="pp-conn-stat-label">Direct systems (both ends)</span>
          </div>
        )}
        <div className="pp-conn-stat">
          <span className="pp-conn-stat-value dc-mono">{analysis.searchRadiusKm} km</span>
          <span className="pp-conn-stat-label">Search radius</span>
        </div>
      </div>

      {sourceUnavailable && (
        <p className="pp-conn-unavailable">
          No landing points found in the dataset within {analysis.searchRadiusKm} km of the proposed site --
          connectivity relevance is unavailable for this location.
        </p>
      )}
      {destinationUnavailable && (
        <p className="pp-conn-unavailable">
          No landing points found in the dataset within {analysis.searchRadiusKm} km of the destination --
          destination-side connectivity is unavailable.
        </p>
      )}
      {!hasDestination && !sourceUnavailable && (
        <p className="design-field-note">
          Add a connectivity destination to see which of these systems also land near it.
        </p>
      )}

      {analysis.relevantCables.length > 0 && (
        <div className="pp-cable-list">
          {analysis.relevantCables.map((cable) => (
            <div key={cable.id} className="pp-cable-row">
              <div className="pp-cable-row-head">
                <span className="pp-cable-name" style={{ color: cable.color }}>
                  {cable.name}
                </span>
                <span className={`pp-cable-relevance pp-cable-relevance-${cable.relevance}`}>
                  {RELEVANCE_LABEL[cable.relevance]}
                </span>
              </div>
              <div className="pp-cable-landings">
                {cable.sourceLandingPoints.length > 0 && (
                  <div>Source: {cable.sourceLandingPoints.map((lp) => lp.name).join(", ")}</div>
                )}
                {cable.destinationLandingPoints.length > 0 && (
                  <div>Destination: {cable.destinationLandingPoints.map((lp) => lp.name).join(", ")}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="design-field-note">{analysis.dataProvenance}</p>
    </div>
  );
}

function ReviewRow({
  label,
  value,
  mono,
  onEdit,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
  onEdit: () => void;
}) {
  return (
    <div className="design-review-row">
      <span className="design-review-key">{label}</span>
      <span className={mono ? "dc-mono" : ""}>{value ?? "--"}</span>
      <button className="design-edit-link" onClick={onEdit}>
        Edit
      </button>
    </div>
  );
}

function LocationSearchField({
  label,
  optional,
  placeholder,
  value,
  onResolved,
}: {
  label: string;
  optional?: boolean;
  placeholder: string;
  value: LocationRequirement;
  onResolved: (loc: LocationRequirement) => void;
}) {
  const [query, setQuery] = useState(value.query);
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<number | null>(null);

  const resolved = value.lat != null && value.lng != null;

  function handleChange(q: string) {
    setQuery(q);
    onResolved({ query: q });
    setOpen(true);
    setError(null);
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    debounceRef.current = window.setTimeout(async () => {
      setLoading(true);
      try {
        const r = await geocodeLocation(q);
        setResults(r);
      } catch {
        setError("Couldn't reach the geocoding service.");
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 400);
  }

  function select(r: GeocodeResult) {
    setQuery(r.displayName);
    setOpen(false);
    setResults([]);
    onResolved({ query: r.displayName, name: r.displayName, country: r.country, lat: r.lat, lng: r.lng });
  }

  return (
    <div className="design-field-group pp-location-field">
      <label className="design-label">
        {label} {optional && <span className="design-optional">(optional)</span>}
      </label>
      <input
        className="design-text-input"
        type="text"
        placeholder={placeholder}
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
      />
      {resolved && !open && (
        <div className="pp-resolved">
          <span className="pp-resolved-name">{value.name}</span>
          <span className="pp-resolved-coords dc-mono">
            {value.lat!.toFixed(4)}, {value.lng!.toFixed(4)}
          </span>
        </div>
      )}
      {open && (loading || results.length > 0 || error) && (
        <div className="pp-suggest">
          {loading && <div className="pp-suggest-status">Searching…</div>}
          {error && <div className="pp-suggest-status pp-suggest-error">{error}</div>}
          {results.map((r) => (
            <button
              key={`${r.lat},${r.lng}`}
              className="pp-suggest-item"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => select(r)}
            >
              {r.displayName}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
