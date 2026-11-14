import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { desc, eq } from 'drizzle-orm';
import { feedVersions } from '../src/lib/server/db/schema';
import { createDb } from './lib/db';
import {
	copyRows,
	download,
	extractGtfs,
	floatOrNull,
	intOrNull,
	parseGtfsDate,
	parseTimeSeconds,
	readCsv,
	textOrNull
} from './lib/gtfs';

function arg(name: string): string | undefined {
	const index = process.argv.indexOf(`--${name}`);
	if (index === -1) return undefined;
	const value = process.argv[index + 1];
	return value && !value.startsWith('--') ? value : '';
}

function hasFlag(name: string): boolean {
	return process.argv.includes(`--${name}`);
}

const { db, client: sql } = createDb({ max: 2 });
let feedId: number | undefined;

try {
	const localFile = arg('file');
	const url = arg('url') ?? process.env.GTFS_BUS_URL;
	const apiKey = process.env.TFNSW_API_KEY ?? '';
	const force = hasFlag('force');
	const activate = !hasFlag('no-activate');

	if (!localFile && !url) throw new Error('Set GTFS_BUS_URL or pass --url.');
	if (!localFile && !apiKey) {
		throw new Error('TFNSW_API_KEY is not set. Add it to .env or pass a local --file.');
	}

	await mkdir('.data/gtfs', { recursive: true });

	let zipPath: string;
	let source: string;
	let meta: { bytes: number; sha256: string };

	if (localFile) {
		zipPath = localFile;
		source = `file:${basename(localFile)}`;
		const buffer = await readFile(localFile);
		meta = {
			bytes: buffer.byteLength,
			sha256: createHash('sha256').update(buffer).digest('hex')
		};
	} else {
		zipPath = join('.data/gtfs', `buses-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`);
		source = url!;
		meta = await download(url!, apiKey, zipPath);
	}

	const existing = await db
		.select({ id: feedVersions.id })
		.from(feedVersions)
		.where(eq(feedVersions.sha256, meta.sha256))
		.orderBy(desc(feedVersions.fetchedAt))
		.limit(1);

	if (existing.length > 0 && !force) {
		console.log(
			`feed ${meta.sha256.slice(0, 12)} already imported as ${existing[0].id}; use --force to re-import`
		);
		process.exit(0);
	}

	const extractDir = join('.data/gtfs', `extract-${meta.sha256.slice(0, 12)}`);
	await mkdir(extractDir, { recursive: true });
	const extracted = await extractGtfs(zipPath, extractDir);
	const byName = new Map(extracted.map((name) => [name.toLowerCase(), join(extractDir, name)]));
	const pathFor = (name: string) => {
		const path = byName.get(name.toLowerCase());
		if (!path) throw new Error(`GTFS archive is missing ${name}`);
		return path;
	};

	console.log(`importing ${source} (${(meta.bytes / 1_048_576).toFixed(1)} MB)`);
	const [feed] = await db
		.insert(feedVersions)
		.values({
			source,
			sha256: meta.sha256,
			bytes: meta.bytes,
			notes: `archive: ${basename(zipPath)}`
		})
		.returning({ id: feedVersions.id });
	feedId = feed.id;

	const started = Date.now();

	await sql.begin(async (tx) => {
		console.log('  agencies');
		await copyRows(
			tx,
			'agencies',
			['feed_version_id', 'agency_id', 'agency_name', 'agency_url', 'agency_timezone', 'agency_lang', 'agency_phone'],
			(async function* () {
				for await (const row of readCsv(pathFor('agency.txt'))) {
					yield [
						feedId,
						row.agency_id,
						textOrNull(row.agency_name),
						textOrNull(row.agency_url),
						textOrNull(row.agency_timezone),
						textOrNull(row.agency_lang),
						textOrNull(row.agency_phone)
					];
				}
			})()
		);

		console.log('  routes');
		await copyRows(
			tx,
			'routes',
			[
				'feed_version_id',
				'route_id',
				'agency_id',
				'route_short_name',
				'route_long_name',
				'route_desc',
				'route_type',
				'route_color',
				'route_text_color',
				'route_sort_order'
			],
			(async function* () {
				for await (const row of readCsv(pathFor('routes.txt'))) {
					yield [
						feedId,
						row.route_id,
						row.agency_id ?? '',
						textOrNull(row.route_short_name),
						textOrNull(row.route_long_name),
						textOrNull(row.route_desc),
						intOrNull(row.route_type),
						textOrNull(row.route_color),
						textOrNull(row.route_text_color),
						intOrNull(row.route_sort_order)
					];
				}
			})()
		);

		console.log('  stops');
		await copyRows(
			tx,
			'stops',
			[
				'feed_version_id',
				'stop_id',
				'stop_name',
				'stop_lat',
				'stop_lon',
				'location_type',
				'parent_station',
				'wheelchair_boarding',
				'platform_code'
			],
			(async function* () {
				for await (const row of readCsv(pathFor('stops.txt'))) {
					const lat = floatOrNull(row.stop_lat);
					const lon = floatOrNull(row.stop_lon);
					if (lat === null || lon === null) continue;
					yield [
						feedId,
						row.stop_id,
						textOrNull(row.stop_name) ?? row.stop_id,
						lat,
						lon,
						intOrNull(row.location_type),
						textOrNull(row.parent_station),
						intOrNull(row.wheelchair_boarding),
						textOrNull(row.platform_code)
					];
				}
			})()
		);

		console.log('  trips');
		await copyRows(
			tx,
			'trips',
			[
				'feed_version_id',
				'trip_id',
				'route_id',
				'service_id',
				'trip_headsign',
				'direction_id',
				'block_id',
				'shape_id',
				'wheelchair_accessible',
				'route_direction'
			],
			(async function* () {
				for await (const row of readCsv(pathFor('trips.txt'))) {
					yield [
						feedId,
						row.trip_id,
						row.route_id,
						row.service_id,
						textOrNull(row.trip_headsign),
						intOrNull(row.direction_id),
						textOrNull(row.block_id),
						textOrNull(row.shape_id),
						intOrNull(row.wheelchair_accessible),
						textOrNull(row.route_direction)
					];
				}
			})()
		);

		await tx`
			update trips t
			set agency_id = r.agency_id
			from routes r
			where t.feed_version_id = ${feedId}
				and r.feed_version_id = ${feedId}
				and r.route_id = t.route_id
		`;

		console.log('  stop_times');
		await copyRows(
			tx,
			'stop_times',
			[
				'feed_version_id',
				'trip_id',
				'stop_sequence',
				'stop_id',
				'arrival_s',
				'departure_s',
				'pickup_type',
				'dropoff_type',
				'timepoint',
				'shape_dist_traveled'
			],
			(async function* () {
				for await (const row of readCsv(pathFor('stop_times.txt'))) {
					const sequence = intOrNull(row.stop_sequence);
					if (sequence === null || !row.stop_id) continue;
					yield [
						feedId,
						row.trip_id,
						sequence,
						row.stop_id,
						parseTimeSeconds(row.arrival_time),
						parseTimeSeconds(row.departure_time),
						intOrNull(row.pickup_type),
						intOrNull(row.drop_off_type ?? row.dropoff_type),
						intOrNull(row.timepoint),
						floatOrNull(row.shape_dist_traveled)
					];
				}
			})()
		);

		console.log('  shapes');
		await copyRows(
			tx,
			'shapes',
			['feed_version_id', 'shape_id', 'seq', 'lat', 'lon', 'dist'],
			(async function* () {
				for await (const row of readCsv(pathFor('shapes.txt'))) {
					const seq = intOrNull(row.shape_pt_sequence);
					const lat = floatOrNull(row.shape_pt_lat);
					const lon = floatOrNull(row.shape_pt_lon);
					if (seq === null || lat === null || lon === null) continue;
					yield [feedId, row.shape_id, seq, lat, lon, floatOrNull(row.shape_dist_traveled)];
				}
			})()
		);

		console.log('  calendar');
		await tx`
			create temp table stg_calendar (
				service_id text not null,
				monday smallint,
				tuesday smallint,
				wednesday smallint,
				thursday smallint,
				friday smallint,
				saturday smallint,
				sunday smallint,
				start_date date not null,
				end_date date not null
			) on commit drop
		`;
		await copyRows(
			tx,
			'stg_calendar',
			['service_id', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'start_date', 'end_date'],
			(async function* () {
				for await (const row of readCsv(pathFor('calendar.txt'))) {
					const start = parseGtfsDate(row.start_date);
					const end = parseGtfsDate(row.end_date);
					if (!start || !end) continue;
					yield [
						row.service_id,
						intOrNull(row.monday),
						intOrNull(row.tuesday),
						intOrNull(row.wednesday),
						intOrNull(row.thursday),
						intOrNull(row.friday),
						intOrNull(row.saturday),
						intOrNull(row.sunday),
						start,
						end
					];
				}
			})()
		);

		await tx`
			insert into calendar (
				feed_version_id, agency_id, service_id,
				monday, tuesday, wednesday, thursday, friday, saturday, sunday,
				start_date, end_date
			)
			select
				${feedId}, sa.agency_id, c.service_id,
				coalesce(c.monday, 0), coalesce(c.tuesday, 0), coalesce(c.wednesday, 0),
				coalesce(c.thursday, 0), coalesce(c.friday, 0), coalesce(c.saturday, 0),
				coalesce(c.sunday, 0), c.start_date, c.end_date
			from stg_calendar c
			join (
				select distinct agency_id, service_id
				from trips
				where feed_version_id = ${feedId}
			) sa using (service_id)
		`;

		await tx`
			insert into calendar (
				feed_version_id, agency_id, service_id,
				monday, tuesday, wednesday, thursday, friday, saturday, sunday,
				start_date, end_date
			)
			select
				${feedId}, '', c.service_id,
				coalesce(c.monday, 0), coalesce(c.tuesday, 0), coalesce(c.wednesday, 0),
				coalesce(c.thursday, 0), coalesce(c.friday, 0), coalesce(c.saturday, 0),
				coalesce(c.sunday, 0), c.start_date, c.end_date
			from stg_calendar c
			where not exists (
				select 1 from trips t
				where t.feed_version_id = ${feedId} and t.service_id = c.service_id
			)
		`;

		console.log('  calendar_dates');
		await tx`
			create temp table stg_calendar_dates (
				service_id text not null,
				date date not null,
				exception_type smallint not null
			) on commit drop
		`;
		await copyRows(
			tx,
			'stg_calendar_dates',
			['service_id', 'date', 'exception_type'],
			(async function* () {
				for await (const row of readCsv(pathFor('calendar_dates.txt'))) {
					const date = parseGtfsDate(row.date);
					const exceptionType = intOrNull(row.exception_type);
					if (!date || exceptionType === null) continue;
					yield [row.service_id, date, exceptionType];
				}
			})()
		);

		await tx`
			insert into calendar_dates (feed_version_id, agency_id, service_id, date, exception_type)
			select ${feedId}, sa.agency_id, c.service_id, c.date, c.exception_type
			from stg_calendar_dates c
			join (
				select distinct agency_id, service_id
				from trips
				where feed_version_id = ${feedId}
			) sa using (service_id)
		`;

		await tx`
			insert into calendar_dates (feed_version_id, agency_id, service_id, date, exception_type)
			select ${feedId}, '', c.service_id, c.date, c.exception_type
			from stg_calendar_dates c
			where not exists (
				select 1 from trips t
				where t.feed_version_id = ${feedId} and t.service_id = c.service_id
			)
		`;

		console.log('  derived geometries and service dates');
		await tx`
			insert into shape_lines (feed_version_id, shape_id, geom)
			select feed_version_id, shape_id, st_makeline(geom order by seq)
			from shapes
			where feed_version_id = ${feedId}
			group by feed_version_id, shape_id
			having count(*) > 1
		`;

		await tx`
			insert into trip_times (feed_version_id, trip_id, first_departure_s, last_arrival_s)
			select feed_version_id, trip_id, min(departure_s), max(arrival_s)
			from stop_times
			where feed_version_id = ${feedId}
			group by feed_version_id, trip_id
			on conflict do nothing
		`;

		await tx`select refresh_stop_suburbs(${feedId})`;

		await tx`
			insert into shape_routes (feed_version_id, shape_id, route_id)
			select distinct feed_version_id, shape_id, route_id
			from trips
			where feed_version_id = ${feedId} and shape_id is not null
		`;

		await tx`
			insert into service_dates (feed_version_id, agency_id, service_id, service_date)
			select c.feed_version_id, c.agency_id, c.service_id, d::date
			from calendar c
			cross join lateral generate_series(
				c.start_date::timestamp,
				c.end_date::timestamp,
				interval '1 day'
			) as d
			where c.feed_version_id = ${feedId}
				and case extract(isodow from d)
					when 1 then c.monday = 1
					when 2 then c.tuesday = 1
					when 3 then c.wednesday = 1
					when 4 then c.thursday = 1
					when 5 then c.friday = 1
					when 6 then c.saturday = 1
					when 7 then c.sunday = 1
					else false
				end
		`;

		await tx`
			delete from service_dates sd
			using calendar_dates cd
			where sd.feed_version_id = ${feedId}
				and cd.feed_version_id = ${feedId}
				and sd.agency_id = cd.agency_id
				and sd.service_id = cd.service_id
				and sd.service_date = cd.date
				and cd.exception_type = 2
		`;

		await tx`
			insert into service_dates (feed_version_id, agency_id, service_id, service_date)
			select feed_version_id, agency_id, service_id, date
			from calendar_dates
			where feed_version_id = ${feedId} and exception_type = 1
			on conflict do nothing
		`;

		await tx.unsafe(`
			analyze agencies, routes, stops, trips, stop_times, shapes,
				shape_lines, shape_routes, calendar, calendar_dates, service_dates
		`);
	});

	if (activate) {
		await sql.begin(async (tx) => {
			await tx`update feed_versions set is_active = false where is_active`;
			await tx`update feed_versions set is_active = true where id = ${feedId}`;
		});
	}

	const [counts] = await sql<
		{ stops: number; routes: number; trips: number; stop_times: number; shapes: number }[]
	>`
		select
			(select count(*)::int from stops where feed_version_id = ${feedId}) as stops,
			(select count(*)::int from routes where feed_version_id = ${feedId}) as routes,
			(select count(*)::int from trips where feed_version_id = ${feedId}) as trips,
			(select count(*)::int from stop_times where feed_version_id = ${feedId}) as stop_times,
			(select count(*)::int from shape_lines where feed_version_id = ${feedId}) as shapes
	`;

	console.log(
		`imported feed ${feedId} in ${((Date.now() - started) / 1000).toFixed(1)}s: ` +
			`${counts.stops} stops, ${counts.routes} routes, ${counts.trips} trips, ` +
			`${counts.stop_times} stop times, ${counts.shapes} shapes`
	);

	// Keep the active bundle and two predecessors for diffing.
	await sql`
		delete from feed_versions
		where id not in (
			select id from feed_versions order by fetched_at desc, id desc limit 3
		)
	`;

	// Route pace is derived from the active feed and used by the map tiles.
	await sql`refresh materialized view route_paces`;
	await sql`refresh materialized view concurrently slow_segments`;

	// Archives are only needed while importing; retain a week for debugging.
	const keep = new Set([basename(zipPath), basename(extractDir)]);
	const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
	for (const entry of await readdir('.data/gtfs')) {
		if (keep.has(entry)) continue;
		const path = join('.data/gtfs', entry);
		const info = await stat(path);
		if (info.mtimeMs < cutoff) await rm(path, { recursive: true, force: true });
	}
} catch (error) {
	if (feedId !== undefined) {
		await sql`delete from feed_versions where id = ${feedId}`.catch(() => {});
	}
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
} finally {
	await sql.end();
}
