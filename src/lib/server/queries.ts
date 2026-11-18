import { sql, type SQL } from 'drizzle-orm';
import type {
	BusCongestionProperties,
	HistoryBounds,
	PassedStopProperties,
	TrafficIncidentProperties,
	VehicleSnapshot
} from '#lib/types.js';
import type { FeatureCollection, Point } from 'geojson';
import { getDb, type Db } from './db';

export interface NetworkSummary {
	stops: number;
	routes: number;
	trips: number;
	liveVehicles: number;
	feedFetchedAt: string | null;
	lastPositionPoll: string | null;
	activeFeedId: number | null;
}

export interface SearchStop {
	stopId: string;
	stopName: string;
	lat: number;
	lon: number;
}

export interface RouteServing {
	routeId: string;
	shortName: string | null;
	longName: string | null;
	directionId: number | null;
	shapeId: string | null;
}

export interface NearbyStop {
	stopId: string;
	stopName: string;
	lat: number;
	lon: number;
	meters: number;
}

export interface StopDeparture {
	tripId: string;
	routeId: string;
	routeShortName: string | null;
	routeLongName: string | null;
	headsign: string | null;
	directionId: number | null;
	scheduledTime: string;
	minutesAway: number;
}

export interface StopDetails {
	stopId: string;
	stopName: string;
	lat: number;
	lon: number;
	routes: RouteServing[];
	nearby: NearbyStop[];
	timetable: StopDeparture[];
}

export type LiveVehicle = VehicleSnapshot;

export interface BusynessCell {
	dow: number;
	hour: number;
	events: number;
	samples: number;
	avgNet: number | null;
	avgBefore: number | null;
	avgAfter: number | null;
	avgBand: number | null;
}

export interface BusynessRoute {
	routeId: string | null;
	shortName: string | null;
	events: number;
	samples: number;
	avgNet: number | null;
	avgBefore: number | null;
	avgBand: number | null;
}

export interface BusynessStop {
	stopId: string;
	stopName: string;
	lat: number;
	lon: number;
	events: number;
	samples: number;
	avgNet: number | null;
	avgBefore: number | null;
	avgBand: number | null;
}

export interface FeedRow {
	id: number;
	source: string;
	fetchedAt: string;
	sha256: string;
	bytes: number | null;
	isActive: boolean;
}

export interface PollRow {
	feed: string;
	startedAt: string;
	finishedAt: string | null;
	httpStatus: number | null;
	entities: number | null;
	bytes: number | null;
	error: string | null;
}

export interface FeedHealth {
	feeds: FeedRow[];
	polls: PollRow[];
	sizes: {
		database: string;
		positions: string;
		observations: string;
		delays: string;
		partitions: number;
	};
}

export async function isDatabaseReady(): Promise<boolean> {
	try {
		await getDb().execute(sql`select 1`);
		return true;
	} catch {
		return false;
	}
}

export async function networkSummary(): Promise<NetworkSummary> {
	const db = getDb();
	const rows = await rawQuery<NetworkSummary>(db, sql`
		select
			(select count(*)::int from stops where feed_version_id = active_feed_version()) as "stops",
			(select count(*)::int from routes where feed_version_id = active_feed_version()) as "routes",
			(select count(*)::int from trips where feed_version_id = active_feed_version()) as "trips",
			(select count(*)::int from live_vehicles where observed_at > now() - interval '2 minutes') as "liveVehicles",
			(
				select to_char(max(fetched_at) at time zone 'Australia/Sydney', 'YYYY-MM-DD HH24:MI:SS')
				from feed_versions where is_active
			) as "feedFetchedAt",
			(
				select to_char(max(started_at) at time zone 'Australia/Sydney', 'YYYY-MM-DD HH24:MI:SS')
				from poll_runs where feed = 'vehicle_positions'
			) as "lastPositionPoll",
			active_feed_version()::int as "activeFeedId"
	`);

	return rows[0];
}

