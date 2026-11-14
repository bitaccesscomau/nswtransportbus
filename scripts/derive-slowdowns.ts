import { createDb } from './lib/db';

const { client } = createDb({ max: 2 });

try {
	await client`refresh materialized view concurrently slow_segments`;
	console.log('slowdown segments refreshed');
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
} finally {
	await client.end();
}
