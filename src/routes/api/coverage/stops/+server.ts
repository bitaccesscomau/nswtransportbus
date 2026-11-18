import { coverageStops } from '#lib/server/queries.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const active = url.searchParams.get('active') === '1';
	let activeAt: Date | null = null;

	if (active) {
		const raw = url.searchParams.get('at') ?? 'now';
		activeAt = raw === 'now' ? new Date() : new Date(raw);
		if (Number.isNaN(activeAt.getTime())) {
			return new Response('Invalid at timestamp', { status: 400 });
		}
	}

	return Response.json(await coverageStops(activeAt));
};
