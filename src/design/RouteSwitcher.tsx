// Switches between the hypothetical route candidates, over the globe.
//
// WHY THIS EXISTS. The globe draws all three proposed corridors at once --
// shortest, depth-favouring and diversity-seeking -- but the only way to pick
// one was a list at the bottom of the Routes step, measured at 1,515 px down a
// panel 840 px tall, below the endpoint cards, the weighting controls and
// three explanatory notices. On every later step there was no way at all.
// Three lines on the globe and no visible means of choosing between them.
//
// This sits over the globe for as long as routes are drawn, on every step, so
// the choice is always one click away and always next to the lines it
// controls. It changes the SAME selection the Routes step's list does, so the
// two can never disagree.
import type { RouteEngineResult, RoutingProfileId } from "../routing/routingTypes";
import { ROUTE_COLORS, SELECTED_ROUTE_COLOR } from "../routing/routeColors";
import "./design.css";

interface Props {
  result: RouteEngineResult;
  selectedId: RoutingProfileId | null;
  onSelect: (id: RoutingProfileId) => void;
}

function km(value: number): string {
  return `${Math.round(value).toLocaleString("en-US")} km`;
}

export default function RouteSwitcher({ result, selectedId, onSelect }: Props) {
  if (result.candidates.length === 0) return null;
  // Mirrors the globe, which highlights the top-ranked route until the user
  // picks another -- so the switcher never shows nothing selected.
  const activeId = selectedId ?? result.candidates[0].candidate.id;

  return (
    <div className="route-switcher" role="group" aria-label="Choose which proposed route to show">
      <span className="route-switcher-title">Proposed routes &mdash; choose one</span>
      <div className="route-switcher-options">
        {result.candidates.map((rc) => {
          const id = rc.candidate.id;
          const active = id === activeId;
          return (
            <button
              key={id}
              type="button"
              className={`route-switcher-option${active ? " active" : ""}`}
              aria-pressed={active}
              onClick={() => onSelect(id)}
              title={`${rc.candidate.label}: ${rc.candidate.description}`}
            >
              {/* White when selected, because the globe draws the selected route
                  in white; otherwise the route's own colour, as it is drawn. */}
              <span
                className="route-switcher-swatch"
                style={{ background: active ? SELECTED_ROUTE_COLOR : ROUTE_COLORS[id] }}
                aria-hidden="true"
              />
              <span className="route-switcher-text">
                <span className="route-switcher-name">
                  Route {rc.rank} &middot; {rc.candidate.shortName}
                </span>
                <span className="route-switcher-meta">
                  {km(rc.candidate.analysis.marineDistanceKm)} marine
                  {rc.isRecommended ? " · recommended" : ""}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
