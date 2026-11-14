import { error } from '@sveltejs/kit';
import { stopBusyness, stopDetails } from '#lib/server/queries.js';

export const load = async ({ params }) => {
	const stop = await stopDetails(params.stopId);
	if (!stop) error(404, 'Stop not found');

	return {
		stop,
		busyness: await stopBusyness(params.stopId)
	};
};
