import { sql } from 'drizzle-orm';
import type { Db } from './db';

/**
 * Derives one row per realised stop from trip observations, comparing the
 * vehicle's occupancy band just before arrival with the band just after
 * departure. Idempotent; re-running a window upserts the events.
 */
export async function deriveBusyness(db: Db, from: Date, to: Date): Promise<void> {
	const fromIso = from.toISOString();
	const toIso = to.toISOString();

	await db.execute(sql`
		with events as (
			select
				o.service_date,
				o.trip_id,
				o.stop_sequence,
				o.stop_id,
				coalesce(o.predicted_arrival, o.predicted_departure, o.last_seen) as arrival_time,
				coalesce(o.predicted_departure, o.predicted_arrival, o.last_seen) as departure_time
			from trip_observations o
			where o.stop_id is not null
				and o.service_date between
					(${fromIso}::timestamptz at time zone 'Australia/Sydney')::date - 1
					and (${toIso}::timestamptz at time zone 'Australia/Sydney')::date + 1
				and coalesce(o.predicted_departure, o.predicted_arrival, o.last_seen)
					>= ${fromIso}::timestamptz
				and coalesce(o.predicted_departure, o.predicted_arrival, o.last_seen)
					< ${toIso}::timestamptz
		)
		insert into stop_boarding_events (
			service_date,
			trip_id,
			stop_sequence,
			stop_id,
			route_id,
			direction_id,
			event_time,
			dow,
			hour,
			before_occupancy,
			after_occupancy,
			before_load,
			after_load,
			net_load,
			band_change
		)
		select
			e.service_date,
			e.trip_id,
			e.stop_sequence,
			e.stop_id,
			t.route_id,
			t.direction_id,
			e.departure_time,
			extract(isodow from e.departure_time at time zone 'Australia/Sydney')::smallint,
			extract(hour from e.departure_time at time zone 'Australia/Sydney')::smallint,
			b.occupancy,
			a.occupancy,
			ob.load,
			oa.load,
			case when ob.load is null or oa.load is null then null else oa.load - ob.load end,
			case when ob.ordinal is null or oa.ordinal is null then null else oa.ordinal - ob.ordinal end
		from events e
		join trips t
			on t.feed_version_id = active_feed_version() and t.trip_id = e.trip_id
		left join lateral (
			select vp.occupancy
			from vehicle_positions vp
			where vp.trip_id = e.trip_id
				and vp.service_date = e.service_date
				and vp.observed_at <= e.arrival_time
				and vp.observed_at > e.arrival_time - interval '5 minutes'
				and vp.occupancy is not null
			order by vp.observed_at desc
			limit 1
		) b on true
		left join lateral (
			select vp.occupancy
			from vehicle_positions vp
			where vp.trip_id = e.trip_id
				and vp.service_date = e.service_date
				and vp.observed_at >= e.departure_time + interval '30 seconds'
				and vp.observed_at < e.departure_time + interval '5 minutes'
				and vp.occupancy is not null
			order by vp.observed_at asc
			limit 1
		) a on true
		left join occupancy_bands ob on ob.occupancy = b.occupancy
		left join occupancy_bands oa on oa.occupancy = a.occupancy
		on conflict (service_date, trip_id, stop_sequence) do update set
			stop_id = excluded.stop_id,
			route_id = excluded.route_id,
			direction_id = excluded.direction_id,
			event_time = excluded.event_time,
			dow = excluded.dow,
			hour = excluded.hour,
			before_occupancy = excluded.before_occupancy,
			after_occupancy = excluded.after_occupancy,
			before_load = excluded.before_load,
			after_load = excluded.after_load,
			net_load = excluded.net_load,
			band_change = excluded.band_change
	`);
}
