import { sql } from 'drizzle-orm';
import { getDb } from '#lib/server/db/index.js';
import type { RequestHandler } from './$types';

const TILE_HEADERS = {
	'content-type': 'application/vnd.mapbox-vector-tile',
	'cache-control': 'public, max-age=300, stale-while-revalidate=3600'
};

export const GET: RequestHandler = async ({ params }) => {
	const z = Number(params.z);
	const x = Number(params.x);
	const y = Number(params.y);

	if (!Number.isInteger(z) || z < 0 || z > 22) {
		return new Response('Invalid zoom', { status: 400 });
	}
	const max = 2 ** z;
	if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= max || y >= max) {
		return new Response('Invalid tile coordinates', { status: 400 });
	}

	const db = getDb();
	const rows = await db.execute(sql`
		with bounds as (
			select st_tileenvelope(${z}, ${x}, ${y}) as geom
		),
		mvt as (
			select
				c.gid,
				c.street_name,
				c.suburb,
				c.direction,
				c.peak,
				c.transit_lane,
				c.bus_lane_hours,
				c.clearway_hours,
				c.public_holiday,
				c.length_m,
				st_asmvtgeom(st_transform(c.geom, 3857), bounds.geom, 4096, 64, true) as geom
			from clearways c, bounds
			where c.clearway_hours IS NOT NULL
				and c.geom && st_transform(bounds.geom, 4326)
		)
		select coalesce(st_asmvt(mvt.*, 'clearways', 4096, 'geom'), ''::bytea) as tile
		from mvt
	`);

	const tile = rows[0]?.tile as Uint8Array | undefined;
	const body = tile ? new Uint8Array(tile).buffer : new ArrayBuffer(0);
	return new Response(body, { headers: TILE_HEADERS });
};
