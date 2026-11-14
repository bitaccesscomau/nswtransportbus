-- Occupancy bands mapped to seat-equivalents and ordinal levels.
CREATE TABLE "occupancy_bands" (
	"occupancy" text PRIMARY KEY,
	"load" real NOT NULL,
	"ordinal" smallint NOT NULL
);
--> statement-breakpoint
INSERT INTO "occupancy_bands" ("occupancy", "load", "ordinal") VALUES
	('EMPTY', 0, 0),
	('MANY_SEATS_AVAILABLE', 0.25, 1),
	('FEW_SEATS_AVAILABLE', 0.75, 2),
	('STANDING_ROOM_ONLY', 1.1, 3),
	('CRUSHED_STANDING_ROOM_ONLY', 1.3, 4),
	('FULL', 1.5, 5)
ON CONFLICT ("occupancy") DO NOTHING;
--> statement-breakpoint

-- One row per realised stop event, derived from trip observations and the
-- occupancy snapshots before/after the stop. Direction is stored but analysis
-- combines it.
CREATE TABLE "stop_boarding_events" (
	"service_date" date NOT NULL,
	"trip_id" text NOT NULL,
	"stop_sequence" integer NOT NULL,
	"stop_id" text NOT NULL,
	"route_id" text,
	"direction_id" smallint,
	"event_time" timestamp with time zone NOT NULL,
	"dow" smallint NOT NULL,
	"hour" smallint NOT NULL,
	"before_occupancy" text,
	"after_occupancy" text,
	"before_load" real,
	"after_load" real,
	"net_load" real,
	"band_change" integer,
	CONSTRAINT "stop_boarding_events_service_date_trip_id_stop_sequence_pk"
		PRIMARY KEY ("service_date", "trip_id", "stop_sequence")
);
--> statement-breakpoint
CREATE INDEX "stop_boarding_events_stop_idx"
	ON "stop_boarding_events" ("stop_id", "dow", "hour");
--> statement-breakpoint
CREATE INDEX "stop_boarding_events_dow_idx"
	ON "stop_boarding_events" ("dow", "hour", "stop_id");
--> statement-breakpoint
CREATE INDEX "stop_boarding_events_time_idx"
	ON "stop_boarding_events" ("event_time");
