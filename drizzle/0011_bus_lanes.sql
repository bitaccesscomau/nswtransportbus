CREATE TABLE "bus_lanes" (
	"gid" bigserial PRIMARY KEY NOT NULL,
	"road_name" text,
	"operating" text,
	"data_captured" date,
	"lane_type" text,
	"status" text,
	"length_m" double precision,
	"properties" jsonb,
	"geom" geometry(MultiLineString, 4326) NOT NULL
);
--> statement-breakpoint
CREATE INDEX "bus_lanes_geom_idx" ON "bus_lanes" USING gist ("geom");
