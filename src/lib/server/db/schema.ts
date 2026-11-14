import { sql } from 'drizzle-orm';
import {
	bigint,
	bigserial,
	boolean,
	date,
	doublePrecision,
	index,
	integer,
	pgTable,
	primaryKey,
	real,
	smallint,
	text,
	timestamp,
	uniqueIndex
} from 'drizzle-orm/pg-core';
import { lineGeometry, pointGeometry } from './types';

export const feedVersions = pgTable(
	'feed_versions',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),
		source: text('source').notNull(),
		fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
		sha256: text('sha256').notNull(),
		bytes: bigint('bytes', { mode: 'number' }),
		isActive: boolean('is_active').notNull().default(false),
		notes: text('notes')
	},
	(t) => [
		uniqueIndex('feed_versions_one_active_idx')
			.on(t.isActive)
			.where(sql`${t.isActive}`)
	]
);

export const agencies = pgTable(
	'agencies',
	{
		feedVersionId: bigint('feed_version_id', { mode: 'number' })
			.notNull()
			.references(() => feedVersions.id, { onDelete: 'cascade' }),
		agencyId: text('agency_id').notNull(),
		agencyName: text('agency_name'),
		agencyUrl: text('agency_url'),
		agencyTimezone: text('agency_timezone'),
		agencyLang: text('agency_lang'),
		agencyPhone: text('agency_phone')
	},
	(t) => [primaryKey({ columns: [t.feedVersionId, t.agencyId] })]
);

export const routes = pgTable(
	'routes',
	{
		feedVersionId: bigint('feed_version_id', { mode: 'number' })
			.notNull()
			.references(() => feedVersions.id, { onDelete: 'cascade' }),
		routeId: text('route_id').notNull(),
		agencyId: text('agency_id').notNull(),
		routeShortName: text('route_short_name'),
		routeLongName: text('route_long_name'),
		routeDesc: text('route_desc'),
		routeType: integer('route_type'),
		routeColor: text('route_color'),
		routeTextColor: text('route_text_color'),
		routeSortOrder: integer('route_sort_order')
	},
	(t) => [primaryKey({ columns: [t.feedVersionId, t.routeId] })]
);

export const stops = pgTable(
	'stops',
	{
		feedVersionId: bigint('feed_version_id', { mode: 'number' })
			.notNull()
			.references(() => feedVersions.id, { onDelete: 'cascade' }),
		stopId: text('stop_id').notNull(),
		stopName: text('stop_name').notNull(),
		stopLat: doublePrecision('stop_lat').notNull(),
		stopLon: doublePrecision('stop_lon').notNull(),
		geom: pointGeometry('geom').generatedAlwaysAs(
			sql`st_setsrid(st_makepoint(stop_lon, stop_lat), 4326)`
		),
		locationType: integer('location_type'),
		parentStation: text('parent_station'),
		wheelchairBoarding: integer('wheelchair_boarding'),
		platformCode: text('platform_code')
	},
	(t) => [
		primaryKey({ columns: [t.feedVersionId, t.stopId] }),
		index('stops_geom_idx').using('gist', t.geom)
	]
);

export const trips = pgTable(
	'trips',
	{
		feedVersionId: bigint('feed_version_id', { mode: 'number' })
			.notNull()
			.references(() => feedVersions.id, { onDelete: 'cascade' }),
		tripId: text('trip_id').notNull(),
		routeId: text('route_id').notNull(),
		serviceId: text('service_id').notNull(),
		agencyId: text('agency_id').notNull().default(''),
		tripHeadsign: text('trip_headsign'),
		directionId: smallint('direction_id'),
		blockId: text('block_id'),
		shapeId: text('shape_id'),
		wheelchairAccessible: smallint('wheelchair_accessible'),
		routeDirection: text('route_direction')
	},
	(t) => [
		primaryKey({ columns: [t.feedVersionId, t.tripId] }),
		index('trips_route_idx').on(t.feedVersionId, t.routeId),
		index('trips_service_idx').on(t.feedVersionId, t.agencyId, t.serviceId),
		index('trips_shape_idx').on(t.feedVersionId, t.shapeId)
	]
);

export const stopTimes = pgTable(
	'stop_times',
	{
		feedVersionId: bigint('feed_version_id', { mode: 'number' })
			.notNull()
			.references(() => feedVersions.id, { onDelete: 'cascade' }),
		tripId: text('trip_id').notNull(),
		stopSequence: integer('stop_sequence').notNull(),
		stopId: text('stop_id').notNull(),
		arrivalS: integer('arrival_s'),
		departureS: integer('departure_s'),
		pickupType: smallint('pickup_type'),
		dropoffType: smallint('dropoff_type'),
		timepoint: smallint('timepoint'),
		shapeDistTraveled: doublePrecision('shape_dist_traveled')
	},
	(t) => [
		primaryKey({ columns: [t.feedVersionId, t.tripId, t.stopSequence] }),
		index('stop_times_stop_idx').on(t.feedVersionId, t.stopId)
	]
);

