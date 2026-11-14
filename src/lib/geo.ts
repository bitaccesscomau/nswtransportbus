const EARTH_RADIUS_METERS = 6_371_000;

export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
	const toRadians = Math.PI / 180;
	const dLat = (lat2 - lat1) * toRadians;
	const dLon = (lon2 - lon1) * toRadians;
	const a =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(lat1 * toRadians) * Math.cos(lat2 * toRadians) * Math.sin(dLon / 2) ** 2;
	return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(a));
}

export const INCIDENT_COLORS: Record<string, string> = {
	incident: '#dc2626',
	roadwork: '#f59e0b',
	flood: '#2563eb',
	majorevent: '#7c3aed',
	fire: '#991b1b'
};

export function incidentColor(source: string): string {
	return INCIDENT_COLORS[source] ?? '#64748b';
}
