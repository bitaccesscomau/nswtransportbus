import { readFile } from 'node:fs/promises';
import * as XLSX from 'xlsx';
import { trafficLights } from '../src/lib/server/db/schema';
import { createDb } from './lib/db';

const SOURCE_URL =
	process.env.TRAFFIC_LIGHTS_URL ??
	'https://opendata.transport.nsw.gov.au/data/dataset/93ba5c23-f46c-45d7-98ed-96022b7ea626/resource/406ac670-b3ad-4474-9284-c03d444a1aec/download/traffic-lights-location-data-june-2026.xlsx';

function text(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	const trimmed = String(value).trim();
	return trimmed ? trimmed : null;
}

function numberOrNull(value: unknown): number | null {
	if (value === null || value === undefined || value === '') return null;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

const { db, client } = createDb({ max: 2 });

try {
	const localFile = process.env.TRAFFIC_LIGHTS_FILE;
	let workbook: XLSX.WorkBook;

	if (localFile) {
		workbook = XLSX.read(await readFile(localFile), { type: 'buffer' });
	} else {
		const response = await fetch(SOURCE_URL, { signal: AbortSignal.timeout(180_000) });
		if (!response.ok) {
			throw new Error(`GET ${SOURCE_URL} -> ${response.status} ${response.statusText}`);
		}
		workbook = XLSX.read(await response.arrayBuffer(), { type: 'array' });
	}

	const sheet = workbook.Sheets[workbook.SheetNames[0]];
	if (!sheet) throw new Error('The workbook has no sheets.');

	const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
	const rows: (typeof trafficLights.$inferInsert)[] = [];
	let skipped = 0;

	for (const row of raw) {
		const equipmentId = text(row.Equipment_ID);
		const lat = numberOrNull(row.Latitude);
		const lon = numberOrNull(row.Longitude);

		if (!equipmentId || lat === null || lon === null) {
			skipped += 1;
			continue;
		}

		rows.push({
			equipmentId,
			assetType: text(row.Asset_Type),
			street1: text(row['Street 1']),
			street2: text(row['Street 2']),
			street3: text(row['Street 3']),
			suburb: text(row.Suburb),
			rmsRegion: text(row.RMS_Region),
			lat,
			lon
		});
	}

	await db.transaction(async (tx) => {
		await tx.delete(trafficLights);
		for (let index = 0; index < rows.length; index += 500) {
			await tx.insert(trafficLights).values(rows.slice(index, index + 500));
		}
	});

	console.log(`Imported ${rows.length} traffic lights (${skipped} skipped).`);
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
} finally {
	await client.end();
}