export async function searchStops(query: string, limit = 8): Promise<SearchStop[]> {
	const trimmed = query.trim();
	if (trimmed.length < 2) return [];

	const db = getDb();
	return rawQuery<SearchStop>(db, sql`
		select
			stop_id as "stopId",
			stop_name as "stopName",
			stop_lat as "lat",
			stop_lon as "lon"
		from stops
		where feed_version_id = active_feed_version()
			and stop_name ilike ${`%${trimmed}%`}
		order by
			word_similarity(${trimmed}, stop_name) desc,
			similarity(stop_name, ${trimmed}) desc,
			length(stop_name),
			stop_name
		limit ${limit}
	`);
}

export async function stopDetails(stopId: string): Promise<StopDetails | null> {
	const db = getDb();
	const rows = await rawQuery<{
		stopId: string;
		stopName: string;
		lat: number;
		lon: number;
		routes: RouteServing[];
	}>(db, sql`
		with me as (
			select *
			from stops
			where feed_version_id = active_feed_version() and stop_id = ${stopId}
		)
		select
			me.stop_id as "stopId",
			me.stop_name as "stopName",
			me.stop_lat as "lat",
			me.stop_lon as "lon",
			(
				select coalesce(
					json_agg(jsonb_build_object(
						'routeId', serving.route_id,
						'shortName', r.route_short_name,
						'longName', r.route_long_name,
						'directionId', serving.direction_id,
						'shapeId', serving.shape_id
					)),
					'[]'::json
				)
				from (
					select
						t.route_id,
						t.direction_id,
						min(t.shape_id) as shape_id
					from stop_times st
					join trips t
						on t.feed_version_id = st.feed_version_id and t.trip_id = st.trip_id
					where st.feed_version_id = me.feed_version_id and st.stop_id = me.stop_id
					group by t.route_id, t.direction_id
				) serving
				join routes r
					on r.feed_version_id = me.feed_version_id and r.route_id = serving.route_id
			) as "routes"
		from me
	`);

	const stop = rows[0];
	if (!stop) return null;

	const nearby = await rawQuery<NearbyStop>(db, sql`
		select
			s2.stop_id as "stopId",
			s2.stop_name as "stopName",
			s2.stop_lat as "lat",
			s2.stop_lon as "lon",
			round(st_distance(s1.geog, s2.geog)::numeric, 1)::float8 as "meters"
		from stops s1
		join stops s2
			on s2.feed_version_id = s1.feed_version_id and s2.stop_id <> s1.stop_id
		where s1.feed_version_id = active_feed_version()
			and s1.stop_id = ${stopId}
			and st_dwithin(s1.geog, s2.geog, 400)
		order by meters
		limit 20
	`);

	const timetable = await rawQuery<StopDeparture>(db, sql`
		with p as (
			select now() at time zone 'Australia/Sydney' as local_ts
		),
		today as (
			select
				t.trip_id as "tripId",
				t.route_id as "routeId",
				r.route_short_name as "routeShortName",
				r.route_long_name as "routeLongName",
				t.trip_headsign as "headsign",
				t.direction_id as "directionId",
				coalesce(st.departure_s, st.arrival_s) as actual_s
			from p
			join service_dates sd
				on sd.feed_version_id = active_feed_version()
				and sd.service_date = p.local_ts::date
			join trips t
				on t.feed_version_id = sd.feed_version_id
				and t.agency_id = sd.agency_id
				and t.service_id = sd.service_id
			join stop_times st
				on st.feed_version_id = t.feed_version_id
				and st.trip_id = t.trip_id
				and st.stop_id = ${stopId}
			join routes r
				on r.feed_version_id = t.feed_version_id and r.route_id = t.route_id
			where coalesce(st.departure_s, st.arrival_s)
				>= extract(epoch from p.local_ts::time) - 60
		),
		overnight as (
			select
				t.trip_id as "tripId",
				t.route_id as "routeId",
				r.route_short_name as "routeShortName",
				r.route_long_name as "routeLongName",
				t.trip_headsign as "headsign",
				t.direction_id as "directionId",
				coalesce(st.departure_s, st.arrival_s) - 86400 as actual_s
			from p
			join service_dates sd
				on sd.feed_version_id = active_feed_version()
				and sd.service_date = p.local_ts::date - 1
			join trips t
				on t.feed_version_id = sd.feed_version_id
				and t.agency_id = sd.agency_id
				and t.service_id = sd.service_id
			join stop_times st
				on st.feed_version_id = t.feed_version_id
				and st.trip_id = t.trip_id
				and st.stop_id = ${stopId}
			join routes r
				on r.feed_version_id = t.feed_version_id and r.route_id = t.route_id
			where coalesce(st.departure_s, st.arrival_s) >= 86400
		)
		select
			"tripId",
			"routeId",
			"routeShortName",
			"routeLongName",
			"headsign",
			"directionId",
			to_char(make_interval(secs => (actual_s % 86400)::int), 'HH24:MI') as "scheduledTime",
			greatest(
				0,
				ceil((actual_s - extract(epoch from p.local_ts::time)) / 60)
			)::int as "minutesAway"
		from (select * from today union all select * from overnight) departures, p
		where actual_s >= extract(epoch from p.local_ts::time) - 60
		order by actual_s
		limit 12
	`);

	return { ...stop, nearby, timetable };
}

