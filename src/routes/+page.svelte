<script lang="ts">
	import { onMount } from 'svelte';
	import {
		Activity,
		Clock,
		Filter,
		Gauge,
		Layers,
		MapPin,
		Route,
		Search,
		TriangleAlert,
		X
	} from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import {
		Card,
		CardContent,
		CardHeader,
		CardTitle
	} from '#lib/components/ui/card/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Separator } from '#lib/components/ui/separator/index.js';
	import { Switch } from '#lib/components/ui/switch/index.js';
	import NetworkMap from '#lib/components/network-map.svelte';
	import PlaybackTimeline from '#lib/components/playback-timeline.svelte';
	import { formatNumber } from '#lib/format.js';
	import { ROUTE_PACE_COLORS, ROUTE_PACE_SCALE } from '#lib/route-pace.js';
	import { SLOWDOWN_COLORS, SLOWDOWN_SCALE } from '#lib/slowdown.js';
	import { haversineMeters, incidentColor } from '#lib/geo.js';
	import { routeTypeLabel } from '#lib/route-types.js';
	import { confidence, metricLabel, metricValue } from '#lib/settings.svelte.js';
	import type {
		BusynessStop,
		FilterResult,
		FilterRoute,
		FilterRouteType,
		FilterSuburb,
		RouteShapeBounds,
		RouteServing,
		SearchStop,
		StopDetails
	} from '#lib/server/queries.js';
	import type {
		BusCongestionProperties,
		HistoryBounds,
		PassedStopProperties,
		InsightKind,
		InsightResult,
		SimulationResult,
		TrafficIncidentProperties,
		VehicleSnapshot
	} from '#lib/types.js';
	import type { FeatureCollection, Point } from 'geojson';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let query = $state('');
	let results = $state<SearchStop[]>([]);
	let searching = $state(false);
	let selected = $state<StopDetails | null>(null);
	let focus = $state<{ lat: number; lon: number; zoom?: number } | null>(null);
	let showRoutes = $state(true);
	let viewMode = $state<'default' | 'pace' | 'slowdowns'>('default');
	let showStops = $state(true);
	let showSuburbNames = $state(true);
	let showSuburbShading = $state(false);
	let showBusLanes = $state(false);
	let showSpeedZones = $state(false);
	let showClearways = $state(false);
	let showLive = $state(true);
	let liveFromStream = $state<number | null>(null);
	let mode = $state<'live' | 'history'>('live');
	let bounds = $state<{ min: number; max: number } | null>(null);
	let playbackAt = $state(Date.now());
	let playing = $state(false);
	let speed = $state(60);
	let historyVehicles = $state<VehicleSnapshot[] | null>(null);
	let loadingHistory = $state(false);
	let showBusyness = $state(false);
	let heatDow = $state(1);
	let heatHour = $state(12);
	let heatStops = $state<BusynessStop[]>([]);
	let heatLoading = $state(false);
	let heatError = $state<string | null>(null);
	let selectedRoute = $state<RouteServing | null>(null);
	let routeView = $state<{ bounds: [[number, number], [number, number]] } | null>(null);
	let passedStops = $state<FeatureCollection<Point, PassedStopProperties> | null>(null);
	let showPassedStops = $state(true);
	let suburbQuery = $state('');
	let suburbResults = $state<FilterSuburb[]>([]);
	let selectedSuburbs = $state<string[]>([]);
	let routeTypes = $state<FilterRouteType[]>([]);
	let selectedRouteTypes = $state<number[]>([]);
	let routeQuery = $state('');
	let routeResults = $state<FilterRoute[]>([]);
	let selectedRoutes = $state<FilterRoute[]>([]);
	let activeOnly = $state(false);
	let activeMode = $state<'now' | 'time'>('now');
	let activeAt = $state('');
	let filterStopIds = $state<string[] | null>(null);
	let filterRouteIds = $state<string[] | null>(null);
	let filterBounds = $state<[[number, number], [number, number]] | null>(null);
	let filterStopCount = $state<number | null>(null);
	let filterRouteCount = $state<number | null>(null);
	let simScenario = $state<'none' | 'consolidate' | 'express'>('consolidate');
	let simRadius = $state(100);
	let simSkip = $state(3);
	let simDwell = $state(20);
	let simThreshold = $state(5);
	let simLoading = $state(false);
	let simError = $state<string | null>(null);
	let simResult = $state<SimulationResult | null>(null);
	let showSimStops = $state(true);
	let simController: AbortController | null = null;
	let insightKind = $state<InsightKind>('least-used');
	let insightMinEvents = $state(50);
	let insightMinTrips = $state(5);
	let insightRadius = $state(100);
	let insightLoading = $state(false);
	let insightError = $state<string | null>(null);
	let insightResult = $state<InsightResult | null>(null);
	let showInsightStops = $state(true);
	let insightController: AbortController | null = null;
	let filterLoading = $state(false);
	let filterError = $state<string | null>(null);
	let filterRequest = 0;
	let trafficIncidents = $state<FeatureCollection<Point, TrafficIncidentProperties> | null>(null);
	let showIncidents = $state(false);
	let showCongestion = $state(false);
	let showTrafficLights = $state(false);
	let trafficCongestion = $state<FeatureCollection<Point, BusCongestionProperties> | null>(null);
	let scrubTimer: ReturnType<typeof setTimeout> | undefined;
	let inflight: AbortController | null = null;

	const liveCount = $derived(liveFromStream ?? data.summary?.liveVehicles ?? 0);
	const heatFeatures = $derived(buildHeatFeatures(heatStops));
	const simulationStops = $derived.by(() => {
		if (!simResult || !showSimStops) return null;
		return {
			type: 'FeatureCollection',
			features: simResult.removedStops.map((stop) => ({
				type: 'Feature',
				geometry: { type: 'Point', coordinates: [stop.lon, stop.lat] },
				properties: { stopId: stop.stopId, stopName: stop.stopName }
			}))
		} satisfies FeatureCollection<Point, { stopId: string; stopName: string }>;
	});
	const insightStops = $derived.by(() => {
		const result = insightResult;
		if (!result || !showInsightStops) return null;
		return {
			type: 'FeatureCollection',
			features: result.rows.map((row) => ({
				type: 'Feature',
				geometry: { type: 'Point', coordinates: [row.lon, row.lat] },
				properties: { kind: result.kind, label: row.label }
			}))
		} satisfies FeatureCollection<Point, { kind: string; label: string }>;
	});
	const heatTotal = $derived(heatStops.filter((stop) => metricValue(stop) > 0).length);
	const nearbyDisruptions = $derived.by(() => {
		const stop = selected;
		if (!stop || !trafficIncidents) return [];
		return trafficIncidents.features
			.map((feature) => {
				const [lon, lat] = feature.geometry.coordinates;
				return {
					feature,
					distance: haversineMeters(stop.lat, stop.lon, lat, lon)
				};
			})
			.filter((item) => item.distance <= 750)
			.sort((a, b) => a.distance - b.distance)
			.slice(0, 4);
	});

	const routeOptions = $derived([
		...new Map(
			(selected?.routes ?? []).map((route) => [
				`${route.routeId}:${route.directionId}`,
				route
			])
		).values()
	]);

	$effect(() => {
		const text = query.trim();
		if (text.length < 2) {
			results = [];
			return;
		}

		const controller = new AbortController();
		const timer = setTimeout(async () => {
			try {
				searching = true;
				const response = await fetch(`/api/search?q=${encodeURIComponent(text)}`, {
					signal: controller.signal
				});
				if (!response.ok) throw new Error('search failed');
				const body = (await response.json()) as { results: SearchStop[] };
				results = body.results;
			} catch {
				if (!controller.signal.aborted) results = [];
			} finally {
				if (!controller.signal.aborted) searching = false;
			}
		}, 220);

		return () => {
			clearTimeout(timer);
			controller.abort();
		};
	});

	async function refreshRouteTypes() {
		try {
			const response = await fetch('/api/filters/route-types');
			if (!response.ok) return;
			const body = (await response.json()) as { types: FilterRouteType[] };
			routeTypes = body.types;
		} catch {
			// Keep the previous type list.
		}
	}

	async function refreshTrafficIncidents() {
		try {
			const response = await fetch('/api/traffic/incidents');
			if (!response.ok) return;
			trafficIncidents = (await response.json()) as FeatureCollection<
				Point,
				TrafficIncidentProperties
			>;
		} catch {
			// Keep the previous incidents on a failed refresh.
		}
	}

	async function refreshBounds() {
		try {
			const response = await fetch('/api/history/bounds');
			if (!response.ok) return;
			const body = (await response.json()) as HistoryBounds;
			if (!body.min || !body.max) return;

			const next = { min: Date.parse(body.min), max: Date.parse(body.max) };
			bounds = next;
			if (mode === 'live') {
				playbackAt = next.max;
			} else {
				playbackAt = Math.min(Math.max(playbackAt, next.min), next.max);
			}
		} catch {
			// Keep the previous bounds if the bounds request fails.
		}
	}

	async function loadSnapshot(at: number) {
		inflight?.abort();
		const controller = new AbortController();
		inflight = controller;
		loadingHistory = true;

		try {
			const response = await fetch(`/api/history?at=${encodeURIComponent(new Date(at).toISOString())}`, {
				signal: controller.signal
			});
			if (!response.ok) throw new Error('history request failed');
			const body = (await response.json()) as { vehicles: VehicleSnapshot[] };
			if (inflight !== controller) return;
			historyVehicles = body.vehicles;
			liveFromStream = body.vehicles.length;
		} catch {
			// Keep the previous frame on abort or failure.
		} finally {
			if (inflight === controller) loadingHistory = false;
		}
	}

	function enterHistory(at: number) {
		mode = 'history';
		playing = false;
		playbackAt = at;
		historyVehicles = [];
		liveFromStream = 0;
		void loadSnapshot(at);
	}

	function returnLive() {
		mode = 'live';
		playing = false;
		historyVehicles = null;
		liveFromStream = null;
		if (bounds) playbackAt = bounds.max;
	}

	function handleScrub(at: number) {
		mode = 'history';
		playing = false;
		playbackAt = at;
		if (historyVehicles === null) historyVehicles = [];

		clearTimeout(scrubTimer);
		scrubTimer = setTimeout(() => void loadSnapshot(at), 120);
	}

	function togglePlay() {
		if (!bounds) return;
		if (mode === 'live') {
			enterHistory(bounds.min);
			playing = true;
			return;
		}
		if (playbackAt >= bounds.max - 1000) playbackAt = bounds.min;
		playing = !playing;
	}

	function step(seconds: number) {
		if (!bounds) return;
		const at = Math.min(bounds.max, Math.max(bounds.min, playbackAt + seconds * 1000));
		enterHistory(at);
	}

	function toLocalInput(date: Date): string {
		const pad = (value: number) => String(value).padStart(2, '0');
		return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
	}

	function addSuburb(name: string) {
		if (!selectedSuburbs.includes(name)) selectedSuburbs = [...selectedSuburbs, name];
		suburbQuery = '';
		suburbResults = [];
	}

	function removeSuburb(name: string) {
		selectedSuburbs = selectedSuburbs.filter((value) => value !== name);
	}

	function toggleRouteType(routeType: number) {
		selectedRouteTypes = selectedRouteTypes.includes(routeType)
			? selectedRouteTypes.filter((value) => value !== routeType)
			: [...selectedRouteTypes, routeType];
	}

	function addRoute(route: FilterRoute) {
		if (!selectedRoutes.some((value) => value.routeId === route.routeId)) {
			selectedRoutes = [...selectedRoutes, route];
		}
		routeQuery = '';
		routeResults = [];
	}

	function removeRoute(routeId: string) {
		selectedRoutes = selectedRoutes.filter((value) => value.routeId !== routeId);
	}

	function clearFilters() {
		selectedSuburbs = [];
		selectedRouteTypes = [];
		selectedRoutes = [];
		activeOnly = false;
		activeMode = 'now';
		suburbQuery = '';
		routeQuery = '';
		suburbResults = [];
		routeResults = [];
		filterStopIds = null;
		filterRouteIds = null;
		filterBounds = null;
		filterStopCount = null;
		filterRouteCount = null;
	}

	function resetActiveTime() {
		activeAt = toLocalInput(new Date());
	}

	$effect(() => {
		const text = suburbQuery.trim();
		if (text.length < 2) {
			suburbResults = [];
			return;
		}

		const controller = new AbortController();
		const timer = setTimeout(async () => {
			try {
				const response = await fetch(`/api/filters/suburbs?q=${encodeURIComponent(text)}`, {
					signal: controller.signal
				});
				if (!response.ok) throw new Error('suburb search failed');
				const body = (await response.json()) as { suburbs: FilterSuburb[] };
				suburbResults = body.suburbs;
			} catch {
				if (!controller.signal.aborted) suburbResults = [];
			}
		}, 180);

		return () => {
			clearTimeout(timer);
			controller.abort();
		};
	});

	$effect(() => {
		const text = routeQuery.trim();
		if (text.length < 2) {
			routeResults = [];
			return;
		}

		const controller = new AbortController();
		const timer = setTimeout(async () => {
			try {
				const response = await fetch(`/api/filters/routes?q=${encodeURIComponent(text)}`, {
					signal: controller.signal
				});
				if (!response.ok) throw new Error('route search failed');
				const body = (await response.json()) as { routes: FilterRoute[] };
				routeResults = body.routes;
			} catch {
				if (!controller.signal.aborted) routeResults = [];
			}
		}, 180);

		return () => {
			clearTimeout(timer);
			controller.abort();
		};
	});

	$effect(() => {
		const suburbs = selectedSuburbs;
		const routes = selectedRoutes;
		const types = selectedRouteTypes;
		const active = activeOnly;
		const mode = activeMode;
		const at = active && mode === 'time' ? activeAt : '';

		if (suburbs.length === 0 && routes.length === 0 && types.length === 0 && !active) {
			filterRequest += 1;
			filterStopIds = null;
			filterRouteIds = null;
			filterBounds = null;
			filterStopCount = null;
			filterRouteCount = null;
			filterError = null;
			filterLoading = false;
			return;
		}

		const params = new URLSearchParams();
		if (suburbs.length > 0) params.set('suburbs', suburbs.join(','));
		if (types.length > 0) params.set('types', types.join(','));
		if (routes.length > 0) params.set('routes', routes.map((route) => route.routeId).join(','));
		if (active) {
			params.set('active', '1');
			if (mode === 'now') {
				params.set('at', 'now');
			} else {
				const parsed = new Date(at);
				if (Number.isNaN(parsed.getTime())) {
					filterError = 'Choose a valid active time';
					return;
				}
				params.set('at', parsed.toISOString());
			}
		}

		const request = ++filterRequest;
		const timer = setTimeout(async () => {
			filterLoading = true;
			filterError = null;
			try {
				const response = await fetch(`/api/filters/apply?${params}`);
				if (!response.ok) throw new Error('filter request failed');
				const body = (await response.json()) as FilterResult;
				if (request !== filterRequest) return;
				filterStopIds = body.stopIds;
				filterRouteIds = body.routeIds;
				filterBounds = body.bounds;
				filterStopCount = body.stopCount;
				filterRouteCount = body.routeCount;
			} catch {
				if (request === filterRequest) filterError = 'Could not apply filters';
			} finally {
				if (request === filterRequest) filterLoading = false;
			}
		}, 180);

		return () => clearTimeout(timer);
	});

	function sydneyParts(date = new Date()) {
		const parts = new Intl.DateTimeFormat('en-AU', {
			timeZone: 'Australia/Sydney',
			weekday: 'short',
			hour: '2-digit',
			hourCycle: 'h23'
		}).formatToParts(date);
		const weekday = parts.find((part) => part.type === 'weekday')?.value ?? 'Mon';
		const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '12');
		const days: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
		return { dow: days[weekday] ?? 1, hour };
	}

	function buildHeatFeatures(stops: BusynessStop[]): FeatureCollection {
		const visible = stops
			.map((stop) => ({ stop, value: metricValue(stop) }))
			.filter((entry) => entry.value > 0)
			.sort((a, b) => b.value - a.value)
			.slice(0, 500);
		const values = visible.map((entry) => entry.value).sort((a, b) => a - b);
		const quantile = (p: number) => values[Math.floor((values.length - 1) * p)] ?? 0;
		const thresholds = [quantile(0.2), quantile(0.4), quantile(0.6), quantile(0.8)];

		return {
			type: 'FeatureCollection',
			features: visible.map(({ stop, value }) => {
				const level = 1 + thresholds.filter((threshold) => value > threshold).length;
				return {
					type: 'Feature',
					geometry: { type: 'Point', coordinates: [stop.lon, stop.lat] },
					properties: {
						stopId: stop.stopId,
						stopName: stop.stopName,
						value,
						level,
						samples: stop.samples,
						events: stop.events,
						confidence: confidence(stop.samples),
						metricLabel: metricLabel()
					}
				};
			})
		};
	}

	onMount(() => {
		void refreshBounds();
		void refreshRouteTypes();
		void refreshTrafficIncidents();
		const timer = setInterval(() => void refreshBounds(), 60_000);
		const trafficTimer = setInterval(() => void refreshTrafficIncidents(), 120_000);
		const initial = sydneyParts();
		heatDow = initial.dow;
		heatHour = initial.hour;
		activeAt = toLocalInput(new Date());
		return () => {
			clearInterval(timer);
			clearInterval(trafficTimer);
		};
	});

	$effect(() => {
		if (!showCongestion) return;

		let cancelled = false;
		const load = async () => {
			try {
				const response = await fetch('/api/traffic/congestion');
				if (!response.ok) return;
				const body = (await response.json()) as FeatureCollection<
					Point,
					BusCongestionProperties
				>;
				if (!cancelled) trafficCongestion = body;
			} catch {
				// Keep the previous congestion frame.
			}
		};

		void load();
		const timer = setInterval(load, 30_000);
		return () => {
			cancelled = true;
			clearInterval(timer);
		};
	});

	let heatRequest = 0;

	async function loadHeatmap(dow: number, hour: number) {
		const request = ++heatRequest;
		heatLoading = true;
		heatError = null;

		try {
			const response = await fetch(`/api/busyness/heatmap?dow=${dow}&hour=${hour}`);
			if (!response.ok) throw new Error('heatmap request failed');
			const body = (await response.json()) as { stops: BusynessStop[] };
			if (request !== heatRequest) return;
			heatStops = body.stops;
		} catch {
			if (request === heatRequest) {
				heatStops = [];
				heatError = 'Could not load busyness';
			}
		} finally {
			if (request === heatRequest) heatLoading = false;
		}
	}

	$effect(() => {
		if (!showBusyness) return;

		const dow = heatDow;
		const hour = heatHour;
		const timer = setTimeout(() => void loadHeatmap(dow, hour), 150);

		return () => clearTimeout(timer);
	});

	$effect(() => {
		if (!playing || !bounds) return;

		let lastLoad = 0;
		const timer = setInterval(() => {
			const max = bounds?.max;
			if (max === undefined) return;

			const next = Math.min(max, playbackAt + 0.1 * speed * 1000);
			playbackAt = next;
			if (next >= max) playing = false;

			const now = Date.now();
			if (now - lastLoad >= 250) {
				lastLoad = now;
				void loadSnapshot(next);
			}
		}, 100);

		return () => clearInterval(timer);
	});

	function selectRoute(route: RouteServing) {
		if (
			selectedRoute?.routeId === route.routeId &&
			selectedRoute.directionId === route.directionId
		) {
			selectedRoute = null;
			routeView = null;
			passedStops = null;
			return;
		}

		selectedRoute = route;
		routeView = null;
		passedStops = null;
	}

	function clearStop() {
		selected = null;
		selectedRoute = null;
		routeView = null;
		passedStops = null;
	}

	$effect(() => {
		const shapeId = selectedRoute?.shapeId;
		if (!shapeId) {
			passedStops = null;
			return;
		}

		const controller = new AbortController();
		void fetch(`/api/routes/passed-stops?shapeId=${encodeURIComponent(shapeId)}`, {
			signal: controller.signal
		})
			.then(async (response) => {
				if (!response.ok) throw new Error('passed stops request failed');
				return (await response.json()) as FeatureCollection<Point, PassedStopProperties>;
			})
			.then((body) => {
				passedStops = body;
			})
			.catch(() => {
				if (!controller.signal.aborted) passedStops = null;
			});

		return () => controller.abort();
	});

	$effect(() => {
		const shapeId = selectedRoute?.shapeId;
		if (!shapeId) {
			routeView = null;
			return;
		}

		const controller = new AbortController();
		void fetch(`/api/routes/shape?shapeId=${encodeURIComponent(shapeId)}`, {
			signal: controller.signal
		})
			.then(async (response) => {
				if (!response.ok) throw new Error('shape bounds request failed');
				return (await response.json()) as RouteShapeBounds;
			})
			.then((body) => {
				routeView = { bounds: body.bounds };
			})
			.catch(() => {
				if (!controller.signal.aborted) routeView = null;
			});

		return () => controller.abort();
	});

	function handleSimScenarioChange() {
		if (simScenario !== 'none') return;
		simController?.abort();
		simLoading = false;
		simError = null;
		simResult = null;
	}

	async function runSimulation() {
		if (simScenario === 'none') return;
		simController?.abort();
		const controller = new AbortController();
		simController = controller;
		simLoading = true;
		simError = null;

		try {
			const params = new URLSearchParams({
				scenario: simScenario,
				dwell: String(simDwell),
				threshold: String(simThreshold * 60),
				days: '7'
			});
			if (simScenario === 'consolidate') {
				params.set('radius', String(simRadius));
			} else {
				params.set('skip', String(simSkip));
			}

			const response = await fetch(`/api/simulate?${params}`, {
				signal: controller.signal
			});
			if (!response.ok) throw new Error('Simulation failed');
			simResult = (await response.json()) as SimulationResult;
		} catch (error) {
			if (!controller.signal.aborted) {
				simError = error instanceof Error ? error.message : 'Simulation failed';
			}
		} finally {
			if (!controller.signal.aborted) simLoading = false;
		}
	}

	async function runInsight() {
		insightController?.abort();
		const controller = new AbortController();
		insightController = controller;
		insightLoading = true;
		insightError = null;

		try {
			const params = new URLSearchParams({ type: insightKind });
			if (insightKind === 'least-used') {
				params.set('minEvents', String(insightMinEvents));
			} else if (insightKind === 'extension') {
				params.set('minTrips', String(insightMinTrips));
			} else {
				params.set('radius', String(insightRadius));
			}

			const response = await fetch(`/api/insights?${params}`, {
				signal: controller.signal
			});
			if (!response.ok) throw new Error('Analysis failed');
			insightResult = (await response.json()) as InsightResult;
		} catch (error) {
			if (!controller.signal.aborted) {
				insightError = error instanceof Error ? error.message : 'Analysis failed';
			}
		} finally {
			if (!controller.signal.aborted) insightLoading = false;
		}
	}

	async function selectStop(stopId: string, lat?: number, lon?: number) {
		selectedRoute = null;
		routeView = null;
		passedStops = null;

		if (lat !== undefined && lon !== undefined) {
			focus = { lat, lon, zoom: 16 };
		}

		try {
			const response = await fetch(`/api/stops/${encodeURIComponent(stopId)}`);
			if (!response.ok) return;
			const stop = (await response.json()) as StopDetails;
			selected = stop;
			focus = { lat: stop.lat, lon: stop.lon, zoom: 16 };
			query = '';
			results = [];
		} catch {
			// Leave the previous selection in place if the detail request fails.
		}
	}
