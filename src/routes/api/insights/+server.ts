import { sql } from 'drizzle-orm';
import { getDb } from '#lib/server/db/index.js';
import type { InsightKind, InsightResult, InsightRow } from '#lib/types.js';
import type { RequestHandler } from './$types';

function numberParam(value: string | null, fallback: number, min: number, max: number): number {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) return fallback;
	return Math.min(max, Math.max(min, parsed));
}

export const GET: RequestHandler = async ({ url }) => {
	const kind: InsightKind =
		url.searchParams.get('type') === 'extension'
			? 'extension'
			: url.searchParams.get('type') === 'transfers'
				? 'transfers'
				: 'least-used';
	const minEvents = Math.round(numberParam(url.searchParams.get('minEvents'), 50, 5, 500));
	const minTrips = Math.round(numberParam(url.searchParams.get('minTrips'), 5, 1, 100));
	const radius = Math.round(numberParam(url.searchParams.get('radius'), 100, 50, 400));
	const db = getDb();

	let rows: InsightRow[] = [];
	let note = '';

	if (kind === 'least-used') {
		const result = await db.execute<{
			id: string;
			label: string;
			lat: number;
			lon: number;
			events: number;
			routes: number;
			change_rate: number;
		}>(sql`
			with stats as (
				select
					stop_id,
					count(*)::int as events,
					count(*) filter (where band_change <> 0)::int as changed,
					count(distinct route_id)::int as routes
				from stop_boarding_events
				where event_time > now() - interval '7 days'
				group by stop_id
				having count(*) >= ${minEvents}
					and count(distinct route_id) <= 5
			)
			select
				s.stop_id as id,
				s.stop_name as label,
				s.stop_lat as lat,
				s.stop_lon as lon,
				stats.events,
				stats.routes,
				(stats.changed::float8 / stats.events) as change_rate
			from stats
			join stops s
				on s.feed_version_id = active_feed_version()
				and s.stop_id = stats.stop_id
			order by change_rate asc, stats.events desc
			limit 20
		`);

		rows = result.map((row) => ({
			id: row.id,
			label: row.label,
			lat: row.lat,
			lon: row.lon,
			detail: `${row.events} observed stops · ${row.routes} routes`,
			metric: `${(row.change_rate * 100).toFixed(1)}% changed`
		}));
		note =
			'Local stops (≤5 routes) with regular observed service but a low rate of occupancy-band change. Occupancy bands are coarse, so this is a low-activity indicator, not a boarding count.';
	} else if (kind === 'extension') {
		const result = await db.execute<{
			id: string;
			label: string;
			lat: number;
			lon: number;
			trips: number;
			avg_last_load: number;
			share_last_fullest: number;
			last_stop: string;
		}>(sql`
			with last_events as (
				select distinct on (service_date, trip_id)
					service_date,
					trip_id,
					route_id,
					stop_id,
					stop_sequence,
					before_load
				from stop_boarding_events
				where event_time > now() - interval '7 days'
					and before_load is not null
				order by service_date, trip_id, stop_sequence desc
			),
			trip_max as (
				select
					service_date,
					trip_id,
					max(before_load) as max_before
				from stop_boarding_events
				where event_time > now() - interval '7 days'
					and before_load is not null
				group by service_date, trip_id
			),
			candidates as (
				select
					le.route_id,
					le.stop_id,
					le.before_load,
					(le.before_load >= tm.max_before - 0.01 and le.before_load >= 0.5) as last_fullest
				from last_events le
				join trip_max tm
					on tm.service_date = le.service_date and tm.trip_id = le.trip_id
			),
			route_stats as (
				select
					route_id,
					count(*)::int as trips,
					avg(before_load)::float8 as avg_last_load,
					avg(last_fullest::int)::float8 as share_last_fullest,
					mode() within group (order by stop_id) as stop_id
				from candidates
				group by route_id
				having count(*) >= ${minTrips}
			)
			select
				rs.route_id as id,
				coalesce(r.route_short_name, r.route_long_name, rs.route_id) as label,
				s.stop_lat as lat,
				s.stop_lon as lon,
				rs.trips,
				rs.avg_last_load,
				rs.share_last_fullest,
				s.stop_name as last_stop
			from route_stats rs
			join routes r
				on r.feed_version_id = active_feed_version()
				and r.route_id = rs.route_id
			join stops s
				on s.feed_version_id = active_feed_version()
				and s.stop_id = rs.stop_id
			order by rs.share_last_fullest desc, rs.avg_last_load desc, rs.trips desc
			limit 20
		`);

		rows = result.map((row) => ({
			id: row.id,
			label: row.label,
			lat: row.lat,
			lon: row.lon,
			detail: `${row.trips} trips · last stop ${row.last_stop ?? 'unknown'} · avg load ${(row.avg_last_load ?? 0).toFixed(2)}`,
			metric: `${((row.share_last_fullest ?? 0) * 100).toFixed(0)}% last fullest`
		}));
		note =
			'Routes whose final stop is most often the fullest stop on the trip (arrival load). A high share is a candidate for extending the route, not proof of demand beyond the terminal.';
	} else {
		const result = await db.execute<{
			id: number;
			label: string;
			lat: number;
			lon: number;
			routes: number;
			alight: number;
			board: number;
			events: number;
			score: number;
		}>(sql`
			with clusters as (
				select
					stop_id,
					stop_name,
					stop_lat,
					stop_lon,
					st_clusterdbscan(st_transform(geom, 3857), ${radius}, 1) over () as cluster_id
				from stops
				where feed_version_id = active_feed_version()
			),
			events as (
				select
					e.route_id,
					e.before_load,
					e.after_load,
					e.band_change,
					c.cluster_id
				from stop_boarding_events e
				join clusters c on c.stop_id = e.stop_id
				where e.event_time > now() - interval '7 days'
			),
			stats as (
				select
					cluster_id,
					count(*)::int as events,
					count(distinct route_id)::int as routes,
					count(*) filter (where after_load < before_load or band_change < 0)::int as alight,
					count(*) filter (where after_load > before_load or band_change > 0)::int as board
				from events
				group by cluster_id
			),
			ranked as (
				select
					*,
					(least(alight, board) * ln(routes + 1))::float8 as score
				from stats
				where alight > 0 and board > 0 and routes >= 2
			)
			select
				r.cluster_id as id,
				rep.stop_name as label,
				rep.stop_lat as lat,
				rep.stop_lon as lon,
				r.routes,
				r.alight,
				r.board,
				r.events,
				r.score
			from ranked r
			join lateral (
				select c.stop_name, c.stop_lat, c.stop_lon
				from clusters c
				where c.cluster_id = r.cluster_id
				order by c.stop_id
				limit 1
			) rep on true
			order by r.score desc, r.routes desc
			limit 20
		`);

		rows = result.map((row) => ({
			id: String(row.id),
			label: row.label,
			lat: row.lat,
			lon: row.lon,
			detail: `${row.routes} routes · ${row.alight} alight · ${row.board} board · ${row.events} events`,
			metric: `${row.score.toFixed(0)} transfer score`
		}));
		note =
			'Stop clusters with both alighting and boarding events across multiple routes. This is an inferred transfer-potential score, not passenger-level reboarding data.';
	}

	const response: InsightResult = {
		kind,
		parameters:
			kind === 'least-used'
				? { minEvents }
				: kind === 'extension'
					? { minTrips }
					: { radiusMeters: radius },
		rows,
		note
	};

	return Response.json(response);
};
