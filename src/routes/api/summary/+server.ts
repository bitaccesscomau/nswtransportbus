import { isDatabaseReady, networkSummary } from '#lib/server/queries.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	if (!(await isDatabaseReady())) {
		return Response.json({ ready: false, summary: null }, { status: 503 });
	}

	return Response.json({ ready: true, summary: await networkSummary() });
};
