export interface VehicleSnapshot {
	vehicleKey: string;
	vehicleId: string | null;
	tripId: string | null;
	routeId: string | null;
	lat: number;
	lon: number;
	bearing: number | null;
	speedMps: number | null;
	currentStatus: string | null;
	occupancy: string | null;
	observedAt: string | Date;
	delayS: number | null;
}

export interface HistoryBounds {
	min: string | null;
	max: string | null;
}

export interface TrafficIncidentProperties {
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
	startsAt: string | null;
	endsAt: string | null;
	updatedAt: string | null;
}

export interface BusCongestionProperties {
	avgSpeedMps: number;
	speedKmh: number;
	samples: number;
	level: number;
}

export interface PassedStopProperties {
	stopId: string;
	stopName: string;
	meters: number;
}

export interface SimulationRemovedStop {
	stopId: string;
	stopName: string;
	lat: number;
	lon: number;
}

export interface SimulationResult {
	scenario: 'consolidate' | 'express';
	parameters: {
		radiusMeters?: number;
		skipEvery?: number;
		dwellSeconds: number;
		onTimeThresholdSeconds: number;
		windowDays: number;
	};
	tripsAnalyzed: number;
	baselineOnTimeTrips: number;
	simulatedOnTimeTrips: number;
	baselineTripOnTimePct: number;
	simulatedTripOnTimePct: number;
	baselineRouteOnTimePct: number;
	simulatedRouteOnTimePct: number;
	stopsRemoved: number;
	routesAffected: number;
	avgSavedSeconds: number | null;
	removedStops: SimulationRemovedStop[];
}

export type InsightKind = 'least-used' | 'extension' | 'transfers';

export interface InsightRow {
	id: string;
	label: string;
	lat: number;
	lon: number;
	detail: string;
	metric: string;
}

export interface InsightResult {
	kind: InsightKind;
	parameters: Record<string, number>;
	rows: InsightRow[];
	note: string;
}
