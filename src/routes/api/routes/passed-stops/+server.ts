import { routePassedStops } from '#lib/server/queries.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const shapeId = url.searchParams.get('shapeId');
	if (!shapeId) return new Response('shapeId is required', { status: 400 });

	return Response.json(await routePassedStops(shapeId), {
		headers: { 'cache-control': 'public, max-age=60' }
	});
};
