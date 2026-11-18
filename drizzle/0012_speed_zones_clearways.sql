CREATE TABLE "speed_zones" (
	"gid" bigserial PRIMARY KEY NOT NULL,
	"speed_limit" integer,
	"zone_type" text,
	"status" text,
	"direction" text,
	"properties" jsonb,
	"geom" geometry(MultiLineString, 4326) NOT NULL
);
--> statement-breakpoint
CREATE INDEX "speed_zones_geom_idx" ON "speed_zones" USING gist ("geom");
--> statement-breakpoint
CREATE TABLE "clearways" (
	"gid" bigserial PRIMARY KEY NOT NULL,
	"street_name" text,
	"suburb" text,
	"direction" text,
	"peak" text,
	"transit_lane" text,
	"bus_lane_hours" text,
	"clearway_hours" text,
	"public_holiday" text,
	"length_m" double precision,
	"properties" jsonb,
	"geom" geometry(MultiLineString, 4326) NOT NULL
);
--> statement-breakpoint
CREATE INDEX "clearways_geom_idx" ON "clearways" USING gist ("geom");
