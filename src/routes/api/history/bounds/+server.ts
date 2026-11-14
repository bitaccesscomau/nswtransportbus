import { historyBounds } from '#lib/server/queries.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => Response.json(await historyBounds());
