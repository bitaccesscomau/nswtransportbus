#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

ZIP=".data/clearways/clearways.zip"
BASE="NSWClearways_20181003"
URL="https://opendata.transport.nsw.gov.au/data/dataset/2c21b56b-8510-4261-8488-2b1db4f8d305/resource/d65c9a04-f7ad-4638-941d-10fba60a20f4/download/nswclearways_20181003_0.zip"

mkdir -p .data/clearways
if [ ! -f "$ZIP" ]; then
	echo "downloading TfNSW clearways…"
	curl -sS -L -o "$ZIP" "$URL"
fi
unzip -o -q "$ZIP" -d .data/clearways

for ext in shp shx dbf prj cpg; do
	docker compose cp ".data/clearways/$BASE.$ext" "db:/tmp/clearways.$ext" >/dev/null
done

echo "loading clearways into PostGIS…"
docker compose exec -T db psql -U nswbus -d nswbus -v ON_ERROR_STOP=1 \
	-c 'drop table if exists clearways_raw cascade' >/dev/null
docker compose exec -T db sh -c \
	'shp2pgsql -c -s 3308 -D -I -W UTF-8 /tmp/clearways.shp public.clearways_raw' \
	| docker compose exec -T db psql -U nswbus -d nswbus -v ON_ERROR_STOP=1 >/dev/null

docker compose exec -T db psql -U nswbus -d nswbus -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
TRUNCATE clearways;
INSERT INTO clearways (
	gid, street_name, suburb, direction, peak, transit_lane,
	bus_lane_hours, clearway_hours, public_holiday, length_m, properties, geom
)
SELECT
	gid,
	nullif(trim(street_nam), ''),
	nullif(trim(suburb), ''),
	nullif(trim(direction), ''),
	nullif(trim(peak), ''),
	nullif(trim(transit_la), ''),
	nullif(trim(bus_lane_h), ''),
	nullif(trim(clearway_h), ''),
	nullif(trim(public_hol), ''),
	shape_len,
	to_jsonb(raw) - 'geom',
	st_multi(st_transform(geom, 4326))
FROM clearways_raw raw;

DROP TABLE clearways_raw;
ANALYZE clearways;
SQL

echo "clearways imported"
