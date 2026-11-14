-- Geography columns, trigram indexes, partitioned live tables, and maintenance functions.
-- drizzle-kit does not model geography, PARTITION BY, or gin_trgm_ops, so this migration owns them.

ALTER TABLE "stops" ADD COLUMN "geog" geography(Point, 4326)
	GENERATED ALWAYS AS (st_setsrid(st_makepoint(stop_lon, stop_lat), 4326)::geography) STORED;
--> statement-breakpoint
CREATE INDEX "stops_geog_idx" ON "stops" USING gist ("geog");
--> statement-breakpoint
CREATE INDEX "stops_name_trgm_idx" ON "stops" USING gin ("stop_name" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX "routes_short_name_trgm_idx" ON "routes" USING gin ("route_short_name" gin_trgm_ops);
--> statement-breakpoint
ALTER TABLE "live_vehicles" ADD COLUMN "geog" geography(Point, 4326)
	GENERATED ALWAYS AS (st_setsrid(st_makepoint(lon, lat), 4326)::geography) STORED;
--> statement-breakpoint
CREATE INDEX "live_vehicles_geog_idx" ON "live_vehicles" USING gist ("geog");
--> statement-breakpoint

CREATE TABLE "vehicle_positions" (
	"observed_at" timestamp with time zone NOT NULL,
	"service_date" date NOT NULL,
	"poll_id" bigint NOT NULL,
	"entity_id" text,
	"vehicle_id" text,
	"vehicle_key" text GENERATED ALWAYS AS (coalesce(vehicle_id, entity_id)) STORED,
	"trip_id" text,
	"route_id" text,
	"direction_id" smallint,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"geom" geometry(Point, 4326) GENERATED ALWAYS AS (st_setsrid(st_makepoint(lon, lat), 4326)) STORED,
	"bearing" real,
	"speed_mps" real,
	"current_stop_sequence" integer,
	"stop_id" text,
	"current_status" text,
	"congestion" text,
	"occupancy" text,
	"feed_timestamp" timestamp with time zone
) PARTITION BY RANGE ("observed_at");
--> statement-breakpoint
CREATE INDEX "vehicle_positions_observed_idx" ON "vehicle_positions" ("observed_at");
--> statement-breakpoint
CREATE INDEX "vehicle_positions_vehicle_idx" ON "vehicle_positions" ("vehicle_key", "observed_at");
--> statement-breakpoint
CREATE INDEX "vehicle_positions_trip_idx" ON "vehicle_positions" ("trip_id", "observed_at");
--> statement-breakpoint
CREATE INDEX "vehicle_positions_route_idx" ON "vehicle_positions" ("route_id", "observed_at");
--> statement-breakpoint
CREATE INDEX "vehicle_positions_geom_idx" ON "vehicle_positions" USING gist ("geom");
--> statement-breakpoint

CREATE TABLE "trip_observations" (
	"service_date" date NOT NULL,
	"trip_id" text NOT NULL,
	"stop_sequence" integer NOT NULL,
	"stop_id" text,
	"start_time" text,
	"predicted_arrival" timestamp with time zone,
	"predicted_departure" timestamp with time zone,
	"delay_s" integer,
	"schedule_relationship" text,
	"departure_occupancy" text,
	"first_seen" timestamp with time zone NOT NULL,
	"last_seen" timestamp with time zone NOT NULL,
	"observations" integer DEFAULT 1 NOT NULL,
	"source" text DEFAULT 'trip_update' NOT NULL,
	CONSTRAINT "trip_observations_service_date_trip_id_stop_sequence_pk"
		PRIMARY KEY ("service_date", "trip_id", "stop_sequence")
) PARTITION BY RANGE ("service_date");
--> statement-breakpoint
CREATE INDEX "trip_observations_trip_idx" ON "trip_observations" ("trip_id", "service_date");
--> statement-breakpoint
CREATE INDEX "trip_observations_stop_idx" ON "trip_observations" ("stop_id", "service_date");
--> statement-breakpoint

CREATE OR REPLACE FUNCTION active_feed_version()
RETURNS bigint
LANGUAGE sql
STABLE
AS $$
	SELECT id FROM feed_versions WHERE is_active LIMIT 1
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION ensure_daily_partition(p_day date)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
	part text := 'vehicle_positions_' || to_char(p_day, 'YYYYMMDD');
	lo timestamptz := p_day::timestamp AT TIME ZONE 'UTC';
	hi timestamptz := (p_day + 1)::timestamp AT TIME ZONE 'UTC';
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = part) THEN
		EXECUTE format(
			'create table if not exists %I partition of vehicle_positions for values from (%L) to (%L)',
			part, lo, hi
		);
	END IF;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION ensure_monthly_trip_partition(p_day date)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
	part text := 'trip_observations_' || to_char(p_day, 'YYYYMM');
	lo date := date_trunc('month', p_day)::date;
	hi date := (date_trunc('month', p_day) + interval '1 month')::date;
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = part) THEN
		EXECUTE format(
			'create table if not exists %I partition of trip_observations for values from (%L) to (%L)',
			part, lo, hi
		);
	END IF;
END;
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
		WHERE p.relname IN ('vehicle_positions', 'trip_observations')
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
