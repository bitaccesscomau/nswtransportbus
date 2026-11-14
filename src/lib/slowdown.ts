/**
 * Observed slowdown scale, in km/h.
 *
 * Calibrated from the average moving speed of 200 m route sections with at
 * least three sampled GPS positions in the last 24 hours (p10/p50/p90). Red is slow, green is fast.
 */
export const SLOWDOWN_SCALE = {
	slow: 18,
	mid: 30,
	fast: 49
} as const;

export const SLOWDOWN_COLORS = {
	slow: '#dc2626',
	mid: '#f59e0b',
	fast: '#16a34a'
} as const;
