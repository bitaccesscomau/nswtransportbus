CREATE EXTENSION IF NOT EXISTS postgis;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE TABLE "agencies" (
	"feed_version_id" bigint NOT NULL,
	"agency_id" text NOT NULL,
	"agency_name" text,
	"agency_url" text,
	"agency_timezone" text,
	"agency_lang" text,
	"agency_phone" text,
	CONSTRAINT "agencies_feed_version_id_agency_id_pk" PRIMARY KEY("feed_version_id","agency_id")
);
--> statement-breakpoint
CREATE TABLE "calendar" (
	"feed_version_id" bigint NOT NULL,
	"agency_id" text DEFAULT '' NOT NULL,
	"service_id" text NOT NULL,
	"monday" smallint DEFAULT 0 NOT NULL,
	"tuesday" smallint DEFAULT 0 NOT NULL,
	"wednesday" smallint DEFAULT 0 NOT NULL,
	"thursday" smallint DEFAULT 0 NOT NULL,
	"friday" smallint DEFAULT 0 NOT NULL,
	"saturday" smallint DEFAULT 0 NOT NULL,
	"sunday" smallint DEFAULT 0 NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	CONSTRAINT "calendar_feed_version_id_agency_id_service_id_pk" PRIMARY KEY("feed_version_id","agency_id","service_id")
);
--> statement-breakpoint
CREATE TABLE "calendar_dates" (
	"feed_version_id" bigint NOT NULL,
	"agency_id" text DEFAULT '' NOT NULL,
	"service_id" text NOT NULL,
	"date" date NOT NULL,
	"exception_type" smallint NOT NULL,
	CONSTRAINT "calendar_dates_feed_version_id_agency_id_service_id_date_pk" PRIMARY KEY("feed_version_id","agency_id","service_id","date")
);
--> statement-breakpoint
CREATE TABLE "feed_versions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sha256" text NOT NULL,
	"bytes" bigint,
	"is_active" boolean DEFAULT false NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "live_vehicles" (
	"vehicle_key" text PRIMARY KEY NOT NULL,
	"entity_id" text,
	"vehicle_id" text,
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
	"observed_at" timestamp with time zone NOT NULL,
	"feed_timestamp" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "poll_runs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"feed" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"http_status" integer,
	"entities" integer,
	"bytes" integer,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "routes" (
	"feed_version_id" bigint NOT NULL,
	"route_id" text NOT NULL,
	"agency_id" text NOT NULL,
	"route_short_name" text,
	"route_long_name" text,
	"route_desc" text,
	"route_type" integer,
	"route_color" text,
	"route_text_color" text,
	"route_sort_order" integer,
	CONSTRAINT "routes_feed_version_id_route_id_pk" PRIMARY KEY("feed_version_id","route_id")
);
--> statement-breakpoint
CREATE TABLE "service_dates" (
	"feed_version_id" bigint NOT NULL,
	"agency_id" text DEFAULT '' NOT NULL,
	"service_id" text NOT NULL,
	"service_date" date NOT NULL,
	CONSTRAINT "service_dates_feed_version_id_agency_id_service_id_service_date_pk" PRIMARY KEY("feed_version_id","agency_id","service_id","service_date")
);
--> statement-breakpoint
CREATE TABLE "shape_lines" (
	"feed_version_id" bigint NOT NULL,
	"shape_id" text NOT NULL,
	"geom" geometry(LineString, 4326) NOT NULL,
	CONSTRAINT "shape_lines_feed_version_id_shape_id_pk" PRIMARY KEY("feed_version_id","shape_id")
);
--> statement-breakpoint
CREATE TABLE "shape_routes" (
	"feed_version_id" bigint NOT NULL,
	"shape_id" text NOT NULL,
	"route_id" text NOT NULL,
	CONSTRAINT "shape_routes_feed_version_id_shape_id_route_id_pk" PRIMARY KEY("feed_version_id","shape_id","route_id")
);
--> statement-breakpoint
CREATE TABLE "shapes" (
	"feed_version_id" bigint NOT NULL,
	"shape_id" text NOT NULL,
	"seq" integer NOT NULL,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"dist" double precision,
	"geom" geometry(Point, 4326) GENERATED ALWAYS AS (st_setsrid(st_makepoint(lon, lat), 4326)) STORED,
	CONSTRAINT "shapes_feed_version_id_shape_id_seq_pk" PRIMARY KEY("feed_version_id","shape_id","seq")
);
--> statement-breakpoint
CREATE TABLE "stop_times" (
	"feed_version_id" bigint NOT NULL,
	"trip_id" text NOT NULL,
	"stop_sequence" integer NOT NULL,
	"stop_id" text NOT NULL,
	"arrival_s" integer,
	"departure_s" integer,
	"pickup_type" smallint,
	"dropoff_type" smallint,
	"timepoint" smallint,
	"shape_dist_traveled" double precision,
	CONSTRAINT "stop_times_feed_version_id_trip_id_stop_sequence_pk" PRIMARY KEY("feed_version_id","trip_id","stop_sequence")
);
--> statement-breakpoint
CREATE TABLE "stops" (
	"feed_version_id" bigint NOT NULL,
	"stop_id" text NOT NULL,
	"stop_name" text NOT NULL,
	"stop_lat" double precision NOT NULL,
	"stop_lon" double precision NOT NULL,
	"geom" geometry(Point, 4326) GENERATED ALWAYS AS (st_setsrid(st_makepoint(stop_lon, stop_lat), 4326)) STORED,
	"location_type" integer,
	"parent_station" text,
	"wheelchair_boarding" integer,
	"platform_code" text,
	CONSTRAINT "stops_feed_version_id_stop_id_pk" PRIMARY KEY("feed_version_id","stop_id")
);
--> statement-breakpoint
CREATE TABLE "trips" (
	"feed_version_id" bigint NOT NULL,
	"trip_id" text NOT NULL,
	"route_id" text NOT NULL,
	"service_id" text NOT NULL,
	"agency_id" text DEFAULT '' NOT NULL,
	"trip_headsign" text,
	"direction_id" smallint,
	"block_id" text,
	"shape_id" text,
	"wheelchair_accessible" smallint,
	"route_direction" text,
	CONSTRAINT "trips_feed_version_id_trip_id_pk" PRIMARY KEY("feed_version_id","trip_id")
);
--> statement-breakpoint
ALTER TABLE "agencies" ADD CONSTRAINT "agencies_feed_version_id_feed_versions_id_fk" FOREIGN KEY ("feed_version_id") REFERENCES "public"."feed_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar" ADD CONSTRAINT "calendar_feed_version_id_feed_versions_id_fk" FOREIGN KEY ("feed_version_id") REFERENCES "public"."feed_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_dates" ADD CONSTRAINT "calendar_dates_feed_version_id_feed_versions_id_fk" FOREIGN KEY ("feed_version_id") REFERENCES "public"."feed_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routes" ADD CONSTRAINT "routes_feed_version_id_feed_versions_id_fk" FOREIGN KEY ("feed_version_id") REFERENCES "public"."feed_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_dates" ADD CONSTRAINT "service_dates_feed_version_id_feed_versions_id_fk" FOREIGN KEY ("feed_version_id") REFERENCES "public"."feed_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shape_lines" ADD CONSTRAINT "shape_lines_feed_version_id_feed_versions_id_fk" FOREIGN KEY ("feed_version_id") REFERENCES "public"."feed_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shape_routes" ADD CONSTRAINT "shape_routes_feed_version_id_feed_versions_id_fk" FOREIGN KEY ("feed_version_id") REFERENCES "public"."feed_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shapes" ADD CONSTRAINT "shapes_feed_version_id_feed_versions_id_fk" FOREIGN KEY ("feed_version_id") REFERENCES "public"."feed_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stop_times" ADD CONSTRAINT "stop_times_feed_version_id_feed_versions_id_fk" FOREIGN KEY ("feed_version_id") REFERENCES "public"."feed_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stops" ADD CONSTRAINT "stops_feed_version_id_feed_versions_id_fk" FOREIGN KEY ("feed_version_id") REFERENCES "public"."feed_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_feed_version_id_feed_versions_id_fk" FOREIGN KEY ("feed_version_id") REFERENCES "public"."feed_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "feed_versions_one_active_idx" ON "feed_versions" USING btree ("is_active") WHERE "feed_versions"."is_active";--> statement-breakpoint
CREATE INDEX "live_vehicles_observed_idx" ON "live_vehicles" USING btree ("observed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "poll_runs_feed_started_idx" ON "poll_runs" USING btree ("feed","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "service_dates_date_idx" ON "service_dates" USING btree ("feed_version_id","service_date");--> statement-breakpoint
CREATE INDEX "shape_lines_geom_idx" ON "shape_lines" USING gist ("geom");--> statement-breakpoint
CREATE INDEX "stop_times_stop_idx" ON "stop_times" USING btree ("feed_version_id","stop_id");--> statement-breakpoint
CREATE INDEX "stops_geom_idx" ON "stops" USING gist ("geom");--> statement-breakpoint
CREATE INDEX "trips_route_idx" ON "trips" USING btree ("feed_version_id","route_id");--> statement-breakpoint
CREATE INDEX "trips_service_idx" ON "trips" USING btree ("feed_version_id","agency_id","service_id");--> statement-breakpoint
CREATE INDEX "trips_shape_idx" ON "trips" USING btree ("feed_version_id","shape_id");