export const shapes = pgTable(
	'shapes',
	{
		feedVersionId: bigint('feed_version_id', { mode: 'number' })
			.notNull()
			.references(() => feedVersions.id, { onDelete: 'cascade' }),
		shapeId: text('shape_id').notNull(),
		seq: integer('seq').notNull(),
		lat: doublePrecision('lat').notNull(),
		lon: doublePrecision('lon').notNull(),
		dist: doublePrecision('dist'),
		geom: pointGeometry('geom').generatedAlwaysAs(
			sql`st_setsrid(st_makepoint(lon, lat), 4326)`
		)
	},
	(t) => [primaryKey({ columns: [t.feedVersionId, t.shapeId, t.seq] })]
);

export const shapeLines = pgTable(
	'shape_lines',
	{
		feedVersionId: bigint('feed_version_id', { mode: 'number' })
			.notNull()
			.references(() => feedVersions.id, { onDelete: 'cascade' }),
		shapeId: text('shape_id').notNull(),
		geom: lineGeometry('geom').notNull()
	},
	(t) => [
		primaryKey({ columns: [t.feedVersionId, t.shapeId] }),
		index('shape_lines_geom_idx').using('gist', t.geom)
	]
);

export const shapeRoutes = pgTable(
	'shape_routes',
	{
		feedVersionId: bigint('feed_version_id', { mode: 'number' })
			.notNull()
			.references(() => feedVersions.id, { onDelete: 'cascade' }),
		shapeId: text('shape_id').notNull(),
		routeId: text('route_id').notNull()
	},
	(t) => [primaryKey({ columns: [t.feedVersionId, t.shapeId, t.routeId] })]
);

export const calendar = pgTable(
	'calendar',
	{
		feedVersionId: bigint('feed_version_id', { mode: 'number' })
			.notNull()
			.references(() => feedVersions.id, { onDelete: 'cascade' }),
		agencyId: text('agency_id').notNull().default(''),
		serviceId: text('service_id').notNull(),
		monday: smallint('monday').notNull().default(0),
		tuesday: smallint('tuesday').notNull().default(0),
		wednesday: smallint('wednesday').notNull().default(0),
		thursday: smallint('thursday').notNull().default(0),
		friday: smallint('friday').notNull().default(0),
		saturday: smallint('saturday').notNull().default(0),
		sunday: smallint('sunday').notNull().default(0),
		startDate: date('start_date', { mode: 'string' }).notNull(),
		endDate: date('end_date', { mode: 'string' }).notNull()
	},
	(t) => [primaryKey({ columns: [t.feedVersionId, t.agencyId, t.serviceId] })]
);

export const calendarDates = pgTable(
	'calendar_dates',
	{
		feedVersionId: bigint('feed_version_id', { mode: 'number' })
			.notNull()
			.references(() => feedVersions.id, { onDelete: 'cascade' }),
		agencyId: text('agency_id').notNull().default(''),
		serviceId: text('service_id').notNull(),
		date: date('date', { mode: 'string' }).notNull(),
		exceptionType: smallint('exception_type').notNull()
	},
	(t) => [primaryKey({ columns: [t.feedVersionId, t.agencyId, t.serviceId, t.date] })]
);

export const serviceDates = pgTable(
	'service_dates',
	{
		feedVersionId: bigint('feed_version_id', { mode: 'number' })
			.notNull()
			.references(() => feedVersions.id, { onDelete: 'cascade' }),
		agencyId: text('agency_id').notNull().default(''),
		serviceId: text('service_id').notNull(),
		serviceDate: date('service_date', { mode: 'string' }).notNull()
	},
	(t) => [
		primaryKey({ columns: [t.feedVersionId, t.agencyId, t.serviceId, t.serviceDate] }),
		index('service_dates_date_idx').on(t.feedVersionId, t.serviceDate)
	]
);

export const liveVehicles = pgTable(
	'live_vehicles',
	{
		vehicleKey: text('vehicle_key').primaryKey(),
		entityId: text('entity_id'),
		vehicleId: text('vehicle_id'),
		tripId: text('trip_id'),
		serviceDate: date('service_date', { mode: 'string' }),
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
		observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
		feedTimestamp: timestamp('feed_timestamp', { withTimezone: true })
	},
	(t) => [index('live_vehicles_observed_idx').on(t.observedAt.desc())]
);

export const pollRuns = pgTable(
	'poll_runs',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),
		feed: text('feed').notNull(),
		startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
		finishedAt: timestamp('finished_at', { withTimezone: true }),
		httpStatus: integer('http_status'),
		entities: integer('entities'),
		bytes: integer('bytes'),
		error: text('error')
	},
	(t) => [index('poll_runs_feed_started_idx').on(t.feed, t.startedAt.desc())]
);


export const trafficLights = pgTable('traffic_lights', {
	equipmentId: text('equipment_id').primaryKey(),
	assetType: text('asset_type'),
	street1: text('street_1'),
	street2: text('street_2'),
	street3: text('street_3'),
	suburb: text('suburb'),
	rmsRegion: text('rms_region'),
	lat: doublePrecision('lat').notNull(),
	lon: doublePrecision('lon').notNull(),
	geom: pointGeometry('geom').generatedAlwaysAs(
		sql`st_setsrid(st_makepoint(lon, lat), 4326)`
	)
});
