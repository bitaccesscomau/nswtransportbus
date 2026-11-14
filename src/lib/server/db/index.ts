import { DATABASE_URL } from '$app/env/private';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import type { Sql } from 'postgres';
import * as liveSchema from './live-schema';
import * as schema from './schema';

const fullSchema = { ...schema, ...liveSchema };

export type Db = PostgresJsDatabase<typeof fullSchema>;
export type Client = Sql<Record<string, unknown>>;

let client: Client | undefined;
let database: Db | undefined;

export function getDb(): Db {
	if (database) return database;

	const url = DATABASE_URL;
	if (!url) {
		throw new Error('DATABASE_URL is not set. Copy .env.example to .env and restart the server.');
	}

	client = postgres(url, { max: 10, onnotice: () => {} });
	database = drizzle(client, { schema: fullSchema });
	return database;
}

export async function closeDb(): Promise<void> {
	await client?.end();
	client = undefined;
	database = undefined;
}
