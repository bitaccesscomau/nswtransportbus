/**
 * Scheduled route pace scale, in minutes per kilometre.
 *
 * Derived from the active feed's distance-weighted route paces:
 * p05 = 1.43, median = 2.49, p95 = 4.16 min/km across 5,967 bus routes.
 * Round values are used for the map legend and colour interpolation.
 */
export const ROUTE_PACE_SCALE = {
	fast: 1.5,
	mid: 2.5,
	slow: 4.2
} as const;

export const ROUTE_PACE_COLORS = {
	fast: '#16a34a',
	mid: '#eab308',
	slow: '#dc2626',
	unknown: '#94a3b8'
} as const;
