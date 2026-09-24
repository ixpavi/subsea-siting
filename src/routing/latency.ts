// Round-trip time over a cable of a given length -- the number that ties a
// data centre to its connection. A trading firm or a real-time AI service cares
// how many milliseconds the site is from its users as much as what it costs.
//
// Light in optical fibre travels at about c / 1.47 -- roughly 204,000 km/s, or
// 4.9 microseconds per kilometre one way. Round trip doubles it. This is the
// physical floor: switching, routing and queueing only ever add to it, so the
// figure is labelled as a minimum, never as a measured ping.

/** One-way propagation delay in optical fibre, microseconds per km. */
export const FIBRE_DELAY_US_PER_KM = 4.9;

/** Minimum round-trip time in milliseconds over `km` of fibre. */
export function roundTripMs(km: number): number {
  return (2 * km * FIBRE_DELAY_US_PER_KM) / 1000;
}
