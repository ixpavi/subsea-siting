// Environmental exposure assessment for a candidate route -- INTENTIONALLY
// UNAVAILABLE today. This app does not integrate any verified marine
// protected-area, coral-reef, or other environmental geographic dataset
// (WDPA, Allen Coral Atlas, etc.) -- see the same disclosure already made in
// calculator/environmentalRisk.ts. Per the project's data-integrity rule,
// an unavailable dataset must be reported as unavailable, never silently
// treated as "no constraints found" (which would misrepresent absence of
// data as evidence of environmental safety) and never backed by an invented
// boundary.
//
// The return shape is intentionally already the full EnvironmentalAssessment
// shape (see routingTypes.ts) so that integrating a real dataset later is a
// change to this one function, not a reshape of every caller.
import type { EnvironmentalAssessment } from "./routingTypes";

export function assessEnvironmental(_marinePath: [number, number][]): EnvironmentalAssessment {
  return {
    available: false,
    reason:
      "No verified marine-protected-area, coral-reef, or other environmental geographic dataset is integrated in this app. Environmental exposure cannot be assessed for this route -- this is reported as unavailable, not as \"no constraints found.\"",
  };
}
