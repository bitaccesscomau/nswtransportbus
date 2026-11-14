#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

ZIP=".data/suburbs/SAL_2021_AUST_GDA2020_SHP.zip"
BASE="SAL_2021_AUST_GDA2020"
URL="https://www.abs.gov.au/statistics/standards/australian-statistical-geography-standard-asgs/edition-3-july-2021-june-2026/access-and-downloads/digital-boundary-files/SAL_2021_AUST_GDA2020_SHP.zip"

mkdir -p .data/suburbs
if [ ! -f "$ZIP" ]; then
	echo "downloading ABS SAL 2021 boundaries (100 MB)…"
	curl -sS -L -o "$ZIP" "$URL"
fi

unzip -o -q "$ZIP" -d .data/suburbs
for ext in shp shx dbf prj cpg; do
	docker compose cp ".data/suburbs/$BASE.$ext" "db:/tmp/sal.$ext" >/dev/null
done

echo "loading suburb boundaries into PostGIS…"
docker compose exec -T db sh -c \
	'apk add --no-cache libintl >/dev/null 2>&1 || true; shp2pgsql -d -s 7844 -D -I -W UTF-8 /tmp/sal.shp public.suburbs_raw' \
	| docker compose exec -T db psql -U nswbus -d nswbus >/dev/null

docker compose exec -T db psql -U nswbus -d nswbus <<'SQL' >/dev/null
INSERT INTO suburbs (sal_code, name, state, geom)
SELECT
	sal_code21,
	regexp_replace(sal_name21, ' \(NSW\)$', ''),
	ste_name21,
	st_multi(st_transform(geom, 4326))
FROM suburbs_raw
WHERE ste_name21 = 'New South Wales' AND geom IS NOT NULL
ON CONFLICT (sal_code) DO UPDATE SET
	name = excluded.name,
	state = excluded.state,
	geom = excluded.geom;

DROP TABLE suburbs_raw;
SELECT refresh_stop_suburbs(active_feed_version());
SQL

echo "suburbs imported"
