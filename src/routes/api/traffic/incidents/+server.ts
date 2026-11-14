import { trafficIncidentFeatures } from '#lib/server/queries.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () =>
	Response.json(await trafficIncidentFeatures(), {
		headers: { 'cache-control': 'public, max-age=30' }
	});
