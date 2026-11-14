import { fileURLToPath } from 'node:url';
import protobuf from 'protobufjs';

const protoPath = fileURLToPath(new URL('../../proto/gtfs-realtime-tfnsw.proto', import.meta.url));
const root = new protobuf.Root();
await root.load(protoPath, { keepCase: true });
const FeedMessage = root.lookupType('transit_realtime.FeedMessage');

interface TripDescriptor {
	trip_id?: string;
	route_id?: string;
	direction_id?: number;
	start_time?: string;
	start_date?: string;
	schedule_relationship?: number;
}

interface VehicleDescriptor {
	id?: string;
	label?: string;
	license_plate?: string;
}

interface Position {
	latitude: number;
	longitude: number;
	bearing?: number;
	speed?: number;
}

interface VehiclePosition {
	trip?: TripDescriptor;
	vehicle?: VehicleDescriptor;
	position?: Position;
	current_stop_sequence?: number;
	stop_id?: string;
	current_status?: number;
	timestamp?: number | { toNumber(): number };
	congestion_level?: number;
	occupancy_status?: number;
}

interface StopTimeEvent {
	delay?: number;
	time?: number | { toNumber(): number };
	uncertainty?: number;
}

interface StopTimeUpdate {
	stop_sequence?: number;
	stop_id?: string;
	arrival?: StopTimeEvent;
	departure?: StopTimeEvent;
	schedule_relationship?: number;
	departure_occupancy_status?: number;
}

interface TripUpdate {
	trip?: TripDescriptor;
	vehicle?: VehicleDescriptor;
	stop_time_update?: StopTimeUpdate[];
	timestamp?: number | { toNumber(): number };
	delay?: number;
}

interface FeedEntity {
	id: string;
	vehicle?: VehiclePosition;
	trip_update?: TripUpdate;
}

interface Feed {
	header?: { gtfs_realtime_version?: string; timestamp?: number | { toNumber(): number } };
	entity?: FeedEntity[];
}

export interface VehiclePositionRow {
	observedAt: Date;
	serviceDate: string;
	entityId: string;
	vehicleId: string | null;
	vehicleKey: string;
	tripId: string | null;
	routeId: string | null;
	directionId: number | null;
	lat: number;
	lon: number;
	bearing: number | null;
	speedMps: number | null;
	currentStopSequence: number | null;
	stopId: string | null;
	currentStatus: string | null;
	congestion: string | null;
	occupancy: string | null;
	feedTimestamp: Date | null;
}

export interface TripDelayRow {
	observedAt: Date;
	serviceDate: string;
	tripId: string;
	routeId: string | null;
	delayS: number | null;
	stopSequence: number | null;
}

export interface StopObservationRow {
	serviceDate: string;
	tripId: string;
	stopSequence: number;
	stopId: string | null;
	startTime: string | null;
	predictedArrival: Date | null;
	predictedDeparture: Date | null;
	delayS: number | null;
	scheduleRelationship: string | null;
	departureOccupancy: string | null;
	firstSeen: Date;
	lastSeen: Date;
}

const CURRENT_STATUS = ['INCOMING_AT', 'STOPPED_AT', 'IN_TRANSIT_TO'] as const;
const CONGESTION = [
	'UNKNOWN_CONGESTION_LEVEL',
	'RUNNING_SMOOTHLY',
	'STOP_AND_GO',
	'CONGESTION',
	'SEVERE_CONGESTION'
] as const;
const OCCUPANCY = [
	'EMPTY',
	'MANY_SEATS_AVAILABLE',
	'FEW_SEATS_AVAILABLE',
	'STANDING_ROOM_ONLY',
	'CRUSHED_STANDING_ROOM_ONLY',
	'FULL',
	'NOT_ACCEPTING_PASSENGERS'
] as const;
const STOP_RELATIONSHIP = ['SCHEDULED', 'SKIPPED', 'NO_DATA', 'UNSCHEDULED'] as const;

function enumName(
	values: readonly string[],
	value: number | undefined
): string | null {
	if (value === undefined) return null;
	return values[value] ?? null;
}

function numeric(value: number | { toNumber(): number } | undefined): number | null {
	if (value === undefined) return null;
	if (typeof value === 'number') return value;
	return value.toNumber();
}

function epoch(value: number | { toNumber(): number } | undefined): number | null {
	const seconds = numeric(value);
	return seconds === null ? null : seconds * 1000;
}

