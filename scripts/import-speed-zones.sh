#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

ZIP=".data/speed-zones/speedzones.zip"
BASE="Speed_Zones"
URL="https://opendata.transport.nsw.gov.au/data/dataset/4253a054-b377-4b5b-83d1-71385bb6ff33/resource/72cd0f29-f231-4c8c-a885-595946f3f202/download/speedzones.zip"

mkdir -p .data/speed-zones
if [ ! -f "$ZIP" ]; then
	echo "downloading TfNSW speed zones…"
	curl -sS -L -o "$ZIP" "$URL"
fi
unzip -o -q "$ZIP" -d .data/speed-zones

for ext in shp shx dbf prj; do
	docker compose cp ".data/speed-zones/$BASE.$ext" "db:/tmp/speedzones.$ext" >/dev/null
done

echo "loading speed zones into PostGIS…"
docker compose exec -T db psql -U nswbus -d nswbus -v ON_ERROR_STOP=1 \
	-c 'drop table if exists speed_zones_raw cascade' >/dev/null
docker compose exec -T db sh -c \
	'shp2pgsql -c -s 3857 -D -I -W UTF-8 /tmp/speedzones.shp public.speed_zones_raw' \
	| docker compose exec -T db psql -U nswbus -d nswbus -v ON_ERROR_STOP=1 >/dev/null

docker compose exec -T db psql -U nswbus -d nswbus -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
TRUNCATE speed_zones;
INSERT INTO speed_zones (
	gid, speed_limit, zone_type, status, direction, properties, geom
)
SELECT
	gid,
	nullif(regexp_replace(coalesce(nullif(trim(sz_speed), ''), speed, ''), '[^0-9]', '', 'g'), '')::int,
	nullif(trim(sz_type), ''),
	nullif(trim(sz_status), ''),
	nullif(trim(sz_directi), ''),
	to_jsonb(raw) - 'geom',
	st_multi(st_transform(geom, 4326))
FROM speed_zones_raw raw
WHERE geom IS NOT NULL
	AND NOT st_isempty(geom)
	AND st_transform(geom, 4326) IS NOT NULL;

DROP TABLE speed_zones_raw;
ANALYZE speed_zones;
SQL

echo "speed zones imported"
