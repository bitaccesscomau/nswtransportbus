import { drizzle } from 'drizzle-orm/postgres-js';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import type { Sql } from 'postgres';
import * as liveSchema from '../../src/lib/server/db/live-schema';
import * as schema from '../../src/lib/server/db/schema';

const fullSchema = { ...schema, ...liveSchema };

export type Db = PostgresJsDatabase<typeof fullSchema>;
export type Client = Sql<Record<string, unknown>>;

export function createDb(options: { max?: number } = {}): { db: Db; client: Client } {
	const url = process.env.DATABASE_URL;
	if (!url) {
		throw new Error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
	}

	const client = postgres(url, {
		max: options.max ?? 4,
		onnotice: () => {}
	});

	return { db: drizzle(client, { schema: fullSchema }), client };
}

export { fullSchema as schema };
