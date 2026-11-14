export const ROUTE_TYPE_LABELS: Record<number, string> = {
	4: 'Ferry',
	700: 'Bus',
	701: 'Regional bus',
	702: 'Express bus',
	703: 'Stopping bus',
	704: 'Local bus',
	705: 'Night bus',
	706: 'Post bus',
	707: 'Special needs bus',
	708: 'Mobility bus',
	709: 'Mobility bus (registered)',
	710: 'Sightseeing bus',
	711: 'Shuttle bus',
	712: 'School bus',
	713: 'School and public bus',
	714: 'Rail replacement',
	715: 'Demand responsive',
	716: 'Demand responsive',
	800: 'Trolleybus'
};

export function routeTypeLabel(routeType: number): string {
	return ROUTE_TYPE_LABELS[routeType] ?? `Type ${routeType}`;
}
