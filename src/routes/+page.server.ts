import { isDatabaseReady, networkSummary } from '#lib/server/queries.js';
export const load = async () => {
	const isVercel = process.env.VERCEL === '1';
	try {
		if (!(await isDatabaseReady())) {
			return { ready: false, summary: null, isVercel };
		}
		return { ready: true, summary: await networkSummary(), isVercel };
	} catch (error) {
		console.error('network summary failed', error);
		return { ready: false, summary: null, isVercel };
	}
};
