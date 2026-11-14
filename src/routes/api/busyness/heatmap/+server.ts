import { busynessHeatmap } from '#lib/server/queries.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const dow = Number(url.searchParams.get('dow'));
	const hour = Number(url.searchParams.get('hour'));

	if (!Number.isInteger(dow) || dow < 1 || dow > 7) {
		return new Response('dow must be 1-7', { status: 400 });
	}
	if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
		return new Response('hour must be 0-23', { status: 400 });
	}

	return Response.json({ stops: await busynessHeatmap(dow, hour) });
};
