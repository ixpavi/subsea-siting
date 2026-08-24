// Environmental exposure assessment for a candidate route.
//
// Previously this returned UNAVAILABLE unconditionally, because no
// environmental dataset was integrated. One now is: marine protected areas
// from the World Database on Protected Areas, European extract, republished by
// EMODnet Human Activities and rasterised at build time
// (scripts/build-protected-areas.mjs).
//
// The unavailable path has NOT been removed, and that is deliberate. The
// dataset is European, so a route outside its extent still cannot be assessed,
// and neither can one computed before the grid has loaded. Those cases return
// exactly what they did before, because "we have no data here" and "we checked
// and found nothing" remain different answers.
import type { EnvironmentalAssessment } from "./routingTypes";
import type { ProtectedAreaGrid } from "./protectedAreas";
import { assessEnvironmentalWithGrid } from "./protectedAreas";

export function assessEnvironmental(
  marinePath: [number, number][],
  grid: ProtectedAreaGrid | null
): EnvironmentalAssessment {
  if (!grid) {
    return {
      available: false,
      reason:
        "The marine protected-area dataset could not be loaded, so environmental exposure cannot be " +
        "assessed for this route. Reported as unavailable, not as \"no constraints found.\"",
    };
  }
  return assessEnvironmentalWithGrid(marinePath, grid);
}
