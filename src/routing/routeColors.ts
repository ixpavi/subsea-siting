// Per-candidate route colours, shared by the globe (which draws the corridors)
// and the route switcher (which lets the user pick between them).
//
// In their own module rather than inside Globe.tsx so the two cannot drift
// apart: a switcher button's swatch and its line on the globe must be the same
// colour, because that pairing is the only thing telling the user which line
// the button selects.
import type { RoutingProfileId } from "./routingTypes";

export const ROUTE_COLORS: Record<RoutingProfileId, string> = {
  shortest: "#facc15",
  "shallow-favoring": "#a78bfa",
  "diverse-corridor": "#34d399",
};

/**
 * Bright, high-contrast override for whichever candidate is currently
 * selected -- distinct from every ROUTE_COLORS entry and from every real-cable
 * colour in the dataset, so "the proposed route" reads as a completely
 * different kind of object, not just another coloured line among hundreds.
 */
export const SELECTED_ROUTE_COLOR = "#ffffff";
