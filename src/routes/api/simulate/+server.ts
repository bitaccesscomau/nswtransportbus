import { sql } from 'drizzle-orm';
import { getDb } from '#lib/server/db/index.js';
import type { SimulationRemovedStop, SimulationResult } from '#lib/types.js';
import type { RequestHandler } from './$types';

function numberParam(value: string | null, fallback: number, min: number, max: number): number {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) return fallback;
	return Math.min(max, Math.max(min, parsed));
}

export const GET: RequestHandler = async ({ url }) => {
	const scenario = url.searchParams.get('scenario') === 'express' ? 'express' : 'consolidate';
	const radius = Math.round(numberParam(url.searchParams.get('radius'), 100, 5, 250));
	const skip = Math.round(numberParam(url.searchParams.get('skip'), 3, 2, 8));
	const dwell = Math.round(numberParam(url.searchParams.get('dwell'), 20, 0, 90));
	const threshold = Math.round(numberParam(url.searchParams.get('threshold'), 300, 60, 1200));
	const days = Math.round(numberParam(url.searchParams.get('days'), 7, 1, 30));

	const scenarioCte =
		scenario === 'consolidate'
			? sql`
				clustered as (
					select
						s.stop_id,
						s.stop_name,
						s.stop_lat,
						s.stop_lon,
						st_clusterdbscan(st_transform(s.geom, 3857), ${radius}, 1) over () as cluster_id,
						(
							select st_distance(s.geom::geography, t.geom::geography)
							from traffic_lights t
							order by t.geom <-> s.geom
							limit 1
						) as light_distance
					from stops s
					where s.feed_version_id = active_feed_version()
				),
				ranked as (
					select
						*,
						row_number() over (
							partition by cluster_id
							order by light_distance nulls last, stop_id
						) as rn
					from clustered
				),
				removed_initial as (
					select stop_id, stop_name, stop_lat, stop_lon
					from ranked
					where rn > 1
				),
				removed_routes as (
					select distinct
						t.route_id,
						t.direction_id,
						r.stop_id
					from removed_initial r
					join stop_times st
						on st.feed_version_id = active_feed_version()
						and st.stop_id = r.stop_id
					join trips t
						on t.feed_version_id = active_feed_version()
						and t.trip_id = st.trip_id
					where t.direction_id is not null
				),
				reverse_pairs as (
					select distinct on (rr.stop_id, rr.route_id, rr.direction_id)
						rr.stop_id,
						s2.stop_id as reverse_stop_id
					from removed_routes rr
					join stops s1
						on s1.feed_version_id = active_feed_version()
						and s1.stop_id = rr.stop_id
					join stop_times st2
						on st2.feed_version_id = active_feed_version()
						and st2.stop_id <> rr.stop_id
					join trips t2
						on t2.feed_version_id = active_feed_version()
						and t2.trip_id = st2.trip_id
						and t2.route_id = rr.route_id
						and t2.direction_id is not null
						and t2.direction_id <> rr.direction_id
					join stops s2
						on s2.feed_version_id = active_feed_version()
						and s2.stop_id = st2.stop_id
					where st_dwithin(s1.geog, s2.geog, 60)
					order by rr.stop_id, rr.route_id, rr.direction_id, st_distance(s1.geog, s2.geog)
				),
				removed_candidates as (
					select stop_id, stop_name, stop_lat, stop_lon from removed_initial
					union
					select
						s.stop_id,
						s.stop_name,
						s.stop_lat,
						s.stop_lon
					from removed_initial r
					join reverse_pairs rp on rp.stop_id = r.stop_id
					join stops s
						on s.feed_version_id = active_feed_version()
						and s.stop_id = rp.reverse_stop_id
				),
				clusters_all_removed as (
					select r.cluster_id
					from ranked r
					left join removed_candidates rc on rc.stop_id = r.stop_id
					group by r.cluster_id
					having count(*) filter (where rc.stop_id is null) = 0
				),
				removed_pre_adjacency as (
					select rc.stop_id, rc.stop_name, rc.stop_lat, rc.stop_lon
					from removed_candidates rc
					where not exists (
						select 1
						from ranked r
						join clusters_all_removed c on c.cluster_id = r.cluster_id
						where r.stop_id = rc.stop_id and r.rn = 1
					)
				),
				trip_removed_flags as (
					select
						st.trip_id,
						st.stop_id,
						st.stop_sequence,
						(r.stop_id is not null) as is_removed,
						sum(case when r.stop_id is null then 1 else 0 end) over (
							partition by st.trip_id order by st.stop_sequence
						) as island
					from stop_times st
					left join removed_pre_adjacency r on r.stop_id = st.stop_id
					where st.feed_version_id = active_feed_version()
				),
				removed_runs as (
					select
						trip_id,
						stop_id,
						stop_sequence,
						row_number() over (
							partition by trip_id, island order by stop_sequence
						) as rn
					from trip_removed_flags
					where is_removed
				),
				restore_stops as (
					select distinct stop_id
					from removed_runs
					where rn % 2 = 0
				),
				removed as (
					select r.stop_id, r.stop_name, r.stop_lat, r.stop_lon
					from removed_pre_adjacency r
					where not exists (
						select 1 from restore_stops rs where rs.stop_id = r.stop_id
					)
				),
				trip_removed as (
					select
						st.trip_id,
						count(distinct st.stop_id)::int as removed_stops
					from stop_times st
					join removed r on r.stop_id = st.stop_id
					where st.feed_version_id = active_feed_version()
					group by st.trip_id
				)
			`
			: sql`
				trip_stops as (
					select
						st.trip_id,
						st.stop_id,
						st.stop_sequence,
						row_number() over (
							partition by st.trip_id order by st.stop_sequence
						) as rn,
						count(*) over (partition by st.trip_id) as n
					from stop_times st
					where st.feed_version_id = active_feed_version()
				),
				trip_removed as (
					select
						trip_id,
						count(*)::int as removed_stops
					from trip_stops
					where rn > 1 and rn < n and (rn % ${skip}) = 0
					group by trip_id
				),
				removed as (
					select distinct
						ts.stop_id,
						s.stop_name,
						s.stop_lat,
						s.stop_lon
					from trip_stops ts
					join stops s
						on s.feed_version_id = active_feed_version()
						and s.stop_id = ts.stop_id
					where ts.rn > 1 and ts.rn < ts.n and (ts.rn % ${skip}) = 0
				)
			`;

	const db = getDb();
	const rows = await db.execute<{
		trips: number;
		baseline_on_time_trips: number;
		simulated_on_time_trips: number;
		routes_affected: number;
		avg_saved_s: number | null;
		baseline_route_pct: number | null;
		simulated_route_pct: number | null;
		stops_removed: number;
		removedStops: SimulationRemovedStop[] | string | null;
	}>(sql`
		with trip_delays as (
			select
				trip_id,
				avg(delay_s)::float8 as avg_delay
			from trip_delays
			where observed_at > now() - make_interval(days => ${days})
				and delay_s is not null
			group by trip_id
		),
		${scenarioCte},
		trip_results as (
			select
				td.trip_id,
				t.route_id,
				td.avg_delay,
				coalesce(tr.removed_stops, 0) as removed_stops,
				(coalesce(tr.removed_stops, 0) * ${dwell})::float8 as saved_s,
				(td.avg_delay <= ${threshold}) as baseline_on_time,
				(td.avg_delay - coalesce(tr.removed_stops, 0) * ${dwell} <= ${threshold}) as simulated_on_time
			from trip_delays td
			join trips t
				on t.feed_version_id = active_feed_version()
				and t.trip_id = td.trip_id
			left join trip_removed tr on tr.trip_id = td.trip_id
		),
		totals as (
			select
				count(*)::int as trips,
				count(*) filter (where baseline_on_time)::int as baseline_on_time_trips,
				count(*) filter (where simulated_on_time)::int as simulated_on_time_trips,
				count(distinct route_id) filter (where removed_stops > 0)::int as routes_affected,
				avg(saved_s) filter (where removed_stops > 0)::float8 as avg_saved_s
			from trip_results
		),
		route_stats as (
			select
				route_id,
				avg(baseline_on_time::int)::float8 as baseline_pct,
				avg(simulated_on_time::int)::float8 as simulated_pct
			from trip_results
			group by route_id
		),
		removed_count as (
			select count(*)::int as stops_removed from removed
		)
		select
			totals.*,
			(select avg(baseline_pct) * 100 from route_stats)::float8 as baseline_route_pct,
			(select avg(simulated_pct) * 100 from route_stats)::float8 as simulated_route_pct,
			(select stops_removed from removed_count) as stops_removed,
			(
				select coalesce(
					jsonb_agg(jsonb_build_object(
						'stopId', stop_id,
						'stopName', stop_name,
						'lat', stop_lat,
						'lon', stop_lon
					)),
					'[]'::jsonb
				)
				from removed
			) as "removedStops"
		from totals
	`);

	const row = rows[0];
	if (!row) {
		return Response.json({ error: 'Simulation returned no data' }, { status: 500 });
	}

	const removedStops =
		typeof row.removedStops === 'string'
			? (JSON.parse(row.removedStops) as SimulationRemovedStop[])
			: (row.removedStops ?? []);

	const baselineTripPct = row.trips > 0 ? (row.baseline_on_time_trips / row.trips) * 100 : 0;
	const simulatedTripPct = row.trips > 0 ? (row.simulated_on_time_trips / row.trips) * 100 : 0;

	const result: SimulationResult = {
		scenario,
		parameters: {
			...(scenario === 'consolidate' ? { radiusMeters: radius } : { skipEvery: skip }),
			dwellSeconds: dwell,
			onTimeThresholdSeconds: threshold,
			windowDays: days
		},
		tripsAnalyzed: row.trips,
		baselineOnTimeTrips: row.baseline_on_time_trips,
		simulatedOnTimeTrips: row.simulated_on_time_trips,
		baselineTripOnTimePct: baselineTripPct,
		simulatedTripOnTimePct: simulatedTripPct,
		baselineRouteOnTimePct: row.baseline_route_pct ?? 0,
		simulatedRouteOnTimePct: row.simulated_route_pct ?? 0,
		stopsRemoved: row.stops_removed,
		routesAffected: row.routes_affected,
		avgSavedSeconds: row.avg_saved_s,
		removedStops
	};

	return Response.json(result);
};
