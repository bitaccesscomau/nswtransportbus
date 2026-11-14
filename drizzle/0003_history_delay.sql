-- Fast lookup of the most recent observed delay for a trip at a point in time.
CREATE INDEX "trip_observations_latest_idx"
	ON "trip_observations" ("trip_id", "service_date", "last_seen" DESC);
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
	SELECT o.delay_s
	FROM trip_observations o
	WHERE o.trip_id = p_trip_id
		AND o.service_date = p_service_date
		AND o.last_seen <= p_at
		AND o.last_seen > p_at - interval '15 minutes'
	ORDER BY o.last_seen DESC
	LIMIT 1
$$;
