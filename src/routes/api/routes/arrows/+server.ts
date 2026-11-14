import { routeArrowGeometry } from '#lib/server/queries.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const shapeId = url.searchParams.get('shapeId');
	if (!shapeId) return new Response('shapeId is required', { status: 400 });

	const geometry = await routeArrowGeometry(shapeId);
	if (!geometry) return new Response('Shape not found', { status: 404 });

	return Response.json(geometry);
};
