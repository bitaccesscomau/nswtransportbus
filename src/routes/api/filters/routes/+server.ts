import { searchRoutes } from '#lib/server/queries.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) =>
	Response.json({ routes: await searchRoutes(url.searchParams.get('q') ?? '') });
