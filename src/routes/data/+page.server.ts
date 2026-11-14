import { feedHealth } from '#lib/server/queries.js';

export const load = async () => {
	try {
		return { ready: true, health: await feedHealth() };
	} catch (error) {
		console.error('feed health failed', error);
		return { ready: false, health: null };
	}
};