function isoString(value: Date | string): string {
	if (value instanceof Date) return value.toISOString();
	const normalized = (value.includes('T') ? value : value.replace(' ', 'T')).replace(
		/([+-]\d{2})$/,
		'$1:00'
	);
	const parsed = new Date(normalized);
	return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

export async function liveSnapshot(): Promise<LiveVehicle[]> {
	const db = getDb();
	const rows = await rawQuery<LiveVehicle>(db, sql`
		select
			lv.vehicle_key as "vehicleKey",
			lv.vehicle_id as "vehicleId",
			lv.trip_id as "tripId",
			lv.route_id as "routeId",
			lv.lat,
			lv.lon,
			lv.bearing,
			lv.speed_mps as "speedMps",
			lv.current_status as "currentStatus",
			lv.occupancy,
			lv.observed_at as "observedAt",
			vehicle_delay(lv.trip_id, lv.service_date, lv.observed_at) as "delayS"
		from live_vehicles lv
		where lv.observed_at > now() - interval '2 minutes'
		order by lv.vehicle_key
	`);

	return rows.map((row) => ({ ...row, observedAt: isoString(row.observedAt) }));
}

export async function feedHealth(): Promise<FeedHealth> {
	const db = getDb();

	const feeds = await rawQuery<FeedRow>(db, sql`
		select
			id,
			source,
			to_char(fetched_at at time zone 'Australia/Sydney', 'YYYY-MM-DD HH24:MI:SS') as "fetchedAt",
			sha256,
			bytes,
			is_active as "isActive"
		from feed_versions
		order by fetched_at desc
		limit 5
	`);

	const polls = await rawQuery<PollRow>(db, sql`
		select
			feed,
			to_char(started_at at time zone 'Australia/Sydney', 'YYYY-MM-DD HH24:MI:SS') as "startedAt",
			to_char(finished_at at time zone 'Australia/Sydney', 'YYYY-MM-DD HH24:MI:SS') as "finishedAt",
			http_status as "httpStatus",
			entities,
			bytes,
			error
		from poll_runs
		order by started_at desc
		limit 20
	`);

	const sizes = await rawQuery<FeedHealth['sizes']>(db, sql`
		select
			pg_size_pretty(pg_database_size(current_database())) as "database",
			(
				select pg_size_pretty(coalesce(sum(pg_total_relation_size(c.oid)), 0)::bigint)
				from pg_inherits i
				join pg_class c on c.oid = i.inhrelid
				join pg_class p on p.oid = i.inhparent
				where p.relname = 'vehicle_positions'
			) as "positions",
			(
				select pg_size_pretty(coalesce(sum(pg_total_relation_size(c.oid)), 0)::bigint)
				from pg_inherits i
				join pg_class c on c.oid = i.inhrelid
				join pg_class p on p.oid = i.inhparent
				where p.relname = 'trip_observations'
			) as "observations",
			(
				select pg_size_pretty(coalesce(sum(pg_total_relation_size(c.oid)), 0)::bigint)
				from pg_inherits i
				join pg_class c on c.oid = i.inhrelid
				join pg_class p on p.oid = i.inhparent
				where p.relname = 'trip_delays'
			) as "delays",
			(
				select count(*)::int
				from pg_inherits i
				join pg_class p on p.oid = i.inhparent
				where p.relname = 'vehicle_positions'
			) as "partitions"
	`);

	return { feeds, polls, sizes: sizes[0] };
}


async function rawQuery<T>(db: Db, statement: SQL): Promise<T[]> {
	return (await db.execute(statement)) as unknown as T[];
}


export async function historyBounds(): Promise<HistoryBounds> {
	const db = getDb();
	const rows = await rawQuery<{ min: Date | null; max: Date | null }>(
		db,
		sql`select min(observed_at) as "min", max(observed_at) as "max" from vehicle_positions`
	);
	const row = rows[0];
	const iso = (value: Date | string | null | undefined) =>
		value === null || value === undefined ? null : isoString(value);

	return { min: iso(row?.min), max: iso(row?.max) };
}

export async function snapshotAt(at: Date): Promise<VehicleSnapshot[]> {
	const db = getDb();
	const from = new Date(at.getTime() - 120_000);
	const toIso = at.toISOString();
	const fromIso = from.toISOString();
	const rows = await rawQuery<VehicleSnapshot>(
		db,
		sql`
			with pos as (
				select distinct on (vehicle_key)
					vehicle_key,
					vehicle_id,
					trip_id,
					route_id,
					service_date,
					lat,
					lon,
					bearing,
					speed_mps,
					current_status,
					occupancy,
					observed_at
				from vehicle_positions
				where observed_at <= ${toIso}::timestamptz
					and observed_at > ${fromIso}::timestamptz
				order by vehicle_key, observed_at desc
			)
			select
				vehicle_key as "vehicleKey",
				vehicle_id as "vehicleId",
				trip_id as "tripId",
				route_id as "routeId",
				lat,
				lon,
				bearing,
				speed_mps as "speedMps",
				current_status as "currentStatus",
				occupancy,
				observed_at as "observedAt",
				vehicle_delay(trip_id, service_date, observed_at) as "delayS"
			from pos
			order by vehicle_key
		`
	);

	return rows.map((row) => ({ ...row, observedAt: isoString(row.observedAt) }));
}


export async function stopBusyness(
	stopId: string
): Promise<{ cells: BusynessCell[]; routes: BusynessRoute[] }> {
	const db = getDb();

	const cells = await rawQuery<BusynessCell>(
		db,
		sql`
			select
				dow,
				hour,
				count(*)::int as "events",
				count(*) filter (where net_load is not null)::int as "samples",
				avg(net_load)::float8 as "avgNet",
				avg(before_load)::float8 as "avgBefore",
				avg(after_load)::float8 as "avgAfter",
				avg(band_change)::float8 as "avgBand"
			from stop_boarding_events
			where stop_id = ${stopId}
			group by dow, hour
			order by dow, hour
		`
	);

	const routes = await rawQuery<BusynessRoute>(
		db,
		sql`
			select
				e.route_id as "routeId",
				r.route_short_name as "shortName",
				count(*)::int as "events",
				count(*) filter (where e.net_load is not null)::int as "samples",
				avg(e.net_load)::float8 as "avgNet",
				avg(e.before_load)::float8 as "avgBefore",
				avg(e.band_change)::float8 as "avgBand"
			from stop_boarding_events e
			left join routes r
				on r.feed_version_id = active_feed_version() and r.route_id = e.route_id
			where e.stop_id = ${stopId}
			group by e.route_id, r.route_short_name
			order by "samples" desc, "events" desc
			limit 30
		`
	);

	return { cells, routes };
}

export async function busynessHeatmap(dow: number, hour: number): Promise<BusynessStop[]> {
	const db = getDb();
	return rawQuery<BusynessStop>(
		db,
		sql`
			select
				s.stop_id as "stopId",
				s.stop_name as "stopName",
				s.stop_lat as "lat",
				s.stop_lon as "lon",
				count(*)::int as "events",
				count(*) filter (where e.net_load is not null)::int as "samples",
				avg(e.net_load)::float8 as "avgNet",
				avg(e.before_load)::float8 as "avgBefore",
				avg(e.band_change)::float8 as "avgBand"
			from stop_boarding_events e
			join stops s
				on s.feed_version_id = active_feed_version() and s.stop_id = e.stop_id
			where e.dow = ${dow} and e.hour = ${hour}
			group by s.stop_id, s.stop_name, s.stop_lat, s.stop_lon
			order by "samples" desc
		`
	);
}


export interface RouteShapeBounds {
	shapeId: string;
	bounds: [[number, number], [number, number]];
}

export async function routeShapeBounds(shapeId: string): Promise<RouteShapeBounds | null> {
	const db = getDb();
	const rows = await rawQuery<{
		shapeId: string;
		west: number | null;
		south: number | null;
		east: number | null;
		north: number | null;
	}>(
		db,
		sql`
			with line as (
				select *
				from shape_lines
				where feed_version_id = active_feed_version() and shape_id = ${shapeId}
			),
			bounds as (
				select st_extent(geom) as extent from line
			)
			select
				l.shape_id as "shapeId",
				st_xmin(b.extent) as "west",
				st_ymin(b.extent) as "south",
				st_xmax(b.extent) as "east",
				st_ymax(b.extent) as "north"
			from line l, bounds b
		`
	);

	const row = rows[0];
	if (
		!row ||
		row.west === null ||
		row.south === null ||
		row.east === null ||
		row.north === null
	) {
		return null;
	}

	return {
		shapeId: row.shapeId,
		bounds: [
			[row.west, row.south],
			[row.east, row.north]
		]
	};
}


export interface FilterSuburb {
	name: string;
	stops: number;
}

export interface FilterRouteType {
	routeType: number;
	routes: number;
}

export interface FilterRoute {
	routeId: string;
	shortName: string | null;
	longName: string | null;
}

export interface FilterResult {
	stopIds: string[] | null;
	routeIds: string[] | null;
	stopCount: number;
	routeCount: number;
	bounds: [[number, number], [number, number]] | null;
}

export async function searchSuburbs(query: string, limit = 20): Promise<FilterSuburb[]> {
	const db = getDb();
	const trimmed = query.trim();
	return rawQuery<FilterSuburb>(
		db,
		sql`
			select
				ss.suburb_name as "name",
				count(*)::int as "stops"
			from stop_suburbs ss
			join stops s
				on s.feed_version_id = active_feed_version() and s.stop_id = ss.stop_id
			where ss.suburb_name is not null
				and (${trimmed} = '' or ss.suburb_name ilike ${`%${trimmed}%`})
			group by ss.suburb_name
			order by ss.suburb_name
			limit ${limit}
		`
	);
}

export async function routeTypeCounts(): Promise<FilterRouteType[]> {
	const db = getDb();
	return rawQuery<FilterRouteType>(
		db,
		sql`
			select
				route_type as "routeType",
				count(*)::int as "routes"
			from routes
			where feed_version_id = active_feed_version()
				and route_type is not null
			group by route_type
			order by count(*) desc
		`
	);
}

export async function searchRoutes(query: string, limit = 20): Promise<FilterRoute[]> {
	const db = getDb();
	const trimmed = query.trim();
	return rawQuery<FilterRoute>(
		db,
		sql`
			select
				route_id as "routeId",
				route_short_name as "shortName",
				route_long_name as "longName"
			from routes
			where feed_version_id = active_feed_version()
				and (
					${trimmed} = ''
					or coalesce(route_short_name, '') ilike ${`%${trimmed}%`}
					or coalesce(route_long_name, '') ilike ${`%${trimmed}%`}
				)
			order by route_short_name, route_long_name
			limit ${limit}
		`
	);
}

function sqlInNumbers(values: number[]): SQL {
	return sql.join(
		values.map((value) => sql`${value}`),
		sql`, `
	);
}

function sqlIn(values: string[]): SQL {
	return sql.join(
		values.map((value) => sql`${value}`),
		sql`, `
	);
}

async function activeRouteIds(at: Date): Promise<string[]> {
	const db = getDb();
	const atIso = at.toISOString();
	const rows = await rawQuery<{ routeId: string }>(
		db,
		sql`
			with p as (
				select ${atIso}::timestamptz at time zone 'Australia/Sydney' as local_ts
			)
			select distinct t.route_id as "routeId"
			from p
			join service_dates sd
				on sd.feed_version_id = active_feed_version()
				and sd.service_date in (p.local_ts::date, p.local_ts::date - 1)
			join trips t
				on t.feed_version_id = sd.feed_version_id
				and t.agency_id = sd.agency_id
				and t.service_id = sd.service_id
			join trip_times tt
				on tt.feed_version_id = t.feed_version_id and tt.trip_id = t.trip_id
			where (
				sd.service_date = p.local_ts::date
				and tt.first_departure_s <= extract(epoch from p.local_ts::time) + 300
				and tt.last_arrival_s >= extract(epoch from p.local_ts::time) - 300
			) or (
				sd.service_date = p.local_ts::date - 1
				and tt.first_departure_s <= extract(epoch from p.local_ts::time) + 86400 + 300
				and tt.last_arrival_s >= extract(epoch from p.local_ts::time) + 86400 - 300
			)
		`
	);
	return rows.map((row) => row.routeId);
}

async function routesForTypes(types: number[]): Promise<string[]> {
	const db = getDb();
	const rows = await rawQuery<{ routeId: string }>(
		db,
		sql`
			select route_id as "routeId"
			from routes
			where feed_version_id = active_feed_version()
				and route_type in (${sqlInNumbers(types)})
		`
	);
	return rows.map((row) => row.routeId);
}

async function routesForSuburbs(suburbs: string[]): Promise<string[]> {
	const db = getDb();
	const rows = await rawQuery<{ routeId: string }>(
		db,
		sql`
			select distinct t.route_id as "routeId"
			from stop_suburbs ss
			join stop_times st
				on st.feed_version_id = active_feed_version() and st.stop_id = ss.stop_id
			join trips t
				on t.feed_version_id = st.feed_version_id and t.trip_id = st.trip_id
			where ss.suburb_name in (${sqlIn(suburbs)})
		`
	);
	return rows.map((row) => row.routeId);
}

async function boundsForStops(stopIds: string[]): Promise<[[number, number], [number, number]] | null> {
	const db = getDb();
	const rows = await rawQuery<{
		west: number;
		south: number;
		east: number;
		north: number;
	}>(
		db,
		sql`
			select
				st_xmin(st_extent(geom)) as "west",
				st_ymin(st_extent(geom)) as "south",
				st_xmax(st_extent(geom)) as "east",
				st_ymax(st_extent(geom)) as "north"
			from stops
			where feed_version_id = active_feed_version()
				and stop_id in (${sqlIn(stopIds)})
		`
	);
	const row = rows[0];
	return row ? [[row.west, row.south], [row.east, row.north]] : null;
}

async function boundsForRoutes(routeIds: string[]): Promise<[[number, number], [number, number]] | null> {
	const db = getDb();
	const rows = await rawQuery<{
		west: number;
		south: number;
		east: number;
		north: number;
	}>(
		db,
		sql`
			select
				st_xmin(st_extent(l.geom)) as "west",
				st_ymin(st_extent(l.geom)) as "south",
				st_xmax(st_extent(l.geom)) as "east",
				st_ymax(st_extent(l.geom)) as "north"
			from shape_lines l
			join shape_routes sr
				on sr.feed_version_id = l.feed_version_id and sr.shape_id = l.shape_id
			where l.feed_version_id = active_feed_version()
				and sr.route_id in (${sqlIn(routeIds)})
		`
	);
	const row = rows[0];
	return row ? [[row.west, row.south], [row.east, row.north]] : null;
}

async function countActiveStops(): Promise<number> {
	const db = getDb();
	const rows = await rawQuery<{ count: number }>(
		db,
		sql`select count(*)::int as "count" from stops where feed_version_id = active_feed_version()`
	);
	return rows[0]?.count ?? 0;
}

async function countActiveRoutes(): Promise<number> {
	const db = getDb();
	const rows = await rawQuery<{ count: number }>(
		db,
		sql`select count(*)::int as "count" from routes where feed_version_id = active_feed_version()`
	);
	return rows[0]?.count ?? 0;
}

export async function applyFilters(input: {
	suburbs: string[];
	routeIds: string[];
	routeTypes: number[];
	active: boolean;
	at: Date;
}): Promise<FilterResult> {
	const db = getDb();
	const activeIds = input.active ? await activeRouteIds(input.at) : null;

	let routeIds: string[] | null = null;
	if (activeIds !== null && input.routeIds.length > 0) {
		const selected = new Set(input.routeIds);
		routeIds = activeIds.filter((id) => selected.has(id));
	} else if (activeIds !== null) {
		routeIds = activeIds;
	} else if (input.routeIds.length > 0) {
		routeIds = input.routeIds;
	}

	if (input.routeTypes.length > 0) {
		const typeRoutes = await routesForTypes(input.routeTypes);
		if (routeIds === null) {
			routeIds = typeRoutes;
		} else {
			const allowed = new Set(typeRoutes);
			routeIds = routeIds.filter((id) => allowed.has(id));
		}
	}

	if (input.suburbs.length > 0) {
		const suburbRoutes = await routesForSuburbs(input.suburbs);
		if (routeIds === null) {
			routeIds = suburbRoutes;
		} else {
			const allowed = new Set(suburbRoutes);
			routeIds = routeIds.filter((id) => allowed.has(id));
		}
	}

	let stopIds: string[] | null = null;
	if (input.suburbs.length > 0) {
		if (routeIds !== null && routeIds.length === 0) {
			stopIds = [];
		} else if (routeIds !== null) {
			const rows = await rawQuery<{ stopId: string }>(
				db,
				sql`
					select distinct ss.stop_id as "stopId"
					from stop_suburbs ss
					join stops s
						on s.feed_version_id = active_feed_version() and s.stop_id = ss.stop_id
					join stop_times st
						on st.feed_version_id = active_feed_version() and st.stop_id = ss.stop_id
					join trips t
						on t.feed_version_id = st.feed_version_id and t.trip_id = st.trip_id
					where ss.suburb_name in (${sqlIn(input.suburbs)})
						and t.route_id in (${sqlIn(routeIds)})
				`
			);
			stopIds = rows.map((row) => row.stopId);
		} else {
			const rows = await rawQuery<{ stopId: string }>(
				db,
				sql`
					select ss.stop_id as "stopId"
					from stop_suburbs ss
					join stops s
						on s.feed_version_id = active_feed_version() and s.stop_id = ss.stop_id
					where ss.suburb_name in (${sqlIn(input.suburbs)})
				`
			);
			stopIds = rows.map((row) => row.stopId);
		}
	}

	if (stopIds === null && routeIds !== null && routeIds.length > 0 && routeIds.length <= 20) {
		const rows = await rawQuery<{ stopId: string }>(
			db,
			sql`
				select distinct st.stop_id as "stopId"
				from stop_times st
				join trips t
					on t.feed_version_id = st.feed_version_id and t.trip_id = st.trip_id
				where st.feed_version_id = active_feed_version()
					and t.route_id in (${sqlIn(routeIds)})
			`
		);
		stopIds = rows.map((row) => row.stopId);
	}

	const stopCount = stopIds !== null ? stopIds.length : await countActiveStops();
	const routeCount = routeIds !== null ? routeIds.length : await countActiveRoutes();

	let bounds: [[number, number], [number, number]] | null = null;
	if (stopIds !== null && stopIds.length > 0) {
		bounds = await boundsForStops(stopIds);
	} else if (routeIds !== null && routeIds.length > 0 && routeIds.length <= 500) {
		bounds = await boundsForRoutes(routeIds);
	}

	return { stopIds, routeIds, stopCount, routeCount, bounds };
}


export async function trafficIncidentFeatures(): Promise<
	FeatureCollection<Point, TrafficIncidentProperties>
> {
	const db = getDb();
	const rows = await rawQuery<{
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
		startsAt: Date | string | null;
		endsAt: Date | string | null;
		updatedAt: Date | string | null;
		lat: number;
		lon: number;
	}>(
		db,
		sql`
			select
				id,
				source,
				category,
				kind,
				headline,
				display_name as "displayName",
				roads,
				suburbs,
				advice,
				expected_delay as "expectedDelay",
				is_major as "isMajor",
				impacting_network as "impactingNetwork",
				public_transport as "publicTransport",
				starts_at as "startsAt",
				ends_at as "endsAt",
				updated_at as "updatedAt",
				lat,
				lon
			from traffic_incidents
			where lat is not null and lon is not null
			order by is_major desc, source, id
		`
	);

	return {
		type: 'FeatureCollection',
		features: rows.map((row) => ({
			type: 'Feature',
			id: row.id,
			geometry: { type: 'Point', coordinates: [row.lon, row.lat] },
			properties: {
				id: row.id,
				source: row.source,
				category: row.category,
				kind: row.kind,
				headline: row.headline,
				displayName: row.displayName,
				roads: row.roads,
				suburbs: row.suburbs,
				advice: row.advice,
				expectedDelay: row.expectedDelay,
				isMajor: row.isMajor,
				impactingNetwork: row.impactingNetwork,
				publicTransport: row.publicTransport,
				startsAt: row.startsAt === null ? null : isoString(row.startsAt),
				endsAt: row.endsAt === null ? null : isoString(row.endsAt),
				updatedAt: row.updatedAt === null ? null : isoString(row.updatedAt)
			}
		}))
	};
}

export async function busCongestionFeatures(): Promise<
	FeatureCollection<Point, BusCongestionProperties>
> {
	const db = getDb();
	const rows = await rawQuery<{
		lat: number;
		lon: number;
		avgSpeedMps: number;
		samples: number;
	}>(
		db,
		sql`
			select
				round(lat / 0.005) * 0.005 as "lat",
				round(lon / 0.005) * 0.005 as "lon",
				avg(speed_mps)::float8 as "avgSpeedMps",
				count(*)::int as "samples"
			from vehicle_positions
			where observed_at > now() - interval '10 minutes'
				and speed_mps is not null
				and speed_mps > 0.5
			group by 1, 2
			having count(*) >= 3
		`
	);

	return {
		type: 'FeatureCollection',
		features: rows.map((row) => {
			const speedKmh = row.avgSpeedMps * 3.6;
			const level = speedKmh >= 25 ? 1 : speedKmh >= 15 ? 2 : speedKmh >= 8 ? 3 : 4;
			return {
				type: 'Feature',
				geometry: { type: 'Point', coordinates: [row.lon, row.lat] },
				properties: {
					avgSpeedMps: row.avgSpeedMps,
					speedKmh,
					samples: row.samples,
					level
				}
			};
		})
	};
}


export async function routePassedStops(
	shapeId: string
): Promise<FeatureCollection<Point, PassedStopProperties>> {
	const db = getDb();
	const rows = await rawQuery<{
		stopId: string;
		stopName: string;
		lat: number;
		lon: number;
		meters: number;
	}>(
		db,
		sql`
			with served as (
				select distinct st.stop_id
				from stop_times st
				join trips t
					on t.feed_version_id = st.feed_version_id and t.trip_id = st.trip_id
				where t.feed_version_id = active_feed_version()
					and t.shape_id = ${shapeId}
			)
			select
				s.stop_id as "stopId",
				s.stop_name as "stopName",
				s.stop_lat as "lat",
				s.stop_lon as "lon",
				round(st_distance(s.geog, l.geom::geography)::numeric, 1)::float8 as "meters"
			from shape_lines l
			join stops s
				on s.feed_version_id = active_feed_version()
				and st_dwithin(s.geog, l.geom::geography, 30)
			where l.feed_version_id = active_feed_version()
				and l.shape_id = ${shapeId}
				and not exists (
					select 1 from served where served.stop_id = s.stop_id
				)
			order by s.stop_id
		`
	);

	return {
		type: 'FeatureCollection',
		features: rows.map((row) => ({
			type: 'Feature',
			id: row.stopId,
			geometry: { type: 'Point', coordinates: [row.lon, row.lat] },
			properties: {
				stopId: row.stopId,
				stopName: row.stopName,
				meters: row.meters
			}
		}))
	};
}
