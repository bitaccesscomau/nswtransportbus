CREATE MATERIALIZED VIEW "route_paces" AS
WITH trip_metrics AS (
	SELECT
		t.feed_version_id,
		t.route_id,
		(tt.last_arrival_s - tt.first_departure_s)::numeric AS duration_s,
		st_length(sl.geom::geography)::numeric AS distance_m
	FROM trips t
	JOIN trip_times tt
		ON tt.feed_version_id = t.feed_version_id AND tt.trip_id = t.trip_id
	JOIN shape_lines sl
		ON sl.feed_version_id = t.feed_version_id AND sl.shape_id = t.shape_id
	JOIN routes r
		ON r.feed_version_id = t.feed_version_id AND r.route_id = t.route_id
	WHERE r.route_type IN (700, 712, 714)
		AND tt.last_arrival_s > tt.first_departure_s
)
SELECT
	feed_version_id,
	route_id,
	count(*)::int AS trips,
	sum(distance_m)::double precision AS distance_m,
	sum(duration_s)::double precision AS duration_s,
	(sum(duration_s) / 60.0 / nullif(sum(distance_m), 0) * 1000.0)::double precision AS minutes_per_km
FROM trip_metrics
GROUP BY feed_version_id, route_id;
--> statement-breakpoint
CREATE UNIQUE INDEX "route_paces_pk" ON "route_paces" ("feed_version_id", "route_id");
