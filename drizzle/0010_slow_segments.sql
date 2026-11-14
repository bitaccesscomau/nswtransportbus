CREATE MATERIALIZED VIEW "slow_segments" AS
WITH active_feed AS (
	SELECT id
	FROM public.feed_versions
	WHERE is_active
	LIMIT 1
),
simplified AS (
	SELECT
		sl.feed_version_id,
		sl.shape_id,
		sl.geom,
		st_simplifypreservetopology(sl.geom, 0.00005) AS simple_geom,
		st_length(sl.geom::geography) AS length_m
	FROM shape_lines sl
	CROSS JOIN active_feed af
	WHERE sl.feed_version_id = af.id
),
recent AS (
	SELECT
		vp.geom AS point_geom,
		vp.speed_mps,
		vp.trip_id,
		vp.route_id
	FROM vehicle_positions vp
	WHERE vp.observed_at > now() - interval '24 hours'
		AND vp.speed_mps > 0.5
		AND vp.trip_id IS NOT NULL
		AND vp.geom IS NOT NULL
		-- Deterministic 1-in-10 sample keeps this view practical to refresh.
		AND (abs(hashtext(coalesce(vp.vehicle_key, vp.trip_id, ''))) % 10) = 0
),
matched AS (
	SELECT
		r.point_geom,
		r.speed_mps,
		r.route_id,
		t.shape_id,
		s.geom AS line_geom,
		s.simple_geom,
		s.length_m
	FROM recent r
	CROSS JOIN active_feed af
	JOIN trips t
		ON t.feed_version_id = af.id AND t.trip_id = r.trip_id
	JOIN simplified s
		ON s.feed_version_id = t.feed_version_id AND s.shape_id = t.shape_id
),
located AS (
	SELECT
		*,
		st_linelocatepoint(simple_geom, point_geom) AS frac
	FROM matched
	WHERE length_m > 0
),
binned AS (
	SELECT
		shape_id,
		floor(frac * length_m / 200.0)::int AS bin,
		min(route_id) AS route_id,
		count(*)::int AS samples,
		(avg(speed_mps) * 3.6)::double precision AS speed_kmh
	FROM located
	GROUP BY shape_id, bin
	HAVING count(*) >= 3
),
segments AS (
	SELECT
		b.shape_id,
		b.bin,
		b.route_id,
		b.samples,
		b.speed_kmh,
		st_linesubstring(
			s.geom,
			greatest(0.0, least(1.0, b.bin * 200.0 / s.length_m))::double precision,
			greatest(0.0, least(1.0, (b.bin + 1) * 200.0 / s.length_m))::double precision
		) AS geom
	FROM binned b
	JOIN simplified s ON s.shape_id = b.shape_id
)
SELECT *
FROM segments
WHERE st_length(geom) > 0;
--> statement-breakpoint
CREATE UNIQUE INDEX "slow_segments_pk" ON "slow_segments" ("shape_id", "bin");
--> statement-breakpoint
CREATE INDEX "slow_segments_geom_idx" ON "slow_segments" USING gist ("geom");
