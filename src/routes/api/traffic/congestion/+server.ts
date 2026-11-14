import { busCongestionFeatures } from '#lib/server/queries.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () =>
	Response.json(await busCongestionFeatures(), {
		headers: { 'cache-control': 'public, max-age=15' }
	});
