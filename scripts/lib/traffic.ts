import { createHash } from 'node:crypto';

export interface TrafficIncidentRow {
	id: string;
	source: string;
	category: string | null;
	kind: string | null;
	headline: string | null;
	displayName: string | null;
	roads: string | null;
	suburbs: string | null;
	advice: string | null;
	expectedDelay: number | null;
	isMajor: boolean;
	impactingNetwork: boolean;
	publicTransport: string | null;
	startsAt: Date | null;
	endsAt: Date | null;
	updatedAt: Date | null;
	lat: number | null;
	lon: number | null;
	properties: Record<string, unknown>;
	lastSeen: Date;
}

export interface IncidentFeature {
	id?: string | number;
	geometry?: { type: string; coordinates: unknown };
	properties?: Record<string, unknown>;
}

export interface IncidentFeed {
	features?: IncidentFeature[];
}

function stripHtml(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const text = value
		.replace(/<[^>]+>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	return text || null;
}

function epoch(value: unknown): Date | null {
	if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
	return new Date(value);
}

function pointFromGeometry(geometry: IncidentFeature['geometry']): {
	lat: number;
	lon: number;
} | null {
	if (!geometry) return null;

	if (geometry.type === 'Point') {
		const [lon, lat] = geometry.coordinates as number[];
		return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
	}

	if (geometry.type === 'LineString') {
		const coordinates = geometry.coordinates as number[][];
		const first = coordinates[0];
		const last = coordinates[coordinates.length - 1];
		if (!first || !last) return null;
		return { lat: (first[1] + last[1]) / 2, lon: (first[0] + last[0]) / 2 };
	}

	if (geometry.type === 'MultiLineString') {
		const coordinates = geometry.coordinates as number[][][];
		const first = coordinates[0]?.[0];
		const last = coordinates[coordinates.length - 1]?.slice(-1)[0];
		if (!first || !last) return null;
		return { lat: (first[1] + last[1]) / 2, lon: (first[0] + last[0]) / 2 };
	}

	return null;
}

function incidentId(source: string, feature: IncidentFeature, point: { lat: number; lon: number }): string {
	const raw = feature.id;
	if (raw !== undefined && raw !== null) {
		const numeric = Number(raw);
		return `${source}:${Number.isFinite(numeric) ? Math.trunc(numeric) : String(raw)}`;
	}

	const hash = createHash('sha1')
		.update(
			JSON.stringify({
				source,
				displayName: feature.properties?.displayName,
				created: feature.properties?.created,
				lat: point.lat,
				lon: point.lon
			})
		)
		.digest('hex');
	return `${source}:${hash}`;
}

export function normaliseIncidents(
	source: string,
	feed: IncidentFeed,
	observedAt: Date
): TrafficIncidentRow[] {
	const rows: TrafficIncidentRow[] = [];

	for (const feature of feed.features ?? []) {
		const properties = feature.properties ?? {};
		const point = pointFromGeometry(feature.geometry);
		if (!point) continue;

		const roads = Array.isArray(properties.roads)
			? (properties.roads as Array<Record<string, unknown>>)
			: [];
		const roadText =
			roads
				.map((road) =>
					[road.mainStreet, road.crossStreet].filter((value) => typeof value === 'string' && value).join(' / ')
				)
				.filter(Boolean)
				.join('; ') || null;
		const suburbs =
			[...new Set(roads.map((road) => road.suburb).filter((value) => typeof value === 'string' && value))].join(
				', '
			) || null;

		const advice =
			[properties.adviceA, properties.adviceB, properties.adviceC]
				.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
				.join(' · ') || stripHtml(properties.otherAdvice);

		const expectedDelay =
			typeof properties.expectedDelay === 'number' && properties.expectedDelay >= 0
				? properties.expectedDelay
				: null;

		rows.push({
			id: incidentId(source, feature, point),
			source,
			category: typeof properties.mainCategory === 'string' ? properties.mainCategory : null,
			kind: typeof properties.incidentKind === 'string' ? properties.incidentKind : null,
			headline: typeof properties.headline === 'string' && properties.headline ? properties.headline : null,
			displayName:
				typeof properties.displayName === 'string' && properties.displayName
					? properties.displayName
					: null,
			roads: roadText,
			suburbs,
			advice,
			expectedDelay,
			isMajor: properties.isMajor === true,
			impactingNetwork: properties.impactingNetwork === true,
			publicTransport:
				typeof properties.publicTransport === 'string' && properties.publicTransport
					? properties.publicTransport
					: null,
			startsAt: epoch(properties.start),
			endsAt: epoch(properties.end),
			updatedAt: epoch(properties.lastUpdated),
			lat: point.lat,
			lon: point.lon,
			properties,
			lastSeen: observedAt
		});
	}

	return rows;
}
