#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

ZIP=".data/bus-lanes/redbuslane.zip"
BASE="RedBusLane"
URL="https://opendata.transport.nsw.gov.au/data/dataset/97efe829-3488-4af5-b34b-86553d5011c2/resource/68d85c44-273d-42ce-a823-2bf81d270e2b/download/redbuslane.zip"

mkdir -p .data/bus-lanes
if [ ! -f "$ZIP" ]; then
	echo "downloading TfNSW bus lanes…"
	curl -sS -L -o "$ZIP" "$URL"
fi
unzip -o -q "$ZIP" -d .data/bus-lanes

for ext in shp shx dbf prj cpg; do
	docker compose cp ".data/bus-lanes/$BASE.$ext" "db:/tmp/redbuslane.$ext" >/dev/null
done

echo "loading bus lanes into PostGIS…"
docker compose exec -T db psql -U nswbus -d nswbus -v ON_ERROR_STOP=1 \
	-c 'drop table if exists bus_lanes_raw cascade' >/dev/null
docker compose exec -T db sh -c \
	'shp2pgsql -c -s 3308 -D -I -W UTF-8 /tmp/redbuslane.shp public.bus_lanes_raw' \
	| docker compose exec -T db psql -U nswbus -d nswbus -v ON_ERROR_STOP=1 >/dev/null

docker compose exec -T db psql -U nswbus -d nswbus -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
TRUNCATE bus_lanes;
INSERT INTO bus_lanes (
	gid, road_name, operating, data_captured, lane_type, status, length_m, properties, geom
)
SELECT
	gid,
	nullif(trim(road_name), ''),
	nullif(trim(operating_), ''),
	datacaptur,
	nullif(trim(lane_type), ''),
	nullif(trim(status), ''),
	st_length_,
	to_jsonb(raw) - 'geom',
	st_multi(st_transform(geom, 4326))
FROM bus_lanes_raw raw;

DROP TABLE bus_lanes_raw;
ANALYZE bus_lanes;
SQL

echo "bus lanes imported"
