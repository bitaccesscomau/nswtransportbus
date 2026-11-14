import { sql } from 'drizzle-orm';
import { createDb } from './lib/db';

const { db, client } = createDb({ max: 1 });
const days = Number(process.env.RETENTION_DAYS ?? 30);

try {
	const result = await db.execute<{ drop_old_partitions: number }>(
		sql`select drop_old_partitions(${days})`
	);
	const dropped = result[0]?.drop_old_partitions ?? 0;
	console.log(`retention ${days}d: dropped ${dropped} partition(s)`);
} finally {
	await client.end();
}
