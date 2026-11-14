import { stopDetails } from '#lib/server/queries.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
	const stop = await stopDetails(params.stopId);
	if (!stop) return Response.json({ error: 'Stop not found' }, { status: 404 });
	return Response.json(stop);
};
