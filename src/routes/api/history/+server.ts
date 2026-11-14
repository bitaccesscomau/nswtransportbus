import { snapshotAt } from '#lib/server/queries.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const raw = url.searchParams.get('at');
	const requested = raw ? new Date(raw) : new Date();

	if (Number.isNaN(requested.getTime())) {
		return new Response('Invalid at timestamp', { status: 400 });
	}

	const at = requested.getTime() > Date.now() ? new Date() : requested;
	return Response.json({ at: at.toISOString(), vehicles: await snapshotAt(at) });
};