</script>

<svelte:head>
	<title>Live map · NSW Bus Network</title>
</svelte:head>

<div class="relative h-full">
	<NetworkMap
		{focus}
		selected={selected
			? {
					stopId: selected.stopId,
					lat: selected.lat,
					lon: selected.lon,
					routeIds: [...new Set(selected.routes.map((route) => route.routeId))],
					shapeId: selectedRoute?.shapeId ?? null
				}
			: null}
		{routeView}
		{simulationStops}
		{insightStops}
		{passedStops}
		{showPassedStops}
		smoothHistory={playing && mode === 'history'}
		{filterStopIds}
		{filterRouteIds}
		{filterBounds}
		incidents={trafficIncidents}
		{showIncidents}
		congestion={trafficCongestion}
		{showCongestion}
		{showTrafficLights}
		{showRoutes}
		{viewMode}
		{showStops}
		{showSuburbNames}
		{showSuburbShading}
		{showBusLanes}
		{showSpeedZones}
		{showClearways}
		{showLive}
		history={mode === 'history' ? historyVehicles : null}
		paused={mode === 'history'}
		busyness={showBusyness ? heatFeatures : null}
		{showBusyness}
		onStopSelect={(stopId) => selectStop(stopId)}
		onLiveCount={(count) => (liveFromStream = count)}
	/>

	<aside
		class="absolute inset-x-3 top-3 z-10 flex max-h-[45dvh] w-auto flex-col gap-2.5 overflow-y-auto [&>*]:shrink-0 md:inset-x-auto md:left-3 md:max-h-[calc(100%-1.5rem)] md:w-[352px]"
	>
		<Card class="gap-3 py-3">
			<CardContent class="space-y-3 px-3">
				<div class="relative">
					<Search
						class="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
					/>
					<Input
						bind:value={query}
						class="h-9 pl-8"
						placeholder="Search bus stops…"
						aria-label="Search bus stops"
					/>
				</div>

				{#if results.length > 0}
					<div class="overflow-hidden rounded-md border bg-popover shadow-sm">
						{#each results as result (result.stopId)}
							<button
								type="button"
								class="flex w-full items-center justify-between gap-3 px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted"
								onclick={() => selectStop(result.stopId, result.lat, result.lon)}
							>
								<span class="truncate">{result.stopName}</span>
								<span class="shrink-0 font-mono text-[10px] text-muted-foreground">
									{result.stopId}
								</span>
							</button>
						{/each}
					</div>
				{:else if searching}
					<p class="text-xs text-muted-foreground">Searching…</p>
				{/if}

				<div class="grid grid-cols-4 gap-1.5 text-center">
					{#each [
						{ label: 'Stops', value: data.summary?.stops },
						{ label: 'Routes', value: data.summary?.routes },
						{ label: 'Trips', value: data.summary?.trips },
						{ label: mode === 'live' ? 'Live' : 'Shown', value: liveCount }
					] as stat}
						<div class="rounded-md bg-muted/60 px-1 py-1.5">
							<div class="text-sm font-semibold tabular-nums">{formatNumber(stat.value)}</div>
							<div class="text-[10px] tracking-wide text-muted-foreground uppercase">
								{stat.label}
							</div>
						</div>
					{/each}
				</div>

				<p class="flex items-center gap-1.5 text-[11px] text-muted-foreground">
					<Activity class="size-3" />
					{#if data.summary?.feedFetchedAt}
						Timetable imported {data.summary.feedFetchedAt}
					{:else}
						No timetable imported yet
					{/if}
				</p>
			</CardContent>
		</Card>

		<Card class="gap-2 py-3">
			<CardContent class="space-y-2.5 px-3">
				<p class="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
					<Gauge class="size-3" /> Simulation
				</p>

				<label class="flex items-center justify-between gap-3 text-sm">
					<span>Scenario</span>
					<select
						bind:value={simScenario}
						onchange={handleSimScenarioChange}
						class="h-8 max-w-[190px] rounded-md border bg-background px-2 text-xs"
					>
						<option value="none">None</option>
						<option value="consolidate">Consolidate nearby stops</option>
						<option value="express">Express service</option>
					</select>
				</label>

				{#if simScenario === 'consolidate'}
					<label class="block space-y-1 text-xs">
						<span class="flex justify-between">
							<span>Stop radius</span>
							<span class="tabular-nums text-muted-foreground">{simRadius} m</span>
						</span>
						<input
							type="range"
							min="5"
							max="250"
							step="5"
							bind:value={simRadius}
							class="w-full accent-violet-600"
						/>
					</label>
					<p class="text-[10px] text-muted-foreground">
						Keeps the stop nearest a traffic light, removes its opposite-direction
						counterpart on the same route within 60 m, and never removes two
						consecutive stops on a trip.
					</p>
				{:else if simScenario === 'express'}
					<label class="block space-y-1 text-xs">
						<span class="flex justify-between">
							<span>Skip every</span>
							<span class="tabular-nums text-muted-foreground">{simSkip}th stop</span>
						</span>
						<input
							type="range"
							min="2"
							max="8"
							step="1"
							bind:value={simSkip}
							class="w-full accent-violet-600"
						/>
					</label>
				{:else}
					<p class="text-xs text-muted-foreground">No simulation selected.</p>
				{/if}

				{#if simScenario !== 'none'}
				<label class="block space-y-1 text-xs">
					<span class="flex justify-between">
						<span>Saved dwell per stop</span>
						<span class="tabular-nums text-muted-foreground">{simDwell} s</span>
					</span>
					<input
						type="range"
						min="0"
						max="60"
						step="5"
						bind:value={simDwell}
						class="w-full accent-violet-600"
					/>
				</label>

				<label class="block space-y-1 text-xs">
					<span class="flex justify-between">
						<span>On-time threshold</span>
						<span class="tabular-nums text-muted-foreground">{simThreshold} min</span>
					</span>
					<input
						type="range"
						min="2"
						max="10"
						step="1"
						bind:value={simThreshold}
						class="w-full accent-violet-600"
					/>
				</label>

				<Button onclick={runSimulation} disabled={simLoading} class="w-full" size="sm">
					{simLoading ? 'Running simulation…' : 'Run simulation'}
				</Button>

				{#if simError}
					<p class="text-xs text-destructive">{simError}</p>
				{:else if simResult}
					<div class="grid grid-cols-3 gap-1.5 text-center">
						<div class="rounded-md bg-muted/60 px-1 py-1.5">
							<div class="text-sm font-semibold tabular-nums">
								{simResult.baselineTripOnTimePct.toFixed(1)}%
							</div>
							<div class="text-[10px] tracking-wide text-muted-foreground uppercase">Baseline</div>
						</div>
						<div class="rounded-md bg-muted/60 px-1 py-1.5">
							<div class="text-sm font-semibold tabular-nums">
								{simResult.simulatedTripOnTimePct.toFixed(1)}%
							</div>
							<div class="text-[10px] tracking-wide text-muted-foreground uppercase">Simulated</div>
						</div>
						<div class="rounded-md bg-muted/60 px-1 py-1.5">
							<div
								class="text-sm font-semibold tabular-nums"
								class:text-emerald-600={simResult.simulatedTripOnTimePct >= simResult.baselineTripOnTimePct}
								class:text-red-600={simResult.simulatedTripOnTimePct < simResult.baselineTripOnTimePct}
							>
								{simResult.simulatedTripOnTimePct >= simResult.baselineTripOnTimePct ? '+' : ''}
								{(simResult.simulatedTripOnTimePct - simResult.baselineTripOnTimePct).toFixed(1)} pp
							</div>
							<div class="text-[10px] tracking-wide text-muted-foreground uppercase">Change</div>
						</div>
					</div>

					<p class="text-[10px] text-muted-foreground">
						{simResult.stopsRemoved} stops removed · {simResult.routesAffected} routes affected ·
						{simResult.tripsAnalyzed} trips analysed
					</p>
					<p class="text-[10px] text-muted-foreground">
						Route-level on-time: {simResult.baselineRouteOnTimePct.toFixed(1)}% →
						{simResult.simulatedRouteOnTimePct.toFixed(1)}%
						{#if simResult.avgSavedSeconds !== null}
							· avg {Math.round(simResult.avgSavedSeconds)} s saved
						{/if}
					</p>
					<label class="flex items-center justify-between gap-3 text-xs">
						<span>Show removed stops</span>
						<Switch bind:checked={showSimStops} />
					</label>
					<p class="text-[10px] text-muted-foreground">
						Estimate: on-time = average trip delay ≤ {simThreshold} min; assumes {simDwell}s
						saved per removed stop. Uses the last 7 days of available delay data, not a
						timetable re-run.
					</p>
				{/if}
				{/if}

				<p class="text-[10px] text-muted-foreground">
					Other scenario ideas: signal priority, bus-lane uplift, rerouting around slow
					sections.
				</p>
			</CardContent>
		</Card>

		<Card class="gap-2 py-3">
			<CardContent class="space-y-2.5 px-3">
				<p class="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
					<Search class="size-3" /> Network insights
				</p>

				<label class="flex items-center justify-between gap-3 text-sm">
					<span>Analysis</span>
					<select
						bind:value={insightKind}
						class="h-8 max-w-[190px] rounded-md border bg-background px-2 text-xs"
					>
						<option value="least-used">Least-used proxy</option>
						<option value="extension">Route extension candidates</option>
						<option value="transfers">Transfer hotspots</option>
					</select>
				</label>

				{#if insightKind === 'least-used'}
					<label class="block space-y-1 text-xs">
						<span class="flex justify-between">
							<span>Min observed stops</span>
							<span class="tabular-nums text-muted-foreground">{insightMinEvents}</span>
						</span>
						<input
							type="range"
							min="10"
							max="200"
							step="10"
							bind:value={insightMinEvents}
							class="w-full accent-violet-600"
						/>
					</label>
				{:else if insightKind === 'extension'}
					<label class="block space-y-1 text-xs">
						<span class="flex justify-between">
							<span>Min trips</span>
							<span class="tabular-nums text-muted-foreground">{insightMinTrips}</span>
						</span>
						<input
							type="range"
							min="1"
							max="50"
							step="1"
							bind:value={insightMinTrips}
							class="w-full accent-violet-600"
						/>
					</label>
				{:else}
					<label class="block space-y-1 text-xs">
						<span class="flex justify-between">
							<span>Cluster radius</span>
							<span class="tabular-nums text-muted-foreground">{insightRadius} m</span>
						</span>
						<input
							type="range"
							min="50"
							max="300"
							step="25"
							bind:value={insightRadius}
							class="w-full accent-violet-600"
						/>
					</label>
				{/if}

				<Button onclick={runInsight} disabled={insightLoading} class="w-full" size="sm">
					{insightLoading ? 'Analysing…' : 'Run analysis'}
				</Button>

				{#if insightError}
					<p class="text-xs text-destructive">{insightError}</p>
				{:else if insightResult}
					<div class="space-y-1">
						{#each insightResult.rows.slice(0, 10) as row (row.id)}
							<div class="flex items-start justify-between gap-2 text-xs">
								<span class="min-w-0">
									<span class="block truncate font-medium">{row.label}</span>
									<span class="block text-[10px] text-muted-foreground">{row.detail}</span>
								</span>
								<span class="shrink-0 text-[10px] text-muted-foreground">{row.metric}</span>
							</div>
						{/each}
					</div>
					<p class="text-[10px] text-muted-foreground">{insightResult.note}</p>
					<label class="flex items-center justify-between gap-3 text-xs">
						<span>Show on map</span>
						<Switch bind:checked={showInsightStops} />
					</label>
				{/if}
			</CardContent>
		</Card>

		{#if selected}
			<Card class="gap-2 py-3">
				<CardHeader class="flex-row items-start justify-between gap-2 px-3">
					<div class="min-w-0">
						<CardTitle class="truncate text-sm">{selected.stopName}</CardTitle>
						<p class="font-mono text-[10px] text-muted-foreground">Stop {selected.stopId}</p>
					</div>
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label="Clear selected stop"
						onclick={clearStop}
					>
						<X class="size-4" />
					</Button>
				</CardHeader>
				<CardContent class="space-y-3 px-3">
					<div class="flex flex-wrap gap-1">
						{#each routeOptions as route (route.routeId + ':' + route.directionId)}
							<button
								type="button"
								class={selectedRoute?.routeId === route.routeId &&
								selectedRoute.directionId === route.directionId
									? 'rounded-full bg-violet-600 px-2 py-0.5 text-[11px] font-medium text-white'
									: 'rounded-full border border-violet-300 bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700 transition-colors hover:bg-violet-100'}
								onclick={() => selectRoute(route)}
								title={`Direction ${route.directionId ?? 'unknown'}${route.shapeId ? '' : ' · no shape available'}`}
							>
								{route.shortName ?? route.longName ?? route.routeId}
								{#if route.directionId !== null}
									<span class="text-[9px] opacity-70">
										{route.directionId === 0 ? '→' : '←'}
									</span>
								{/if}
							</button>
						{:else}
							<p class="text-xs text-muted-foreground">No routes in the active feed.</p>
						{/each}
					</div>

					{#if selectedRoute}
						<p class="text-[10px] text-muted-foreground">
							Grey passed stops for
							{selectedRoute.shortName ?? selectedRoute.routeId}
							{selectedRoute.directionId === 0 ? 'outbound' : 'inbound'}. Click the badge
							again to clear.
						</p>
					{:else}
						<p class="text-[10px] text-muted-foreground">
							Click a route badge to show its grey passed stops.
						</p>
					{/if}

					<Separator />
					<div>
						<p class="mb-1.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
							Next departures
						</p>
						<div class="space-y-1">
							{#each selected.timetable as departure, index (departure.tripId + ':' + departure.scheduledTime + ':' + index)}
								<div class="flex items-center justify-between gap-2 text-xs">
									<span class="flex min-w-0 items-center gap-1.5">
										<span
											class="rounded bg-violet-100 px-1.5 py-0.5 font-mono text-[10px] font-medium text-violet-700"
										>
											{departure.routeShortName ?? departure.routeId}
										</span>
										<span class="truncate">
											{departure.headsign ?? departure.routeLongName ?? '—'}
										</span>
									</span>
									<span class="shrink-0 tabular-nums text-muted-foreground">
										{departure.scheduledTime}
										<span class="ml-1 text-[10px]">
											{departure.minutesAway <= 0 ? 'now' : `${departure.minutesAway} min`}
										</span>
									</span>
								</div>
							{:else}
								<p class="text-xs text-muted-foreground">
									No scheduled departures remaining today.
								</p>
							{/each}
						</div>
						<p class="mt-1 text-[10px] text-muted-foreground">
							Scheduled departures from the active timetable.
						</p>
					</div>

					<Button variant="outline" size="sm" href={`/stops/${selected.stopId}`}>
						Busyness details
					</Button>

					{#if nearbyDisruptions.length > 0}
						<Separator />
						<div>
							<p class="mb-1.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
								Nearby disruptions
							</p>
							<div class="space-y-1">
								{#each nearbyDisruptions as item, index (item.feature.id ?? index)}
									<div class="flex items-start justify-between gap-2 text-xs">
										<span class="flex min-w-0 items-start gap-1.5">
											<span
												class="mt-0.5 size-2 shrink-0 [clip-path:polygon(50%_0,100%_100%,0_100%)]"
												style={`background:${incidentColor(item.feature.properties.source)}`}
											></span>
											<span class="truncate">
												{item.feature.properties.displayName ??
													item.feature.properties.headline ??
													item.feature.properties.category ??
													'Traffic incident'}
											</span>
										</span>
										<span class="shrink-0 tabular-nums text-muted-foreground">
											{Math.round(item.distance)} m
										</span>
									</div>
								{/each}
							</div>
						</div>
					{/if}

					{#if selected.nearby.length > 0}
						<Separator />
						<div>
							<p class="mb-1.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
								Within 400 m
							</p>
							<div class="space-y-0.5">
								{#each selected.nearby as nearby (nearby.stopId)}
									<button
										type="button"
										class="flex w-full items-center justify-between gap-2 rounded-md px-1.5 py-1 text-left text-xs transition-colors hover:bg-muted"
										onclick={() => selectStop(nearby.stopId, nearby.lat, nearby.lon)}
									>
										<span class="truncate">{nearby.stopName}</span>
										<span class="shrink-0 tabular-nums text-muted-foreground">
											{Math.round(nearby.meters)} m
										</span>
									</button>
								{/each}
							</div>
						</div>
					{/if}
				</CardContent>
			</Card>
		{/if}

		<Card class="gap-3 py-3">
			<CardContent class="space-y-3 px-3">
				<div class="flex items-center justify-between gap-2">
					<p class="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
						<Filter class="size-3" /> Filters
					</p>
					<Button variant="ghost" size="xs" onclick={clearFilters}>Clear</Button>
				</div>

				<div>
					<label
						for="suburb-filter"
						class="mb-1 block text-[10px] font-medium tracking-wide text-muted-foreground uppercase"
					>
						Suburbs
					</label>
					<Input
						id="suburb-filter"
						bind:value={suburbQuery}
						placeholder="Add a suburb…"
						class="h-8 text-xs"
					/>
					{#if suburbResults.length > 0}
						<div class="mt-1 max-h-40 overflow-y-auto rounded-md border bg-popover shadow-sm">
							{#each suburbResults as suburb (suburb.name)}
								<button
									type="button"
									class="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted"
									onclick={() => addSuburb(suburb.name)}
								>
									<span class="truncate">{suburb.name}</span>
									<span class="shrink-0 text-[10px] text-muted-foreground">
										{suburb.stops}
									</span>
								</button>
							{/each}
						</div>
					{/if}
					{#if selectedSuburbs.length > 0}
						<div class="mt-1 flex flex-wrap gap-1">
							{#each selectedSuburbs as name (name)}
								<span class="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px]">
									{name}
									<button
										type="button"
										onclick={() => removeSuburb(name)}
										aria-label={`Remove ${name}`}
									>
										<X class="size-2.5" />
									</button>
								</span>
							{/each}
						</div>
					{/if}
				</div>

				<div>
					<p class="mb-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
						Route type
					</p>
					{#if routeTypes.length === 0}
						<p class="text-[10px] text-muted-foreground">Loading types…</p>
					{:else}
						<div class="flex flex-wrap gap-1">
							{#each routeTypes as type (type.routeType)}
								<button
									type="button"
									class={selectedRouteTypes.includes(type.routeType)
										? 'rounded-full bg-primary px-2 py-0.5 text-[10px] font-medium text-primary-foreground'
										: 'rounded-full border px-2 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted'}
									onclick={() => toggleRouteType(type.routeType)}
								>
									{routeTypeLabel(type.routeType)}
									<span class="ml-0.5 opacity-70">{type.routes}</span>
								</button>
							{/each}
						</div>
						{#if selectedRouteTypes.length === 0}
							<p class="mt-1 text-[10px] text-muted-foreground">All types</p>
						{/if}
					{/if}
				</div>

				<div>
					<label
						for="route-filter"
						class="mb-1 block text-[10px] font-medium tracking-wide text-muted-foreground uppercase"
					>
						Routes
					</label>
					<Input
						id="route-filter"
						bind:value={routeQuery}
						placeholder="Add a route…"
						class="h-8 text-xs"
					/>
					{#if routeResults.length > 0}
						<div class="mt-1 max-h-40 overflow-y-auto rounded-md border bg-popover shadow-sm">
							{#each routeResults as route (route.routeId)}
								<button
									type="button"
									class="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted"
									onclick={() => addRoute(route)}
								>
									<span class="shrink-0 font-mono">{route.shortName ?? route.routeId}</span>
									<span class="truncate text-[10px] text-muted-foreground">
										{route.longName ?? ''}
									</span>
								</button>
							{/each}
						</div>
					{/if}
					{#if selectedRoutes.length > 0}
						<div class="mt-1 flex flex-wrap gap-1">
							{#each selectedRoutes as route (route.routeId)}
								<span class="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px]">
									{route.shortName ?? route.routeId}
									<button
										type="button"
										onclick={() => removeRoute(route.routeId)}
										aria-label={`Remove route ${route.shortName ?? route.routeId}`}
									>
										<X class="size-2.5" />
									</button>
								</span>
							{/each}
						</div>
					{/if}
				</div>

				<label class="flex items-center justify-between gap-3">
					<span class="flex items-center gap-2 text-sm">
						<Clock class="size-3.5 text-muted-foreground" /> Active routes only
					</span>
					<Switch bind:checked={activeOnly} />
				</label>

				{#if activeOnly}
					<div class="space-y-1.5">
						<div class="flex gap-1.5">
							<Button
								variant={activeMode === 'now' ? 'default' : 'outline'}
								size="xs"
								onclick={() => (activeMode = 'now')}
							>
								Now
							</Button>
							<Button
								variant={activeMode === 'time' ? 'default' : 'outline'}
								size="xs"
								onclick={() => (activeMode = 'time')}
							>
								Specific time
							</Button>
						</div>
						{#if activeMode === 'time'}
							<div class="flex gap-1.5">
								<Input
									type="datetime-local"
									bind:value={activeAt}
									class="h-8 flex-1 text-xs"
									aria-label="Active routes at"
								/>
								<Button variant="outline" size="sm" onclick={resetActiveTime}>Now</Button>
							</div>
							<p class="text-[10px] text-muted-foreground">
								Local time; service dates are evaluated in Sydney.
							</p>
						{/if}
					</div>
				{/if}

				{#if filterLoading}
					<p class="text-[10px] text-muted-foreground">Applying filters…</p>
				{:else if filterError}
					<p class="text-[10px] text-destructive">{filterError}</p>
				{:else if filterStopCount !== null}
					<p class="text-[10px] text-muted-foreground">
						{filterStopCount} {filterStopCount === 1 ? 'stop' : 'stops'} ·
						{filterRouteCount} {filterRouteCount === 1 ? 'route' : 'routes'}
					</p>
				{:else}
					<p class="text-[10px] text-muted-foreground">No filters applied</p>
				{/if}
			</CardContent>
		</Card>

		<Card class="gap-2 py-3">
			<CardContent class="space-y-2.5 px-3">
				<p class="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
					<Layers class="size-3" /> Layers
				</p>
				<label class="flex items-center justify-between gap-3 text-sm">
					<span class="flex items-center gap-2"><Route class="size-3.5 text-muted-foreground" /> Routes</span>
					<Switch bind:checked={showRoutes} />
				</label>
				<label class="flex items-center justify-between gap-3 text-sm">
					<span class="flex items-center gap-2"><Layers class="size-3.5 text-muted-foreground" /> Map view</span>
					<select
						bind:value={viewMode}
						class="h-8 max-w-[180px] rounded-md border bg-background px-2 text-xs"
					>
						<option value="default">Default</option>
						<option value="pace">Route pace</option>
						<option value="slowdowns">Slowdown hotspots</option>
					</select>
				</label>
				{#if viewMode === 'pace'}
					<div class="space-y-1">
						<div
							class="h-2 rounded-full"
							style={`background: linear-gradient(to right, ${ROUTE_PACE_COLORS.fast}, ${ROUTE_PACE_COLORS.mid}, ${ROUTE_PACE_COLORS.slow});`}
						></div>
						<div class="flex justify-between text-[10px] text-muted-foreground">
							<span>Faster {ROUTE_PACE_SCALE.fast.toFixed(1)}</span>
							<span>{ROUTE_PACE_SCALE.mid.toFixed(1)}</span>
							<span>Slower {ROUTE_PACE_SCALE.slow.toFixed(1)} min/km</span>
						</div>
						<p class="text-[10px] text-muted-foreground">
							Average scheduled time per kilometre across bus trips; green is faster, red is slower.
						</p>
					</div>
				{:else if viewMode === 'slowdowns'}
					<div class="space-y-1">
						<div
							class="h-2 rounded-full"
							style={`background: linear-gradient(to right, ${SLOWDOWN_COLORS.slow}, ${SLOWDOWN_COLORS.mid}, ${SLOWDOWN_COLORS.fast});`}
						></div>
						<div class="flex justify-between text-[10px] text-muted-foreground">
							<span>Slow {SLOWDOWN_SCALE.slow.toFixed(0)}</span>
							<span>{SLOWDOWN_SCALE.mid.toFixed(0)}</span>
							<span>Fast {SLOWDOWN_SCALE.fast.toFixed(0)} km/h</span>
						</div>
						<p class="text-[10px] text-muted-foreground">
							Observed moving bus speed by 200 m route section, last 24 hours. Red sections are the biggest slowdowns.
						</p>
					</div>
				{/if}
				<label class="flex items-center justify-between gap-3 text-sm">
					<span class="flex items-center gap-2"><Route class="size-3.5 text-muted-foreground" /> Bus lanes</span>
					<Switch bind:checked={showBusLanes} />
				</label>
				{#if showBusLanes}
					<div class="space-y-1">
						<div class="flex flex-wrap gap-x-2.5 gap-y-1 text-[10px] text-muted-foreground">
							<span class="flex items-center gap-1">
								<span class="h-1 w-4 rounded-full bg-[#db2777]"></span> Bus lane
							</span>
							<span class="flex items-center gap-1">
								<span class="h-1 w-4 rounded-full bg-[#f59e0b]"></span> HOV
							</span>
							<span class="flex items-center gap-1">
								<span class="h-1 w-4 rounded-full bg-[#94a3b8]"></span> Unknown
							</span>
						</div>
						<p class="text-[10px] text-muted-foreground">
							TfNSW bus lanes (BU/BO); HOV lanes shown for context. Click a lane for road details.
						</p>
					</div>
				{/if}
				<label class="flex items-center justify-between gap-3 text-sm">
					<span class="flex items-center gap-2"><Gauge class="size-3.5 text-muted-foreground" /> Speed zones</span>
					<Switch bind:checked={showSpeedZones} />
				</label>
				{#if showSpeedZones}
					<div class="space-y-1">
						<div class="flex flex-wrap gap-x-2 gap-y-1 text-[10px] text-muted-foreground">
							<span class="flex items-center gap-1"><span class="h-1 w-3 rounded-full bg-[#ea580c]"></span>40</span>
							<span class="flex items-center gap-1"><span class="h-1 w-3 rounded-full bg-[#f59e0b]"></span>50</span>
							<span class="flex items-center gap-1"><span class="h-1 w-3 rounded-full bg-[#eab308]"></span>60</span>
							<span class="flex items-center gap-1"><span class="h-1 w-3 rounded-full bg-[#84cc16]"></span>70</span>
							<span class="flex items-center gap-1"><span class="h-1 w-3 rounded-full bg-[#22c55e]"></span>80</span>
							<span class="flex items-center gap-1"><span class="h-1 w-3 rounded-full bg-[#14b8a6]"></span>90</span>
							<span class="flex items-center gap-1"><span class="h-1 w-3 rounded-full bg-[#3b82f6]"></span>100</span>
							<span class="flex items-center gap-1"><span class="h-1 w-3 rounded-full bg-[#8b5cf6]"></span>110</span>
							<span>km/h</span>
						</div>
						<p class="text-[10px] text-muted-foreground">
							TfNSW speed zones; exact limit and zone type in the popup.
						</p>
					</div>
				{/if}
				<label class="flex items-center justify-between gap-3 text-sm">
					<span class="flex items-center gap-2"><Route class="size-3.5 text-muted-foreground" /> Clearways</span>
					<Switch bind:checked={showClearways} />
				</label>
				{#if showClearways}
					<div class="space-y-1">
						<span class="flex items-center gap-1 text-[10px] text-muted-foreground">
							<span class="h-0.5 w-6 border-t-2 border-dashed border-[#0891b2]"></span>
							Clearway hours
						</span>
						<p class="text-[10px] text-muted-foreground">
							TfNSW clearways (2018; may be incomplete). Click a section for street and hours.
						</p>
					</div>
				{/if}
				<label class="flex items-center justify-between gap-3 text-sm">
					<span class="flex items-center gap-2"><MapPin class="size-3.5 text-muted-foreground" /> Bus stops</span>
					<Switch bind:checked={showStops} />
				</label>
				<label class="flex items-center justify-between gap-3 text-sm">
					<span class="flex items-center gap-2"><MapPin class="size-3.5 text-muted-foreground" /> Suburb names</span>
					<Switch bind:checked={showSuburbNames} />
				</label>
				<label class="flex items-center justify-between gap-3 text-sm">
					<span class="flex items-center gap-2"><Layers class="size-3.5 text-muted-foreground" /> Suburb shading</span>
					<Switch bind:checked={showSuburbShading} />
				</label>
				<label class="flex items-center justify-between gap-3 text-sm">
					<span class="flex items-center gap-2"><Activity class="size-3.5 text-muted-foreground" /> Live vehicles</span>
					<Switch bind:checked={showLive} />
				</label>
				<label
					class="flex items-center justify-between gap-3 text-sm"
					class:opacity-50={!selectedRoute}
				>
					<span class="flex items-center gap-2"><MapPin class="size-3.5 text-muted-foreground" /> Passed stops (grey)</span>
					<Switch bind:checked={showPassedStops} disabled={!selectedRoute} />
				</label>
				<label class="flex items-center justify-between gap-3 text-sm">
					<span class="flex items-center gap-2"><Activity class="size-3.5 text-muted-foreground" /> Busyness heatmap</span>
					<Switch bind:checked={showBusyness} />
				</label>
			</CardContent>
		</Card>

		<Card class="gap-2 py-3">
			<CardContent class="space-y-2.5 px-3">
				<p class="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
					<TriangleAlert class="size-3" /> Traffic
				</p>
				<label class="flex items-center justify-between gap-3 text-sm">
					<span class="flex items-center gap-2">
						<TriangleAlert class="size-3.5 text-muted-foreground" /> Traffic incidents
					</span>
					<Switch bind:checked={showIncidents} />
				</label>
				<label class="flex items-center justify-between gap-3 text-sm">
					<span class="flex items-center gap-2">
						<Gauge class="size-3.5 text-muted-foreground" /> Bus congestion
					</span>
					<Switch bind:checked={showCongestion} />
				</label>
				<label class="flex items-center justify-between gap-3 text-sm">
					<span class="flex items-center gap-2">
						<span class="size-3.5 rounded-full border-2 border-[#fbbf24] bg-[#111827]"></span> Traffic lights
					</span>
					<Switch bind:checked={showTrafficLights} />
				</label>

				{#if showIncidents}
					<div class="flex flex-wrap gap-x-2.5 gap-y-1 text-[10px] text-muted-foreground">
						<span class="flex items-center gap-1">
							<span class="size-2.5 bg-[#dc2626] [clip-path:polygon(50%_0,100%_100%,0_100%)]"></span> Incident
						</span>
						<span class="flex items-center gap-1">
							<span class="size-2.5 bg-[#f59e0b] [clip-path:polygon(50%_0,100%_100%,0_100%)]"></span> Roadwork
						</span>
						<span class="flex items-center gap-1">
							<span class="size-2.5 bg-[#2563eb] [clip-path:polygon(50%_0,100%_100%,0_100%)]"></span> Flood
						</span>
						<span class="flex items-center gap-1">
							<span class="size-2.5 bg-[#7c3aed] [clip-path:polygon(50%_0,100%_100%,0_100%)]"></span> Event
						</span>
					</div>
				{/if}

				{#if showCongestion}
					<div class="flex items-center gap-1.5 text-[10px] text-muted-foreground">
						<span>Fast</span>
						<span class="size-2.5 rounded-full bg-[#22c55e]"></span>
						<span class="size-2.5 rounded-full bg-[#eab308]"></span>
						<span class="size-2.5 rounded-full bg-[#f97316]"></span>
						<span class="size-2.5 rounded-full bg-[#dc2626]"></span>
						<span>Slow</span>
					</div>
					<p class="text-[10px] text-muted-foreground">
						Bus GPS speed over the last 10 minutes. This is a bus-speed proxy, not general
						traffic flow.
					</p>
				{/if}

				<p class="text-[10px] text-muted-foreground">
					Nearby incidents also appear as possible delay reasons when you click a bus.
				</p>
			</CardContent>
		</Card>

		{#if showBusyness}
			<Card class="gap-2 py-3">
				<CardContent class="space-y-2.5 px-3">
					<div class="flex items-center justify-between gap-2">
						<p class="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
							Stop busyness
						</p>
						<a href="/settings" class="text-[10px] text-primary underline">Metric: {metricLabel()}</a>
					</div>

					<div class="flex gap-2">
						<select
							bind:value={heatDow}
							class="h-8 flex-1 rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
							aria-label="Busyness day of week"
						>
							{#each [['Mon', 1], ['Tue', 2], ['Wed', 3], ['Thu', 4], ['Fri', 5], ['Sat', 6], ['Sun', 7]] as [label, value] (value)}
								<option {value}>{label}</option>
							{/each}
						</select>
						<select
							bind:value={heatHour}
							class="h-8 w-24 rounded-md border bg-background px-2 text-xs tabular-nums outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
							aria-label="Busyness hour"
						>
							{#each Array.from({ length: 24 }, (_, hour) => hour) as hour (hour)}
								<option value={hour}>{String(hour).padStart(2, '0')}:00</option>
							{/each}
						</select>
					</div>

					{#if heatLoading}
						<p class="text-[11px] text-muted-foreground">Loading…</p>
					{:else if heatError}
						<p class="text-[11px] text-destructive">{heatError}</p>
					{:else if heatFeatures.features.length === 0}
						<p class="text-[11px] text-muted-foreground">
							No positive busyness observations for this day and hour yet.
						</p>
					{:else}
						<p class="text-[11px] text-muted-foreground">
							{heatFeatures.features.length}{heatTotal > heatFeatures.features.length
								? ` of ${heatTotal}`
								: ''} busy stops{heatTotal > 500 ? ' · top 500 shown' : ''} · click a circle
							for details
						</p>
					{/if}

					<div class="flex items-center gap-1.5 text-[10px] text-muted-foreground">
						<span>Low</span>
						<span class="size-2.5 rounded-full bg-[#fde68a]"></span>
						<span class="size-2.5 rounded-full bg-[#fbbf24]"></span>
						<span class="size-2.5 rounded-full bg-[#f59e0b]"></span>
						<span class="size-2.5 rounded-full bg-[#ef4444]"></span>
						<span class="size-2.5 rounded-full bg-[#b91c1c]"></span>
						<span>High</span>
						<span class="ml-auto">Faded = low sample</span>
					</div>
					<p class="text-[10px] text-muted-foreground">
						Live vehicles are hidden while the heatmap is on.
					</p>
				</CardContent>
			</Card>
		{/if}

		{#if !data.ready || (data.summary?.stops ?? 0) === 0}
			<Card class="gap-2 border-amber-500/40 bg-amber-50/80 py-3">
				<CardHeader class="px-3">
					<CardTitle class="text-sm">
						{data.ready ? 'No GTFS feed imported' : 'Database not connected'}
					</CardTitle>
				</CardHeader>
				<CardContent class="space-y-2 px-3 text-xs text-muted-foreground">
					<p>Start the database, apply migrations, then import the bus timetable:</p>
					<pre class="overflow-x-auto rounded-md bg-background/70 p-2 font-mono text-[11px] leading-relaxed">bun run db:up
bun run db:migrate
bun run gtfs:import</pre>
					<p>Then start the live collector in a separate terminal:</p>
					<pre class="rounded-md bg-background/70 p-2 font-mono text-[11px]">bun run collect</pre>
				</CardContent>
			</Card>
		{/if}


	</aside>

	<PlaybackTimeline
		{bounds}
		value={playbackAt}
		{playing}
		{speed}
		{mode}
		loading={loadingHistory}
		onchange={handleScrub}
		ontoggle={togglePlay}
		onstep={step}
		onspeed={(value) => (speed = value)}
		onlive={returnLive}
	/>
</div>
