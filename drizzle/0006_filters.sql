-- ABS Suburbs and Localities (SAL 2021) plus stop-to-suburb mapping and
-- precomputed trip start/end times for active-route filters.
CREATE TABLE "suburbs" (
	"sal_code" text PRIMARY KEY,
	"name" text NOT NULL,
	"state" text,
	"geom" geometry(MultiPolygon, 4326) NOT NULL
);
--> statement-breakpoint
CREATE INDEX "suburbs_geom_idx" ON "suburbs" USING gist ("geom");
--> statement-breakpoint
CREATE INDEX "suburbs_name_idx" ON "suburbs" ("name");
--> statement-breakpoint

CREATE TABLE "stop_suburbs" (
	"stop_id" text PRIMARY KEY,
	"sal_code" text,
	"suburb_name" text
);
--> statement-breakpoint
CREATE INDEX "stop_suburbs_name_idx" ON "stop_suburbs" ("suburb_name");
--> statement-breakpoint

CREATE TABLE "trip_times" (
	"feed_version_id" bigint NOT NULL REFERENCES "feed_versions" ("id") ON DELETE CASCADE,
	"trip_id" text NOT NULL,
	"first_departure_s" integer,
	"last_arrival_s" integer,
	CONSTRAINT "trip_times_feed_version_id_trip_id_pk" PRIMARY KEY ("feed_version_id", "trip_id")
);
--> statement-breakpoint

INSERT INTO "trip_times" ("feed_version_id", "trip_id", "first_departure_s", "last_arrival_s")
SELECT feed_version_id, trip_id, min(departure_s), max(arrival_s)
FROM stop_times
WHERE feed_version_id = active_feed_version()
GROUP BY feed_version_id, trip_id
ON CONFLICT DO NOTHING;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION refresh_stop_suburbs(p_feed_version_id bigint)
RETURNS void
LANGUAGE sql
AS $$
	INSERT INTO stop_suburbs (stop_id, sal_code, suburb_name)
	SELECT DISTINCT ON (s.stop_id)
		s.stop_id,
		sub.sal_code,
		sub.name
	FROM stops s
	JOIN suburbs sub ON st_covers(sub.geom, s.geom)
	WHERE s.feed_version_id = p_feed_version_id
	ORDER BY s.stop_id
	ON CONFLICT (stop_id) DO UPDATE SET
		sal_code = excluded.sal_code,
		suburb_name = excluded.suburb_name
$$;
