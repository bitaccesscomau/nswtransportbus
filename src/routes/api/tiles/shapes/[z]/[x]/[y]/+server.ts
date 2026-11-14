import { sql } from 'drizzle-orm';
import { getDb } from '#lib/server/db/index.js';
import type { RequestHandler } from './$types';

const TILE_HEADERS = {
	'content-type': 'application/vnd.mapbox-vector-tile',
	'cache-control': 'public, max-age=30, stale-while-revalidate=300'
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

	const tolerance = Math.max(360 / (2 ** z * 4096), 0.000005);
	const db = getDb();

	const rows = await db.execute(sql`
		with bounds as (
			select st_tileenvelope(${z}, ${x}, ${y}) as geom
		),
		lines as (
			select
				l.shape_id,
				sr.route_id,
				rp.minutes_per_km,
				st_simplifypreservetopology(l.geom, ${tolerance}) as geom
			from shape_lines l
			join lateral (
				select route_id
				from shape_routes sr
				where sr.feed_version_id = l.feed_version_id and sr.shape_id = l.shape_id
				limit 1
			) sr on true
			left join route_paces rp
				on rp.feed_version_id = l.feed_version_id and rp.route_id = sr.route_id
			cross join bounds
			where l.feed_version_id = active_feed_version()
				and l.geom && st_transform(bounds.geom, 4326)
		),
		mvt as (
			select
				shape_id,
				route_id,
				minutes_per_km,
				st_asmvtgeom(st_transform(lines.geom, 3857), bounds.geom, 4096, 64, true) as geom
			from lines, bounds
		)
		select coalesce(st_asmvt(mvt.*, 'shapes', 4096, 'geom'), ''::bytea) as tile
		from mvt
	`);

	const tile = rows[0]?.tile as Uint8Array | undefined;
	const body = tile ? new Uint8Array(tile).buffer : new ArrayBuffer(0);
	return new Response(body, { headers: TILE_HEADERS });
};
