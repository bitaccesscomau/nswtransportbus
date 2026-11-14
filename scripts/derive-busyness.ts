import { sql } from 'drizzle-orm';
import { createDb } from './lib/db';
import { deriveBusyness } from './lib/busyness';

function arg(name: string): string | undefined {
	const index = process.argv.indexOf(`--${name}`);
	if (index === -1) return undefined;
	const value = process.argv[index + 1];
	return value && !value.startsWith('--') ? value : '';
}

const { db, client } = createDb({ max: 2 });
const days = Number(arg('days') ?? 1);
const to = arg('to') ? new Date(arg('to')!) : new Date();
const from = arg('from')
	? new Date(arg('from')!)
	: new Date(to.getTime() - (Number.isFinite(days) && days > 0 ? days : 1) * 86_400_000);

try {
	const started = Date.now();
	await deriveBusyness(db, from, to);

	const rows = await db.execute<{ events: number; samples: number }>(sql`
		select
			count(*)::int as "events",
			count(*) filter (where net_load is not null)::int as "samples"
		from stop_boarding_events
		where event_time >= ${from.toISOString()}::timestamptz
			and event_time < ${to.toISOString()}::timestamptz
	`);

	console.log(
		`derived ${rows[0]?.events ?? 0} stop events (${rows[0]?.samples ?? 0} with occupancy) ` +
			`in ${((Date.now() - started) / 1000).toFixed(1)}s`
	);
} finally {
	await client.end();
}
