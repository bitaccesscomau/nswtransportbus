CREATE TABLE "traffic_incidents" (
	"id" text PRIMARY KEY,
	"source" text NOT NULL,
	"category" text,
	"kind" text,
	"headline" text,
	"display_name" text,
	"roads" text,
	"suburbs" text,
	"advice" text,
	"expected_delay" integer,
	"is_major" boolean DEFAULT false NOT NULL,
	"impacting_network" boolean DEFAULT false NOT NULL,
	"public_transport" text,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"updated_at" timestamp with time zone,
	"lat" double precision,
	"lon" double precision,
	"geom" geometry(Point, 4326) GENERATED ALWAYS AS (st_setsrid(st_makepoint(lon, lat), 4326)) STORED,
	"properties" jsonb NOT NULL,
	"last_seen" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "traffic_incidents_geom_idx" ON "traffic_incidents" USING gist ("geom");
--> statement-breakpoint
CREATE INDEX "traffic_incidents_source_idx" ON "traffic_incidents" ("source");
