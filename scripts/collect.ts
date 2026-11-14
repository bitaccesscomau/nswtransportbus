import { lt, sql } from 'drizzle-orm';
import { liveVehicles, pollRuns } from '../src/lib/server/db/schema';
import {
	trafficIncidents,
	tripDelays,
	tripObservations,
	vehiclePositions
} from '../src/lib/server/db/live-schema';
import { createDb } from './lib/db';
import { deriveBusyness } from './lib/busyness';
import { normaliseIncidents, type IncidentFeed } from './lib/traffic';
import {
	decodeFeed,
	normaliseTripDelays,
	normaliseTripObservations,
	normaliseVehiclePositions,
	type VehiclePositionRow
} from './lib/gtfs-realtime';

const apiKey = process.env.TFNSW_API_KEY;
if (!apiKey) {
	throw new Error('TFNSW_API_KEY is not set. Add it to .env before starting the collector.');
}

const positionUrl =
	process.env.VEHICLE_POSITIONS_URL ?? 'https://api.transport.nsw.gov.au/v1/gtfs/vehiclepos/buses';
const tripUrl =
	process.env.TRIP_UPDATES_URL ?? 'https://api.transport.nsw.gov.au/v1/gtfs/realtime/buses';
const positionInterval = Number(process.env.POSITION_INTERVAL_MS ?? 15_000);
const tripInterval = Number(process.env.TRIP_UPDATE_INTERVAL_MS ?? 60_000);
const retentionDays = Number(process.env.RETENTION_DAYS ?? 30);

if (!Number.isFinite(positionInterval) || positionInterval < 5_000) {
	throw new Error('POSITION_INTERVAL_MS must be at least 5000.');
}
if (!Number.isFinite(tripInterval) || tripInterval < 10_000) {
	throw new Error('TRIP_UPDATE_INTERVAL_MS must be at least 10000.');
}

const { db, client } = createDb({ max: 4 });
const trafficBase = 'https://api.transport.nsw.gov.au/v1/live/hazards';
const trafficSources = ['incident', 'roadwork', 'flood', 'majorevent', 'fire'];
let stopping = false;

process.once('SIGINT', () => {
	stopping = true;
	console.log('\nstopping after the current cycle');
});
process.once('SIGTERM', () => {
	stopping = true;
	console.log('\nstopping after the current cycle');
});

function sleep(ms: number): Promise<void> {
	const { promise, resolve } = Promise.withResolvers<void>();
	setTimeout(resolve, ms);
	return promise;
}

