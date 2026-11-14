import { isDatabaseReady, networkSummary } from '#lib/server/queries.js';
export const load = async () => {
	try {
		if (!(await isDatabaseReady())) {
			return { ready: false, summary: null };
		}
		return { ready: true, summary: await networkSummary() };
	} catch (error) {
		console.error('network summary failed', error);
		return { ready: false, summary: null };
	}
};
