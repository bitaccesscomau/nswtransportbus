import { sql } from 'drizzle-orm';
import {
	bigint,
	boolean,
	date,
	doublePrecision,
	index,
	integer,
	jsonb,
	pgTable,
	primaryKey,
	real,
	smallint,
	text,
	timestamp
} from 'drizzle-orm/pg-core';
import { pointGeometry } from './types';

/**
 * Partitioned tables. Their DDL is created by a custom Drizzle migration because
 * drizzle-kit does not model `PARTITION BY`; these definitions exist for typed
 * queries and inserts.
 */
export const vehiclePositions = pgTable(
	'vehicle_positions',
	{
		observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
		serviceDate: date('service_date', { mode: 'string' }).notNull(),
		pollId: bigint('poll_id', { mode: 'number' }).notNull(),
		entityId: text('entity_id'),
		vehicleId: text('vehicle_id'),
		vehicleKey: text('vehicle_key').generatedAlwaysAs(sql`coalesce(vehicle_id, entity_id)`),
		tripId: text('trip_id'),
		routeId: text('route_id'),
		directionId: smallint('direction_id'),
		lat: doublePrecision('lat').notNull(),
		lon: doublePrecision('lon').notNull(),
		geom: pointGeometry('geom').generatedAlwaysAs(
			sql`st_setsrid(st_makepoint(lon, lat), 4326)`
		),
		bearing: real('bearing'),
		speedMps: real('speed_mps'),
		currentStopSequence: integer('current_stop_sequence'),
		stopId: text('stop_id'),
		currentStatus: text('current_status'),
		congestion: text('congestion'),
		occupancy: text('occupancy'),
		feedTimestamp: timestamp('feed_timestamp', { withTimezone: true })
	},
	(t) => [
		index('vehicle_positions_observed_idx').on(t.observedAt),
		index('vehicle_positions_vehicle_idx').on(t.vehicleKey, t.observedAt),
		index('vehicle_positions_trip_idx').on(t.tripId, t.observedAt),
		index('vehicle_positions_route_idx').on(t.routeId, t.observedAt),
		index('vehicle_positions_geom_idx').using('gist', t.geom)
	]
);

export const tripObservations = pgTable(
	'trip_observations',
	{
		serviceDate: date('service_date', { mode: 'string' }).notNull(),
		tripId: text('trip_id').notNull(),
		stopSequence: integer('stop_sequence').notNull(),
		stopId: text('stop_id'),
		startTime: text('start_time'),
		predictedArrival: timestamp('predicted_arrival', { withTimezone: true }),
		predictedDeparture: timestamp('predicted_departure', { withTimezone: true }),
		delayS: integer('delay_s'),
		scheduleRelationship: text('schedule_relationship'),
		departureOccupancy: text('departure_occupancy'),
		firstSeen: timestamp('first_seen', { withTimezone: true }).notNull(),
		lastSeen: timestamp('last_seen', { withTimezone: true }).notNull(),
		observations: integer('observations').notNull().default(1),
		source: text('source').notNull().default('trip_update')
	},
	(t) => [
		primaryKey({ columns: [t.serviceDate, t.tripId, t.stopSequence] }),
		index('trip_observations_trip_idx').on(t.tripId, t.serviceDate),
		index('trip_observations_stop_idx').on(t.stopId, t.serviceDate)
	]
);


export const tripDelays = pgTable(
	'trip_delays',
	{
		observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
		serviceDate: date('service_date', { mode: 'string' }).notNull(),
		tripId: text('trip_id').notNull(),
		routeId: text('route_id'),
		delayS: integer('delay_s'),
		stopSequence: integer('stop_sequence')
	},
	(t) => [
		primaryKey({ columns: [t.observedAt, t.tripId] }),
		index('trip_delays_trip_idx').on(t.tripId, t.serviceDate, t.observedAt.desc()),
		index('trip_delays_observed_idx').on(t.observedAt)
	]
);


export const trafficIncidents = pgTable('traffic_incidents', {
	id: text('id').primaryKey(),
	source: text('source').notNull(),
	category: text('category'),
	kind: text('kind'),
	headline: text('headline'),
	displayName: text('display_name'),
	roads: text('roads'),
	suburbs: text('suburbs'),
	advice: text('advice'),
	expectedDelay: integer('expected_delay'),
	isMajor: boolean('is_major').notNull().default(false),
	impactingNetwork: boolean('impacting_network').notNull().default(false),
	publicTransport: text('public_transport'),
	startsAt: timestamp('starts_at', { withTimezone: true }),
	endsAt: timestamp('ends_at', { withTimezone: true }),
	updatedAt: timestamp('updated_at', { withTimezone: true }),
	lat: doublePrecision('lat'),
	lon: doublePrecision('lon'),
	geom: pointGeometry('geom').generatedAlwaysAs(
		sql`st_setsrid(st_makepoint(lon, lat), 4326)`
	),
	properties: jsonb('properties').$type<Record<string, unknown>>().notNull(),
	lastSeen: timestamp('last_seen', { withTimezone: true }).notNull()
});