function parseDate(value: string | undefined): string | null {
	if (!value || value.length !== 8) return null;
	return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

const sydneyDate = new Intl.DateTimeFormat('en-CA', {
	timeZone: 'Australia/Sydney',
	year: 'numeric',
	month: '2-digit',
	day: '2-digit'
});

function localServiceDate(date: Date): string {
	return sydneyDate.format(date);
}

function isNsw(lat: number, lon: number): boolean {
	return lat >= -38.5 && lat <= -27.5 && lon >= 140 && lon <= 154.5;
}

export function decodeFeed(bytes: Uint8Array): Feed {
	return FeedMessage.decode(bytes) as unknown as Feed;
}

export function normaliseVehiclePositions(feed: Feed, observedAt: Date): VehiclePositionRow[] {
	const rows: VehiclePositionRow[] = [];

	for (const entity of feed.entity ?? []) {
		const vehicle = entity.vehicle;
		const position = vehicle?.position;
		if (!position) continue;

		const lat = position.latitude;
		const lon = position.longitude;
		if (!Number.isFinite(lat) || !Number.isFinite(lon) || !isNsw(lat, lon)) continue;

		const vehicleId = vehicle.vehicle?.id || null;
		const trip = vehicle.trip;
		const serviceDate = parseDate(trip?.start_date) ?? localServiceDate(observedAt);
		const feedTimestamp = epoch(vehicle.timestamp);

		rows.push({
			observedAt,
			serviceDate,
			entityId: entity.id,
			vehicleId,
			vehicleKey: vehicleId ?? entity.id,
			tripId: trip?.trip_id || null,
			routeId: trip?.route_id || null,
			directionId: trip?.direction_id ?? null,
			lat,
			lon,
			bearing: position.bearing ?? null,
			speedMps: position.speed ?? null,
			currentStopSequence: vehicle.current_stop_sequence ?? null,
			stopId: vehicle.stop_id || null,
			currentStatus: enumName(CURRENT_STATUS, vehicle.current_status),
			congestion: enumName(CONGESTION, vehicle.congestion_level),
			occupancy: enumName(OCCUPANCY, vehicle.occupancy_status),
			feedTimestamp: feedTimestamp === null ? null : new Date(feedTimestamp)
		});
	}

	return rows;
}

export function normaliseTripObservations(feed: Feed, observedAt: Date): StopObservationRow[] {
	const rows: StopObservationRow[] = [];
	const now = observedAt.getTime();
	const windowStart = now - 15 * 60 * 1000;
	const windowEnd = now + 5 * 60 * 1000;

	for (const entity of feed.entity ?? []) {
		const update = entity.trip_update;
		const trip = update?.trip;
		if (!update || !trip?.trip_id) continue;

		const serviceDate = parseDate(trip.start_date) ?? localServiceDate(observedAt);

		for (const stop of update.stop_time_update ?? []) {
			if (stop.stop_sequence === undefined) continue;

			const arrivalMs = epoch(stop.arrival?.time);
			const departureMs = epoch(stop.departure?.time);
			if (arrivalMs === null && departureMs === null) continue;

			const inWindow = [arrivalMs, departureMs].some(
				(value) => value !== null && value >= windowStart && value <= windowEnd
			);
			if (!inWindow) continue;

			rows.push({
				serviceDate,
				tripId: trip.trip_id,
				stopSequence: stop.stop_sequence,
				stopId: stop.stop_id || null,
				startTime: trip.start_time || null,
				predictedArrival: arrivalMs === null ? null : new Date(arrivalMs),
				predictedDeparture: departureMs === null ? null : new Date(departureMs),
				delayS: stop.arrival?.delay ?? stop.departure?.delay ?? update.delay ?? null,
				scheduleRelationship: enumName(STOP_RELATIONSHIP, stop.schedule_relationship),
				departureOccupancy: enumName(OCCUPANCY, stop.departure_occupancy_status),
				firstSeen: observedAt,
				lastSeen: observedAt
			});
		}
	}

	return rows;
}


export function normaliseTripDelays(feed: Feed, observedAt: Date): TripDelayRow[] {
	const rows: TripDelayRow[] = [];

	for (const entity of feed.entity ?? []) {
		const update = entity.trip_update;
		const trip = update?.trip;
		if (!update || !trip?.trip_id) continue;

		const serviceDate = parseDate(trip.start_date) ?? localServiceDate(observedAt);
		const nextStop = (update.stop_time_update ?? []).find(
			(stop) => stop.arrival?.delay !== undefined || stop.departure?.delay !== undefined
		);

		rows.push({
			observedAt,
			serviceDate,
			tripId: trip.trip_id,
			routeId: trip.route_id || null,
			delayS: nextStop?.arrival?.delay ?? nextStop?.departure?.delay ?? update.delay ?? null,
			stopSequence: nextStop?.stop_sequence ?? null
		});
	}

	return rows;
}
