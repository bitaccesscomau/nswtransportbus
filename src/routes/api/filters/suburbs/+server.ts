import { searchSuburbs } from '#lib/server/queries.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) =>
	Response.json({ suburbs: await searchSuburbs(url.searchParams.get('q') ?? '') });