function* chunks<T>(items: T[], size: number): Generator<T[]> {
	for (let index = 0; index < items.length; index += size) {
		yield items.slice(index, index + size);
	}
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function fetchFeed(url: string): Promise<{ bytes: Uint8Array; status: number }> {
	const response = await fetch(url, {
		headers: { Authorization: `apikey ${apiKey}` },
		signal: AbortSignal.timeout(25_000)
	});

	if (!response.ok) {
		const body = await response.text().catch(() => '');
		throw new Error(
			`GET ${url} -> ${response.status} ${response.statusText}${body ? `: ${body.slice(0, 200)}` : ''}`
		);
	}

	return { bytes: new Uint8Array(await response.arrayBuffer()), status: response.status };
}

async function startPoll(feed: string): Promise<number> {
	const [run] = await db
		.insert(pollRuns)
		.values({ feed, startedAt: new Date() })
		.returning({ id: pollRuns.id });
	return run.id;
}

async function finishPoll(
	id: number,
	values: { httpStatus?: number; entities?: number; bytes?: number; error?: string }
) {
	await db
		.update(pollRuns)
		.set({
			finishedAt: new Date(),
			httpStatus: values.httpStatus ?? null,
			entities: values.entities ?? null,
			bytes: values.bytes ?? null,
			error: values.error ?? null
		})
		.where(sql`${pollRuns.id} = ${id}`);
}

function vehiclePositionValues(row: VehiclePositionRow, pollId: number) {
	return {
		observedAt: row.observedAt,
		serviceDate: row.serviceDate,
		pollId,
		entityId: row.entityId,
		vehicleId: row.vehicleId,
		tripId: row.tripId,
		routeId: row.routeId,
		directionId: row.directionId,
		lat: row.lat,
		lon: row.lon,
		bearing: row.bearing,
		speedMps: row.speedMps,
		currentStopSequence: row.currentStopSequence,
		stopId: row.stopId,
		currentStatus: row.currentStatus,
		congestion: row.congestion,
		occupancy: row.occupancy,
		feedTimestamp: row.feedTimestamp
	};
}

function liveVehicleValues(row: VehiclePositionRow) {
	return {
		vehicleKey: row.vehicleKey,
		entityId: row.entityId,
		vehicleId: row.vehicleId,
		tripId: row.tripId,
		serviceDate: row.serviceDate,
		routeId: row.routeId,
		directionId: row.directionId,
		lat: row.lat,
		lon: row.lon,
		bearing: row.bearing,
		speedMps: row.speedMps,
		currentStopSequence: row.currentStopSequence,
		stopId: row.stopId,
		currentStatus: row.currentStatus,
		congestion: row.congestion,
		occupancy: row.occupancy,
		observedAt: row.observedAt,
		feedTimestamp: row.feedTimestamp
	};
}

async function pollPositions() {
	const pollId = await startPoll('vehicle_positions');
	let httpStatus: number | undefined;

	try {
		const response = await fetchFeed(positionUrl);
		httpStatus = response.status;
		const observedAt = new Date();
		const feed = decodeFeed(response.bytes);
		const rows = normaliseVehiclePositions(feed, observedAt);

		const days = new Set(rows.map((row) => row.observedAt.toISOString().slice(0, 10)));
		for (const day of days) {
			await db.execute(sql`select ensure_daily_partition(${day}::date)`);
		}

		for (const chunk of chunks(rows, 750)) {
			await db.insert(vehiclePositions).values(chunk.map((row) => vehiclePositionValues(row, pollId)));
		}

		for (const chunk of chunks(rows, 500)) {
			await db
				.insert(liveVehicles)
				.values(chunk.map(liveVehicleValues))
				.onConflictDoUpdate({
					target: liveVehicles.vehicleKey,
					set: {
						entityId: sql`excluded.entity_id`,
						vehicleId: sql`excluded.vehicle_id`,
						tripId: sql`excluded.trip_id`,
						serviceDate: sql`excluded.service_date`,
						routeId: sql`excluded.route_id`,
						directionId: sql`excluded.direction_id`,
						lat: sql`excluded.lat`,
						lon: sql`excluded.lon`,
						bearing: sql`excluded.bearing`,
						speedMps: sql`excluded.speed_mps`,
						currentStopSequence: sql`excluded.current_stop_sequence`,
						stopId: sql`excluded.stop_id`,
						currentStatus: sql`excluded.current_status`,
						congestion: sql`excluded.congestion`,
						occupancy: sql`excluded.occupancy`,
						observedAt: sql`excluded.observed_at`,
						feedTimestamp: sql`excluded.feed_timestamp`
					}
				});
		}

		await db
			.delete(liveVehicles)
			.where(lt(liveVehicles.observedAt, new Date(Date.now() - 5 * 60 * 1000)));

		await finishPoll(pollId, {
			httpStatus,
			entities: feed.entity?.length ?? 0,
			bytes: response.bytes.byteLength
		});

		console.log(
			`positions ${observedAt.toISOString()} ${rows.length} rows, ${feed.entity?.length ?? 0} entities`
		);
	} catch (error) {
		await finishPoll(pollId, { httpStatus, error: message(error) });
		throw error;
	}
}

async function pollTripUpdates() {
	const pollId = await startPoll('trip_updates');
	let httpStatus: number | undefined;

	try {
		const response = await fetchFeed(tripUrl);
		httpStatus = response.status;
		const observedAt = new Date();
		const feed = decodeFeed(response.bytes);
		const rows = normaliseTripObservations(feed, observedAt);

		const months = new Set(rows.map((row) => `${row.serviceDate.slice(0, 7)}-01`));
		for (const month of months) {
			await db.execute(sql`select ensure_monthly_trip_partition(${month}::date)`);
		}

		for (const chunk of chunks(rows, 500)) {
			await db
				.insert(tripObservations)
				.values(chunk)
				.onConflictDoUpdate({
					target: [
						tripObservations.serviceDate,
						tripObservations.tripId,
						tripObservations.stopSequence
					],
					set: {
						stopId: sql`excluded.stop_id`,
						startTime: sql`excluded.start_time`,
						predictedArrival: sql`coalesce(excluded.predicted_arrival, ${tripObservations.predictedArrival})`,
						predictedDeparture: sql`coalesce(excluded.predicted_departure, ${tripObservations.predictedDeparture})`,
						delayS: sql`coalesce(excluded.delay_s, ${tripObservations.delayS})`,
						scheduleRelationship: sql`excluded.schedule_relationship`,
						departureOccupancy: sql`coalesce(excluded.departure_occupancy, ${tripObservations.departureOccupancy})`,
						lastSeen: sql`excluded.last_seen`,
						observations: sql`${tripObservations.observations} + 1`
					}
				});
		}

		const delays = normaliseTripDelays(feed, observedAt);
		const delayDay = observedAt.toISOString().slice(0, 10);
		await db.execute(sql`select ensure_daily_trip_delay_partition(${delayDay}::date)`);
		for (const chunk of chunks(delays, 1000)) {
			await db.insert(tripDelays).values(chunk).onConflictDoNothing();
		}

		await finishPoll(pollId, {
			httpStatus,
			entities: feed.entity?.length ?? 0,
			bytes: response.bytes.byteLength
		});

		console.log(
			`trip_updates ${observedAt.toISOString()} ${rows.length} near-arrival rows, ${delays.length} trip delays, ${feed.entity?.length ?? 0} entities`
		);
	} catch (error) {
		await finishPoll(pollId, { httpStatus, error: message(error) });
		throw error;
	}
}

async function pollTrafficSource(source: string) {
	const pollId = await startPoll(`traffic_${source}`);
	let httpStatus: number | undefined;

	try {
		const response = await fetchFeed(`${trafficBase}/${source}/open`);
		httpStatus = response.status;
		const payload = JSON.parse(new TextDecoder().decode(response.bytes)) as IncidentFeed;
		const observedAt = new Date();
		const rows = normaliseIncidents(source, payload, observedAt);

		for (const chunk of chunks(rows, 200)) {
			await db
				.insert(trafficIncidents)
				.values(chunk)
				.onConflictDoUpdate({
					target: trafficIncidents.id,
					set: {
						source: sql`excluded.source`,
						category: sql`excluded.category`,
						kind: sql`excluded.kind`,
						headline: sql`excluded.headline`,
						displayName: sql`excluded.display_name`,
						roads: sql`excluded.roads`,
						suburbs: sql`excluded.suburbs`,
						advice: sql`excluded.advice`,
						expectedDelay: sql`excluded.expected_delay`,
						isMajor: sql`excluded.is_major`,
						impactingNetwork: sql`excluded.impacting_network`,
						publicTransport: sql`excluded.public_transport`,
						startsAt: sql`excluded.starts_at`,
						endsAt: sql`excluded.ends_at`,
						updatedAt: sql`excluded.updated_at`,
						lat: sql`excluded.lat`,
						lon: sql`excluded.lon`,
						properties: sql`excluded.properties`,
						lastSeen: sql`excluded.last_seen`
					}
				});
		}

		await db.execute(
			sql`delete from traffic_incidents where source = ${source} and last_seen < ${observedAt.toISOString()}::timestamptz`
		);

		await finishPoll(pollId, {
			httpStatus,
			entities: rows.length,
			bytes: response.bytes.byteLength
		});

		console.log(`traffic ${source} ${rows.length} incidents`);
	} catch (error) {
		await finishPoll(pollId, { httpStatus, error: message(error) });
		throw error;
	}
}

async function applyRetention() {
	const result = await db.execute<{ drop_old_partitions: number }>(
		sql`select drop_old_partitions(${retentionDays})`
	);
	const dropped = result[0]?.drop_old_partitions ?? 0;

	await db.execute(
		sql`delete from poll_runs where started_at < now() - make_interval(days => ${retentionDays})`
	);
	await db.execute(
		sql`delete from stop_boarding_events where event_time < now() - make_interval(days => ${retentionDays})`
	);

	if (dropped > 0) console.log(`retention dropped ${dropped} partition(s)`);
}

async function every(name: string, intervalMs: number, run: () => Promise<void>) {
	let backoff = 0;

	while (!stopping) {
		const started = Date.now();
		try {
			await run();
			backoff = 0;
		} catch (error) {
			console.error(`[${name}] ${message(error)}`);
			backoff = backoff === 0 ? 5_000 : Math.min(backoff * 2, 60_000);
			await sleep(backoff);
			continue;
		}

		const wait = intervalMs - (Date.now() - started);
		if (wait > 0) await sleep(wait);
	}
}

console.log(
	`collector started: positions every ${positionInterval}ms, trip updates every ${tripInterval}ms, retention ${retentionDays}d`
);

try {
	await Promise.all([
		every('positions', positionInterval, pollPositions),
		every('trip_updates', tripInterval, pollTripUpdates),
		every('retention', 6 * 60 * 60 * 1000, applyRetention),
		every('busyness', 5 * 60 * 1000, async () => {
			await deriveBusyness(db, new Date(Date.now() - 2 * 60 * 60 * 1000), new Date());
			console.log(`busyness derived ${new Date().toISOString()}`);
		}),
		every('slowdowns', 15 * 60 * 1000, async () => {
			await client`refresh materialized view concurrently slow_segments`;
			console.log(`slowdown segments refreshed ${new Date().toISOString()}`);
		}),
		every('traffic', 5 * 60 * 1000, async () => {
			for (const source of trafficSources) {
				try {
					await pollTrafficSource(source);
				} catch (error) {
					console.error(`[traffic:${source}] ${message(error)}`);
				}
				await sleep(300);
			}
		})
	]);
} finally {
	await client.end();
}
