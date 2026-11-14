-- Append-only trip-level delay observations, so rewinding shows the delay that
-- existed at the selected time rather than the latest known delay.
CREATE TABLE "trip_delays" (
	"observed_at" timestamp with time zone NOT NULL,
	"service_date" date NOT NULL,
	"trip_id" text NOT NULL,
	"route_id" text,
	"delay_s" integer,
	"stop_sequence" integer,
	CONSTRAINT "trip_delays_observed_at_trip_id_pk" PRIMARY KEY ("observed_at", "trip_id")
) PARTITION BY RANGE ("observed_at");
--> statement-breakpoint
CREATE INDEX "trip_delays_trip_idx" ON "trip_delays" ("trip_id", "service_date", "observed_at" DESC);
--> statement-breakpoint
CREATE INDEX "trip_delays_observed_idx" ON "trip_delays" ("observed_at");
--> statement-breakpoint

CREATE OR REPLACE FUNCTION ensure_daily_trip_delay_partition(p_day date)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
	part text := 'trip_delays_' || to_char(p_day, 'YYYYMMDD');
	lo timestamptz := p_day::timestamp AT TIME ZONE 'UTC';
	hi timestamptz := (p_day + 1)::timestamp AT TIME ZONE 'UTC';
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = part) THEN
		EXECUTE format(
			'create table if not exists %I partition of trip_delays for values from (%L) to (%L)',
			part, lo, hi
		);
	END IF;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION vehicle_delay(
	p_trip_id text,
	p_service_date date,
	p_at timestamptz
)
RETURNS integer
LANGUAGE sql
STABLE
AS $$
	SELECT d.delay_s
	FROM trip_delays d
	WHERE d.trip_id = p_trip_id
		AND d.service_date = p_service_date
		AND d.observed_at <= p_at
		AND d.observed_at > p_at - interval '15 minutes'
	ORDER BY d.observed_at DESC
	LIMIT 1
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION drop_old_partitions(p_keep_days integer)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
	r record;
	suffix text;
	dropped integer := 0;
	cutoff date := current_date - p_keep_days;
BEGIN
	FOR r IN
		SELECT c.relname
		FROM pg_inherits i
		JOIN pg_class c ON c.oid = i.inhrelid
		JOIN pg_class p ON p.oid = i.inhparent
		WHERE p.relname IN ('vehicle_positions', 'trip_observations', 'trip_delays')
	LOOP
		suffix := substring(r.relname from '(\d{6,8})$');
		IF suffix IS NULL THEN
			CONTINUE;
		END IF;

		IF length(suffix) = 8 THEN
			IF to_date(suffix, 'YYYYMMDD') < cutoff THEN
				EXECUTE format('drop table if exists %I', r.relname);
				dropped := dropped + 1;
			END IF;
		ELSE
			IF to_date(suffix || '01', 'YYYYMMDD') < date_trunc('month', cutoff::timestamp)::date THEN
				EXECUTE format('drop table if exists %I', r.relname);
				dropped := dropped + 1;
			END IF;
		END IF;
	END LOOP;

	RETURN dropped;
END;
$$;
--> statement-breakpoint

-- Backfill from the stop-level observations collected so far. One row per trip
-- per poll is enough for the playback lookup.
DO $$
DECLARE
	d date;
BEGIN
	FOR d IN SELECT DISTINCT (last_seen AT TIME ZONE 'UTC')::date FROM trip_observations LOOP
		PERFORM ensure_daily_trip_delay_partition(d);
	END LOOP;
END $$;
--> statement-breakpoint

INSERT INTO "trip_delays" ("observed_at", "service_date", "trip_id", "route_id", "delay_s", "stop_sequence")
SELECT DISTINCT ON ("trip_id", "service_date", "last_seen")
	"last_seen", "service_date", "trip_id", NULL, "delay_s", "stop_sequence"
FROM "trip_observations"
WHERE "delay_s" IS NOT NULL
ORDER BY "trip_id", "service_date", "last_seen"
ON CONFLICT DO NOTHING;
