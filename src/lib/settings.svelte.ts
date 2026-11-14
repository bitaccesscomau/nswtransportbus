export type Metric = 'net' | 'gross' | 'band';

const DEFAULTS = {
	metric: 'net' as Metric,
	alightingRate: 0.15,
	lowSample: 10,
	showConfidence: true
};

export const settings = $state({ ...DEFAULTS });

let loaded = false;

export function loadSettings(): void {
	if (loaded || typeof localStorage === 'undefined') return;
	loaded = true;

	try {
		const raw = localStorage.getItem('nswbus.settings');
		if (!raw) return;

		const parsed = JSON.parse(raw) as Partial<typeof DEFAULTS>;
		if (parsed.metric === 'net' || parsed.metric === 'gross' || parsed.metric === 'band') {
			settings.metric = parsed.metric;
		}
		if (typeof parsed.alightingRate === 'number' && parsed.alightingRate >= 0 && parsed.alightingRate <= 1) {
			settings.alightingRate = parsed.alightingRate;
		}
		if (typeof parsed.lowSample === 'number' && parsed.lowSample >= 1) {
			settings.lowSample = parsed.lowSample;
		}
		if (typeof parsed.showConfidence === 'boolean') {
			settings.showConfidence = parsed.showConfidence;
		}
	} catch {
		// Ignore a malformed local setting and keep defaults.
	}
}

export function saveSettings(): void {
	if (typeof localStorage === 'undefined') return;
	localStorage.setItem('nswbus.settings', JSON.stringify(settings));
}

export function metricLabel(metric: Metric = settings.metric): string {
	if (metric === 'gross') return 'Modelled gross boardings';
	if (metric === 'band') return 'Band-change index';
	return 'Net change';
}

export function metricValue(
	row: { avgNet: number | null; avgBefore: number | null; avgBand: number | null },
	metric: Metric = settings.metric,
	alightingRate: number = settings.alightingRate
): number {
	if (metric === 'band') return row.avgBand ?? 0;
	if (metric === 'gross') {
		return Math.max(0, (row.avgNet ?? 0) + alightingRate * (row.avgBefore ?? 0));
	}
	return row.avgNet ?? 0;
}

export function confidence(
	samples: number,
	threshold: number = settings.lowSample
): 'low' | 'medium' | 'high' {
	if (samples < threshold) return 'low';
	if (samples < threshold * 3) return 'medium';
	return 'high';
}
