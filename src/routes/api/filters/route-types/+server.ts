import { routeTypeCounts } from '#lib/server/queries.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => Response.json({ types: await routeTypeCounts() });
