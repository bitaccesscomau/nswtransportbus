CREATE TABLE "traffic_lights" (
	"equipment_id" text PRIMARY KEY NOT NULL,
	"asset_type" text,
	"street_1" text,
	"street_2" text,
	"street_3" text,
	"suburb" text,
	"rms_region" text,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"geom" geometry(Point, 4326) GENERATED ALWAYS AS (st_setsrid(st_makepoint(lon, lat), 4326)) STORED
);
--> statement-breakpoint
CREATE INDEX "traffic_lights_geom_idx" ON "traffic_lights" USING gist ("geom");
