import { applyFilters } from '#lib/server/queries.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const suburbs = (url.searchParams.get('suburbs') ?? '')
		.split(',')
		.map((value) => value.trim())
		.filter(Boolean);
	const routeIds = (url.searchParams.get('routes') ?? '')
		.split(',')
		.map((value) => value.trim())
		.filter(Boolean);
	const routeTypes = (url.searchParams.get('types') ?? '')
		.split(',')
		.map((value) => value.trim())
		.filter(Boolean)
		.map((value) => Number(value))
		.filter((value) => Number.isInteger(value));
	const active = url.searchParams.get('active') === '1';
	const rawAt = url.searchParams.get('at') ?? 'now';
	const at = rawAt === 'now' ? new Date() : new Date(rawAt);

	if (Number.isNaN(at.getTime())) {
		return new Response('Invalid at timestamp', { status: 400 });
	}

	return Response.json(await applyFilters({ suburbs, routeIds, routeTypes, active, at }));
};
