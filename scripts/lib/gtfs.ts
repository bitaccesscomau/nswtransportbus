import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { Readable, type Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { parse } from 'csv-parse';
import { unzipSync } from 'fflate';

type CopyClient = {
	unsafe(query: string): { writable(): Promise<Writable> };
};

const NULL_TOKEN = '\\N';

export async function* readCsv(path: string): AsyncGenerator<Record<string, string>> {
	const parser = createReadStream(path).pipe(
		parse({
			bom: true,
			columns: true,
			relax_quotes: true,
			skip_empty_lines: true,
			trim: true
		})
	);

	for await (const record of parser) {
		yield record as Record<string, string>;
	}
}

function csvValue(value: unknown): string {
	if (value === null || value === undefined || value === '') return NULL_TOKEN;
	const text = String(value);
	return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function quoteIdent(name: string): string {
	return `"${name.replaceAll('"', '""')}"`;
}

/**
 * Streams rows into Postgres with COPY. Rows must already be in column order.
 */
export async function copyRows(
	sql: CopyClient,
	table: string,
	columns: string[],
	rows: AsyncIterable<unknown[]>
): Promise<number> {
	let count = 0;
	const readable = Readable.from(
		(async function* () {
			yield `${columns.map(quoteIdent).join(',')}\n`;
			for await (const row of rows) {
				count += 1;
				yield `${row.map(csvValue).join(',')}\n`;
			}
		})()
	);

	const command = `copy ${quoteIdent(table)} (${columns
		.map(quoteIdent)
		.join(',')}) from stdin with (format csv, header true, null '\\N')`;

	const writable = await sql.unsafe(command).writable();
	await pipeline(readable, writable);
	return count;
}

export async function download(
	url: string,
	apiKey: string,
	destination: string
): Promise<{ bytes: number; sha256: string }> {
	const response = await fetch(url, {
		headers: { Authorization: `apikey ${apiKey}` },
		signal: AbortSignal.timeout(180_000)
	});

	if (!response.ok) {
		const body = await response.text().catch(() => '');
		throw new Error(`GET ${url} -> ${response.status} ${response.statusText}${body ? `: ${body.slice(0, 300)}` : ''}`);
	}

	const buffer = Buffer.from(await response.arrayBuffer());
	await writeFile(destination, buffer);

	return { bytes: buffer.byteLength, sha256: createHash('sha256').update(buffer).digest('hex') };
}

export async function extractGtfs(zipPath: string, destination: string): Promise<string[]> {
	const archive = unzipSync(new Uint8Array(await readFile(zipPath)));
	const written: string[] = [];

	for (const [name, data] of Object.entries(archive)) {
		if (!name.toLowerCase().endsWith('.txt')) continue;
		const file = name.split('/').pop();
		if (!file) continue;
		const target = `${destination}/${file}`;
		await writeFile(target, data);
		written.push(file);
	}

	return written;
}

export function parseTimeSeconds(value: string | undefined): number | null {
	if (!value) return null;
	const parts = value.trim().split(':');
	if (parts.length !== 3) return null;
	const [hours, minutes, seconds] = parts.map(Number);
	if ([hours, minutes, seconds].some((part) => Number.isNaN(part))) return null;
	return hours * 3600 + minutes * 60 + seconds;
}

export function parseGtfsDate(value: string | undefined): string | null {
	if (!value || value.length !== 8) return null;
	return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

export function intOrNull(value: string | undefined): number | null {
	if (value === undefined || value === '') return null;
	const parsed = Number.parseInt(value, 10);
	return Number.isNaN(parsed) ? null : parsed;
}

export function floatOrNull(value: string | undefined): number | null {
	if (value === undefined || value === '') return null;
	const parsed = Number.parseFloat(value);
	return Number.isNaN(parsed) ? null : parsed;
}

export function textOrNull(value: string | undefined): string | null {
	return value === undefined || value === '' ? null : value;
}
