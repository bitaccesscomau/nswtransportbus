<script lang="ts">
	import { onMount } from 'svelte';
	import {
		AttributionControl,
		Map as MapLibreMap,
		NavigationControl,
		Popup,
		ScaleControl,
		setWorkerUrl,
		type GeoJSONSource,
		type MapGeoJSONFeature,
		type MapMouseEvent
	} from 'maplibre-gl';
	import mapLibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
	import type { FeatureCollection, Point } from 'geojson';
	import { haversineMeters } from '#lib/geo.js';
	import { ROUTE_PACE_COLORS, ROUTE_PACE_SCALE } from '#lib/route-pace.js';
	import { SLOWDOWN_COLORS, SLOWDOWN_SCALE } from '#lib/slowdown.js';
	import type {
		BusCongestionProperties,
		PassedStopProperties,
		TrafficIncidentProperties,
		VehicleSnapshot
	} from '#lib/types.js';
	import 'maplibre-gl/dist/maplibre-gl.css';

	setWorkerUrl(mapLibreWorkerUrl);

	interface Focus {
		lat: number;
		lon: number;
		zoom?: number;
	}

	interface SelectedStop {
		stopId: string;
		lat: number;
		lon: number;
		routeIds: string[];
		shapeId?: string | null;
	}

	let {
		focus = null,
		selected = null,
		showRoutes = true,
		viewMode = 'default',
		showStops = true,
		showSuburbNames = true,
		showSuburbShading = false,
		showLive = true,
		history = null,
		paused = false,
		busyness = null,
		showBusyness = false,
		routeArrows = null,
		showRouteArrows = true,
		routeView = null,
		filterStopIds = null,
		filterRouteIds = null,
		filterBounds = null,
		incidents = null,
		showIncidents = false,
		congestion = null,
		showCongestion = false,
		showTrafficLights = false,
		passedStops = null,
		showPassedStops = true,
		smoothHistory = false,
		onStopSelect,
		onLiveCount
	}: {
		focus?: Focus | null;
		selected?: SelectedStop | null;
		showRoutes?: boolean;
		viewMode?: 'default' | 'pace' | 'slowdowns';
		showStops?: boolean;
		showSuburbNames?: boolean;
		showSuburbShading?: boolean;
		showLive?: boolean;
		history?: VehicleSnapshot[] | null;
		paused?: boolean;
		busyness?: FeatureCollection | null;
		showBusyness?: boolean;
		routeArrows?: FeatureCollection | null;
		showRouteArrows?: boolean;
		routeView?: { bounds: [[number, number], [number, number]] } | null;
		filterStopIds?: string[] | null;
		filterRouteIds?: string[] | null;
		filterBounds?: [[number, number], [number, number]] | null;
		incidents?: FeatureCollection<Point, TrafficIncidentProperties> | null;
		showIncidents?: boolean;
		congestion?: FeatureCollection<Point, BusCongestionProperties> | null;
		showCongestion?: boolean;
		showTrafficLights?: boolean;
		passedStops?: FeatureCollection<Point, PassedStopProperties> | null;
		showPassedStops?: boolean;
		smoothHistory?: boolean;
		onStopSelect?: (stopId: string) => void;
		onLiveCount?: (count: number) => void;
	} = $props();

	let container: HTMLDivElement;
	let map: MapLibreMap | undefined;
	let liveSource: GeoJSONSource | undefined;
	let selectedSource: GeoJSONSource | undefined;
	let busynessSource: GeoJSONSource | undefined;
	let incidentSource: GeoJSONSource | undefined;
	let congestionSource: GeoJSONSource | undefined;
	let passedStopsSource: GeoJSONSource | undefined;
	let historyAnimation: number | undefined;
	let lastHistory: VehicleSnapshot[] | null = null;
	let displayedPositions = new Map<string, { lat: number; lon: number }>();
	let styleReady = $state(false);
	let error = $state<string | null>(null);
	let isPaused = $state(false);

	const empty: FeatureCollection = { type: 'FeatureCollection', features: [] };

	type MapFilter = NonNullable<Parameters<MapLibreMap['setFilter']>[1]>;

	function inFilter(property: string, values: string[]): MapFilter {
		return ['in', ['get', property], ['literal', values]] as MapFilter;
	}

	function delayClass(delayS: number | null | undefined): number {
		if (delayS === null || delayS === undefined) return 0;
		if (delayS < 120) return 1;
		if (delayS < 300) return 2;
		if (delayS < 600) return 3;
		return 4;
	}

	function featuresFrom(
		vehicles: Map<string, VehicleSnapshot>,
		positions: Map<string, { lat: number; lon: number }>
	): FeatureCollection {
		return {
			type: 'FeatureCollection',
			features: [...vehicles.entries()].map(([key, vehicle]) => {
				const position = positions.get(key) ?? { lat: vehicle.lat, lon: vehicle.lon };
				return {
					type: 'Feature',
					geometry: { type: 'Point', coordinates: [position.lon, position.lat] },
					properties: { ...vehicle, delayClass: delayClass(vehicle.delayS) }
				};
			})
		};
	}

	function cancelHistoryAnimation() {
		if (historyAnimation !== undefined) cancelAnimationFrame(historyAnimation);
		historyAnimation = undefined;
	}

	function applyHistory(vehicles: VehicleSnapshot[], smooth: boolean) {
		if (!liveSource) return;
		cancelHistoryAnimation();
		const next = new Map(vehicles.map((vehicle) => [vehicle.vehicleKey, vehicle]));

		if (!smooth) {
			displayedPositions = new Map(
				vehicles.map((vehicle) => [
					vehicle.vehicleKey,
					{ lat: vehicle.lat, lon: vehicle.lon }
				])
			);
			liveSource.setData(featuresFrom(next, displayedPositions));
			return;
		}

		const from = new Map(displayedPositions);
		const started = performance.now();
		const duration = 350;
		let lastPaint = 0;

		const frame = (now: number) => {
			if (now - lastPaint < 30 && now - started < duration) {
				historyAnimation = requestAnimationFrame(frame);
				return;
			}
			lastPaint = now;

			const t = Math.min(1, (now - started) / duration);
			const eased = t * t * (3 - 2 * t);
			const positions = new Map<string, { lat: number; lon: number }>();

			for (const [key, vehicle] of next) {
				const previous = from.get(key);
				positions.set(
					key,
					previous
						? {
								lat: previous.lat + (vehicle.lat - previous.lat) * eased,
								lon: previous.lon + (vehicle.lon - previous.lon) * eased
							}
						: { lat: vehicle.lat, lon: vehicle.lon }
				);
			}

			displayedPositions = positions;
			liveSource?.setData(featuresFrom(next, positions));

			if (t < 1) {
				historyAnimation = requestAnimationFrame(frame);
			} else {
				historyAnimation = undefined;
			}
		};

		historyAnimation = requestAnimationFrame(frame);
	}

	function toFeatures(vehicles: VehicleSnapshot[]): FeatureCollection {
		return {
			type: 'FeatureCollection',
			features: vehicles.map((vehicle) => ({
				type: 'Feature',
				geometry: { type: 'Point', coordinates: [vehicle.lon, vehicle.lat] },
				properties: { ...vehicle, delayClass: delayClass(vehicle.delayS) }
			}))
		};
	}

	function escapeHtml(value: unknown): string {
		return String(value ?? '').replace(
			/[&<>"']/g,
			(character) =>
				({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ??
				character
		);
	}

	function addSourcesAndLayers(instance: MapLibreMap) {
		const origin = window.location.origin;

		instance.addSource('shapes', {
			type: 'vector',
			tiles: [`${origin}/api/tiles/shapes/{z}/{x}/{y}`],
			minzoom: 5,
			maxzoom: 14
		});

		instance.addLayer({
			id: 'shapes',
			type: 'line',
			source: 'shapes',
			'source-layer': 'shapes',
			layout: { 'line-cap': 'round', 'line-join': 'round' },
			paint: {
				'line-color': '#2563eb',
				'line-opacity': 0.2,
				'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.6, 12, 1.4, 16, 3.6]
			}
		});

		instance.addLayer({
			id: 'shapes-highlight',
			type: 'line',
			source: 'shapes',
			'source-layer': 'shapes',
			layout: { 'line-cap': 'round', 'line-join': 'round' },
			paint: {
				'line-color': '#7c3aed',
				'line-opacity': 0.95,
				'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1.2, 12, 2.6, 16, 5]
			},
			filter: ['in', ['get', 'route_id'], ['literal', []]]
		});

		instance.addSource('slowdowns', {
			type: 'vector',
			tiles: [`${origin}/api/tiles/slowdowns/{z}/{x}/{y}`],
			minzoom: 8,
			maxzoom: 22
		});
		instance.addLayer({
			id: 'slowdowns',
			type: 'line',
			source: 'slowdowns',
			'source-layer': 'slowdowns',
			layout: {
				visibility: 'none',
				'line-cap': 'round',
				'line-join': 'round'
			},
			paint: {
				'line-color': [
					'interpolate',
					['linear'],
					['get', 'speed_kmh'],
					SLOWDOWN_SCALE.slow,
					SLOWDOWN_COLORS.slow,
					SLOWDOWN_SCALE.mid,
					SLOWDOWN_COLORS.mid,
					SLOWDOWN_SCALE.fast,
					SLOWDOWN_COLORS.fast
				],
				'line-opacity': 0.9,
				'line-width': ['interpolate', ['linear'], ['zoom'], 8, 2, 12, 3.5, 16, 6]
			}
		});

		instance.addSource('suburbs', {
			type: 'vector',
			tiles: [`${origin}/api/tiles/suburbs/{z}/{x}/{y}`],
			minzoom: 5,
			maxzoom: 22
		});
		instance.addLayer(
			{
				id: 'suburb-fills',
				type: 'fill',
				source: 'suburbs',
				'source-layer': 'suburbs',
				layout: { visibility: 'none' },
				paint: {
					'fill-color': [
						'match',
						['get', 'color_index'],
						0,
						'#e11d48',
						1,
						'#f97316',
						2,
						'#eab308',
						3,
						'#84cc16',
						4,
						'#22c55e',
						5,
						'#14b8a6',
						6,
						'#06b6d4',
						7,
						'#0ea5e9',
						8,
						'#3b82f6',
						9,
						'#6366f1',
						10,
						'#8b5cf6',
						11,
						'#a855f7',
						12,
						'#d946ef',
						13,
						'#ec4899',
						14,
						'#f43f5e',
						15,
						'#f59e0b',
						16,
						'#10b981',
						17,
						'#0891b2',
						18,
						'#4f46e5',
						19,
						'#c026d3',
						'#64748b'
					],
					'fill-opacity': 0.28,
					'fill-outline-color': '#ffffff'
				}
			},
			instance.getLayer('label_other') ? 'label_other' : 'shapes'
		);

		instance.addSource('stops', {
			type: 'vector',
			tiles: [`${origin}/api/tiles/stops/{z}/{x}/{y}`],
			minzoom: 12,
			maxzoom: 22
		});

		instance.addLayer({
			id: 'stops',
			type: 'circle',
			source: 'stops',
			'source-layer': 'stops',
			minzoom: 12,
			paint: {
				'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 2.2, 16, 4.5, 20, 7],
				'circle-color': '#ffffff',
				'circle-stroke-color': '#1d4ed8',
				'circle-stroke-width': 1.5
			}
		});

		instance.addSource('traffic-lights', {
			type: 'vector',
			tiles: [`${origin}/api/tiles/traffic-lights/{z}/{x}/{y}`],
			minzoom: 8,
			maxzoom: 22
		});
		instance.addLayer({
			id: 'traffic-lights',
			type: 'circle',
			source: 'traffic-lights',
			'source-layer': 'traffic_lights',
			layout: { visibility: 'none' },
			paint: {
				'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 1.3, 12, 2.4, 16, 4.5, 20, 7],
				'circle-color': '#111827',
				'circle-opacity': 0.9,
				'circle-stroke-color': '#fbbf24',
				'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 8, 0.6, 12, 1, 16, 1.6]
			}
		});

		instance.addLayer({
			id: 'stop-labels',
			type: 'symbol',
			source: 'stops',
			'source-layer': 'stops',
			minzoom: 15.5,
			layout: {
				'text-field': ['get', 'stop_name'],
				'text-size': 11,
				'text-offset': [0, 1.1],
				'text-anchor': 'top',
				'text-max-width': 9
			},
			paint: {
				'text-color': '#1e293b',
				'text-halo-color': '#ffffff',
				'text-halo-width': 1.4
			}
		});

		if (!instance.hasImage('route-triangle')) {
			const arrowCanvas = document.createElement('canvas');
			arrowCanvas.width = 32;
			arrowCanvas.height = 32;
			const arrowContext = arrowCanvas.getContext('2d');
			if (arrowContext) {
				arrowContext.beginPath();
				arrowContext.moveTo(3, 4);
				arrowContext.lineTo(29, 16);
				arrowContext.lineTo(3, 28);
				arrowContext.closePath();
				arrowContext.fillStyle = '#ffffff';
				arrowContext.fill();
				arrowContext.lineWidth = 2;
				arrowContext.strokeStyle = '#7c3aed';
				arrowContext.stroke();
				instance.addImage(
					'route-triangle',
					arrowContext.getImageData(0, 0, 32, 32),
					{ pixelRatio: 2 }
				);
			}
		}

		instance.addSource('route-arrows', { type: 'geojson', data: empty });
		instance.addLayer({
			id: 'route-arrows',
			type: 'symbol',
			source: 'route-arrows',
			layout: {
				visibility: 'none',
				'symbol-placement': 'line',
				'symbol-spacing': 120,
				'icon-image': 'route-triangle',
				'icon-size': ['interpolate', ['linear'], ['zoom'], 8, 0.2, 12, 0.35, 16, 0.65],
				'icon-allow-overlap': true,
				'icon-ignore-placement': true
			},
			paint: { 'icon-opacity': 0.95 }
		});
		instance.addSource('passed-stops', { type: 'geojson', data: empty });
		instance.addLayer({
			id: 'passed-stops',
			type: 'circle',
			source: 'passed-stops',
			minzoom: 12,
			layout: { visibility: 'none' },
			paint: {
				'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 2.2, 16, 4.5, 20, 7],
				'circle-color': '#64748b',
				'circle-opacity': 0.95,
				'circle-stroke-color': '#ffffff',
				'circle-stroke-width': 1.5
			}
		});
		passedStopsSource = instance.getSource('passed-stops') as GeoJSONSource;

		instance.addSource('busyness', { type: 'geojson', data: empty });

		instance.addLayer({
			id: 'busyness',
			type: 'circle',
			source: 'busyness',
			layout: { visibility: 'none' },
			paint: {
				'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 3, 13, 6, 18, 10],
				'circle-color': [
					'match',
					['get', 'level'],
					0,
					'#cbd5e1',
					1,
					'#fde68a',
					2,
					'#fbbf24',
					3,
					'#f59e0b',
					4,
					'#ef4444',
					5,
					'#b91c1c',
					'#cbd5e1'
				],
				'circle-opacity': [
					'match',
					['get', 'confidence'],
					'low',
					0.45,
					'medium',
					0.75,
					'high',
					0.95,
					0.9
				],
				'circle-stroke-color': '#ffffff',
				'circle-stroke-width': 0.5
			}
		});

		busynessSource = instance.getSource('busyness') as GeoJSONSource;

		instance.addSource('bus-congestion', { type: 'geojson', data: empty });
		instance.addLayer({
			id: 'bus-congestion',
			type: 'circle',
			source: 'bus-congestion',
			layout: { visibility: 'none' },
			paint: {
				'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 6, 13, 10, 18, 16],
				'circle-color': [
					'match',
					['get', 'level'],
					1,
					'#22c55e',
					2,
					'#eab308',
					3,
					'#f97316',
					4,
					'#dc2626',
					'#94a3b8'
				],
				'circle-opacity': 0.35,
				'circle-stroke-color': '#ffffff',
				'circle-stroke-width': 0.5
			}
		});
		congestionSource = instance.getSource('bus-congestion') as GeoJSONSource;

		const incidentPalette: Record<string, string> = {
			incident: '#dc2626',
			roadwork: '#f59e0b',
			flood: '#2563eb',
			majorevent: '#7c3aed',
			fire: '#991b1b'
		};

		for (const [source, color] of Object.entries(incidentPalette)) {
			const imageId = `incident-triangle-${source}`;
			if (instance.hasImage(imageId)) continue;

			const canvas = document.createElement('canvas');
			canvas.width = 32;
			canvas.height = 32;
			const context = canvas.getContext('2d');
			if (!context) continue;

			context.beginPath();
			context.moveTo(16, 2);
			context.lineTo(30, 28);
			context.lineTo(2, 28);
			context.closePath();
			context.fillStyle = color;
			context.fill();
			context.lineWidth = 3;
			context.strokeStyle = '#ffffff';
			context.stroke();

			instance.addImage(imageId, context.getImageData(0, 0, 32, 32), { pixelRatio: 2 });
		}

		instance.addSource('traffic-incidents', { type: 'geojson', data: empty });
		instance.addLayer({
			id: 'traffic-incidents',
			type: 'symbol',
			source: 'traffic-incidents',
			layout: {
				visibility: 'none',
				'icon-image': [
					'match',
					['get', 'source'],
					'incident',
					'incident-triangle-incident',
					'roadwork',
					'incident-triangle-roadwork',
					'flood',
					'incident-triangle-flood',
					'majorevent',
					'incident-triangle-majorevent',
					'fire',
					'incident-triangle-fire',
					'incident-triangle-incident'
				],
				'icon-size': ['interpolate', ['linear'], ['zoom'], 8, 0.5, 13, 0.75, 18, 1.1],
				'icon-allow-overlap': true,
				'icon-ignore-placement': true
			},
			paint: { 'icon-opacity': 0.95 }
		});
		incidentSource = instance.getSource('traffic-incidents') as GeoJSONSource;

		instance.addSource('live', {
			type: 'geojson',
			data: empty,
			promoteId: 'vehicleKey'
		});

		instance.addLayer({
			id: 'live',
			type: 'circle',
			source: 'live',
			paint: {
				'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 3, 13, 5, 18, 8],
				'circle-color': [
					'match',
					['get', 'delayClass'],
					0,
					'#94a3b8',
					1,
					'#0d9488',
					2,
					'#eab308',
					3,
					'#f97316',
					4,
					'#dc2626',
					'#94a3b8'
				],
				'circle-opacity': 0.95,
				'circle-stroke-color': '#ffffff',
				'circle-stroke-width': 1.5
			}
		});

		instance.addSource('selected', { type: 'geojson', data: empty });

		instance.addLayer({
			id: 'selected',
			type: 'circle',
			source: 'selected',
			paint: {
				'circle-radius': 10,
				'circle-color': '#f59e0b',
				'circle-opacity': 0.16,
				'circle-stroke-color': '#f59e0b',
				'circle-stroke-width': 2
			}
		});

		liveSource = instance.getSource('live') as GeoJSONSource;
		selectedSource = instance.getSource('selected') as GeoJSONSource;

		const handleStopClick = (
			event: MapMouseEvent & { features?: MapGeoJSONFeature[] }
		) => {
			const feature = event.features?.[0];
			if (!feature) return;

			const stopId = feature.properties?.stop_id;
			if (!stopId) return;

			new Popup({ closeButton: false, offset: 10 })
				.setLngLat(event.lngLat)
				.setHTML(`<strong>${escapeHtml(feature.properties?.stop_name)}</strong>`)
				.addTo(instance);

			onStopSelect?.(String(stopId));
		};

		instance.on('click', 'stops', handleStopClick);
		instance.on('click', 'stop-labels', handleStopClick);

		instance.on('click', 'busyness', (event) => {
			const feature = event.features?.[0];
			if (!feature) return;

			const properties = feature.properties ?? {};
			const stopId = properties.stopId;
			if (stopId) onStopSelect?.(String(stopId));

			new Popup({ closeButton: false, offset: 10 })
				.setLngLat(event.lngLat)
				.setHTML(
					`<div style="font-size:12px;line-height:1.5"><strong>${escapeHtml(properties.stopName)}</strong><br/>` +
						`${escapeHtml(properties.metricLabel)}: ${Number(properties.value).toFixed(2)}<br/>` +
						`${escapeHtml(properties.samples)}/${escapeHtml(properties.events)} samples · ` +
						`${escapeHtml(properties.confidence)} confidence</div>`
				)
				.addTo(instance);
		});

		instance.on('click', 'passed-stops', (event) => {
			const feature = event.features?.[0];
			if (!feature) return;
			const stop = feature.properties as PassedStopProperties;

			new Popup({ closeButton: false, offset: 10, maxWidth: '280px' })
				.setLngLat(event.lngLat)
				.setHTML(
					`<div style="font-size:12px;line-height:1.5"><strong>${escapeHtml(stop.stopName)}</strong><br/>` +
						`<span style="color:#6b7280">Passed by this route · ${Math.round(stop.meters)} m from the line</span></div>`
				)
				.addTo(instance);

			onStopSelect?.(String(stop.stopId));
		});

		instance.on('click', 'slowdowns', (event) => {
			const feature = event.features?.[0];
			if (!feature) return;
			const properties = feature.properties as {
				route_short_name?: string | null;
				route_id?: string | null;
				speed_kmh?: number;
				samples?: number;
			};
			const route = properties.route_short_name ?? properties.route_id ?? 'Unknown route';
			const speed = Number(properties.speed_kmh ?? 0).toFixed(1);
			const samples = Number(properties.samples ?? 0);

			new Popup({ closeButton: false, offset: 10, maxWidth: '280px' })
				.setLngLat(event.lngLat)
				.setHTML(
					`<div style="font-size:12px;line-height:1.5"><strong>Slow section</strong><br/>` +
						`Route ${escapeHtml(route)}<br/>` +
						`<span style="color:#6b7280">${speed} km/h moving average · ${samples} samples</span></div>`
				)
				.addTo(instance);
		});
		instance.on('mouseenter', 'slowdowns', () => {
			instance.getCanvas().style.cursor = 'pointer';
		});
		instance.on('mouseleave', 'slowdowns', () => {
			instance.getCanvas().style.cursor = '';
		});

		instance.on('click', 'traffic-incidents', (event) => {
			const feature = event.features?.[0];
			if (!feature) return;
			const incident = feature.properties as TrafficIncidentProperties;
			const lines = [`<strong>${escapeHtml(incident.category ?? incident.source)}</strong>`];
			if (incident.displayName) lines.push(escapeHtml(incident.displayName));
			if (incident.roads) lines.push(escapeHtml(incident.roads));
			if (incident.advice) lines.push(escapeHtml(incident.advice));

			new Popup({ closeButton: false, offset: 10, maxWidth: '320px' })
				.setLngLat(event.lngLat)
				.setHTML(`<div style="font-size:12px;line-height:1.5">${lines.join('<br/>')}</div>`)
				.addTo(instance);
		});

		instance.on('click', 'bus-congestion', (event) => {
			const feature = event.features?.[0];
			if (!feature) return;
			const cell = feature.properties as BusCongestionProperties;

			new Popup({ closeButton: false, offset: 10, maxWidth: '280px' })
				.setLngLat(event.lngLat)
				.setHTML(
					`<div style="font-size:12px;line-height:1.5"><strong>Bus speed</strong><br/>` +
						`${cell.speedKmh.toFixed(0)} km/h average<br/>` +
						`${escapeHtml(cell.samples)} observations<br/>` +
						`<span style="color:#6b7280">Bus-speed proxy, not general traffic</span></div>`
				)
				.addTo(instance);
		});

		instance.on('click', 'live', (event) => {
			const feature = event.features?.[0];
			if (!feature) return;
			const vehicle = feature.properties as VehicleSnapshot;
			const route = vehicle.routeId ? escapeHtml(vehicle.routeId) : 'Unknown route';
			const seen = vehicle.observedAt
				? new Date(vehicle.observedAt).toLocaleTimeString('en-AU', {
						timeZone: 'Australia/Sydney'
					})
				: '—';
			const delay = vehicle.delayS;
			const delayText =
				delay == null
					? 'Delay unknown'
					: delay >= 60
						? `${Math.floor(delay / 60)} min late`
						: delay <= -60
							? `${Math.floor(-delay / 60)} min early`
							: 'On time';

			const nearby = (incidents?.features ?? [])
				.map((incident) => {
					const [lon, lat] = incident.geometry.coordinates;
					return {
						incident,
						distance: haversineMeters(vehicle.lat, vehicle.lon, lat, lon)
					};
				})
				.filter((item) => item.distance <= 750)
				.sort((a, b) => {
					const priority =
						Number(b.incident.properties.impactingNetwork) -
						Number(a.incident.properties.impactingNetwork);
					return priority !== 0 ? priority : a.distance - b.distance;
				})
				.slice(0, 3);

			const disruptionHtml = nearby.length
				? nearby
						.map(({ incident, distance }) => {
							const label =
								incident.properties.displayName ??
								incident.properties.headline ??
								incident.properties.category ??
								'Traffic incident';
							return `• ${escapeHtml(label)} (${Math.round(distance)} m)`;
						})
						.join('<br/>')
				: 'No nearby disruptions reported.';

			new Popup({ closeButton: false, offset: 10, maxWidth: '300px' })
				.setLngLat(event.lngLat)
				.setHTML(
					`<div style="font-size:12px;line-height:1.5"><strong>Route ${route}</strong><br/>` +
						`Vehicle ${escapeHtml(vehicle.vehicleId ?? '—')}<br/>` +
						`${escapeHtml(delayText)}<br/>` +
						`Seen ${escapeHtml(seen)}` +
						`<div style="margin-top:6px;border-top:1px solid #e5e7eb;padding-top:4px">` +
						`<strong>Nearby disruptions</strong><br/>${disruptionHtml}</div></div>`
				)
				.addTo(instance);
		});

		for (const layer of ['stops', 'stop-labels', 'busyness', 'traffic-incidents', 'bus-congestion', 'passed-stops']) {
			instance.on('mouseenter', layer, () => {
				instance.getCanvas().style.cursor = 'pointer';
			});
			instance.on('mouseleave', layer, () => {
				instance.getCanvas().style.cursor = '';
			});
		}
		instance.on('mouseenter', 'live', () => {
			instance.getCanvas().style.cursor = 'pointer';
		});
		instance.on('mouseleave', 'live', () => {
			instance.getCanvas().style.cursor = '';
		});
	}

	onMount(() => {
		const desktop = window.matchMedia('(min-width: 768px)').matches;
		const instance = new MapLibreMap({
			container,
			style: 'https://tiles.openfreemap.org/styles/positron',
			center: [151.05, -33.86],
			zoom: 9.5,
			hash: true,
			maxZoom: 20,
			attributionControl: false
		});

		map = instance;

		if (desktop) {
			instance.setPadding({ top: 0, right: 0, bottom: 0, left: 380 });
		}

		instance.addControl(new NavigationControl({ visualizePitch: true }), 'top-right');
		instance.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left');
		instance.addControl(new AttributionControl({ compact: true }), 'top-right');

		// MapLibre expands a compact attribution control by default and re-expands
		// it on resize. Collapse it so only the "i" button is visible until the
		// reader opens it.
		const collapseAttribution = () => {
			const attribution = instance
				.getContainer()
				.querySelector('.maplibregl-ctrl-attrib');
			attribution?.classList.remove('maplibregl-compact-show');
			attribution?.removeAttribute('open');
		};

		collapseAttribution();
		requestAnimationFrame(collapseAttribution);
		instance.on('resize', collapseAttribution);
		instance.once('load', collapseAttribution);

		instance.on('load', () => {
			addSourcesAndLayers(instance);
			styleReady = true;
		});

		instance.on('error', (event) => {
			error = event.error?.message ?? 'Map failed to load';
		});

		const events = new EventSource('/api/live');

		events.onmessage = (event) => {
			if (isPaused) return;
			try {
				const vehicles = JSON.parse(event.data) as VehicleSnapshot[];
				liveSource?.setData(toFeatures(vehicles));
				onLiveCount?.(vehicles.length);
			} catch {
				// Ignore a single malformed frame; the next poll replaces it.
			}
		};

		return () => {
			events.close();
			cancelHistoryAnimation();
			instance.remove();
			map = undefined;
		};
	});

	$effect(() => {
		isPaused = paused;
	});

	$effect(() => {
		if (!styleReady) return;
		const smooth = smoothHistory;

		if (history === null) {
			cancelHistoryAnimation();
			displayedPositions = new Map();
			lastHistory = null;
			return;
		}

		if (history === lastHistory) return;
		lastHistory = history;
		onLiveCount?.(history.length);
		applyHistory(history, smooth);
	});

	$effect(() => {
		if (!styleReady || isPaused) return;

		let cancelled = false;
		void fetch('/api/live?once=1')
			.then((response) => response.json())
			.then((vehicles: VehicleSnapshot[]) => {
				if (cancelled || isPaused) return;
				liveSource?.setData(toFeatures(vehicles));
				onLiveCount?.(vehicles.length);
			})
			.catch(() => {});

		return () => {
			cancelled = true;
		};
	});

	$effect(() => {
		if (!map || !styleReady) return;
		const visibility = showRoutes ? 'visible' : 'none';
		map.setLayoutProperty('shapes', 'visibility', visibility);
		map.setLayoutProperty('shapes-highlight', 'visibility', visibility);
	});

	$effect(() => {
		if (!map || !styleReady) return;
		if (viewMode === 'pace') {
			map.setPaintProperty('shapes', 'line-color', [
				'case',
				['==', ['get', 'minutes_per_km'], null],
				ROUTE_PACE_COLORS.unknown,
				[
					'interpolate',
					['linear'],
					['get', 'minutes_per_km'],
					ROUTE_PACE_SCALE.fast,
					ROUTE_PACE_COLORS.fast,
					ROUTE_PACE_SCALE.mid,
					ROUTE_PACE_COLORS.mid,
					ROUTE_PACE_SCALE.slow,
					ROUTE_PACE_COLORS.slow
				]
			]);
			map.setPaintProperty('shapes', 'line-opacity', 0.85);
			map.setPaintProperty('shapes', 'line-width', [
				'interpolate',
				['linear'],
				['zoom'],
				8,
				0.9,
				12,
				1.8,
				16,
				3.6
			]);
		} else {
			map.setPaintProperty('shapes', 'line-color', '#2563eb');
			map.setPaintProperty('shapes', 'line-opacity', viewMode === 'slowdowns' ? 0.06 : 0.2);
			map.setPaintProperty('shapes', 'line-width', [
				'interpolate',
				['linear'],
				['zoom'],
				8,
				0.6,
				12,
				1.4,
				16,
				3.6
			]);
		}
		map.setLayoutProperty(
			'slowdowns',
			'visibility',
			viewMode === 'slowdowns' ? 'visible' : 'none'
		);
	});

	$effect(() => {
		if (!map || !styleReady) return;
		map.setLayoutProperty(
			'suburb-fills',
			'visibility',
			showSuburbShading ? 'visible' : 'none'
		);
		if (map.getLayer('label_other')) {
			map.setLayoutProperty(
				'label_other',
				'visibility',
				showSuburbNames ? 'visible' : 'none'
			);
		}
	});

	$effect(() => {
		if (!map || !styleReady) return;
		const routeIds = selected?.routeIds ?? [];
		const shapeId = selected?.shapeId;
		map.setFilter(
			'shapes-highlight',
			shapeId
				? ['in', ['get', 'shape_id'], ['literal', [shapeId]]]
				: ['in', ['get', 'route_id'], ['literal', routeIds]]
		);
		map.setPaintProperty('shapes', 'line-opacity', selected ? 0.07 : 0.2);
	});

	$effect(() => {
		if (!map || !styleReady) return;
		(map.getSource('route-arrows') as GeoJSONSource | undefined)?.setData(
			routeArrows ?? empty
		);
	});

	$effect(() => {
		if (!map || !styleReady) return;
		map.setLayoutProperty(
			'route-arrows',
			'visibility',
			showRouteArrows && routeArrows ? 'visible' : 'none'
		);
	});

	$effect(() => {
		if (!map || !styleReady || !routeView) return;

		const desktop = window.matchMedia('(min-width: 768px)').matches;
		map.fitBounds(routeView.bounds, {
			padding: desktop ? { top: 60, bottom: 100, left: 400, right: 60 } : 60,
			duration: 900,
			maxZoom: 15
		});
	});

	$effect(() => {
		if (!map || !styleReady) return;
		const stopsVisible = showStops && !showBusyness;
		const visibility = stopsVisible ? 'visible' : 'none';
		map.setLayoutProperty('stops', 'visibility', visibility);
		map.setLayoutProperty('stop-labels', 'visibility', visibility);
		map.setLayoutProperty('busyness', 'visibility', showBusyness ? 'visible' : 'none');
	});

	$effect(() => {
		if (!map || !styleReady) return;
		map.setLayoutProperty(
			'traffic-lights',
			'visibility',
			showTrafficLights ? 'visible' : 'none'
		);
	});

	$effect(() => {
		if (!styleReady || busyness === null) return;
		busynessSource?.setData(busyness);
	});

	$effect(() => {
		if (!styleReady) return;
		incidentSource?.setData(incidents ?? empty);
		congestionSource?.setData(congestion ?? empty);
	});

	$effect(() => {
		if (!styleReady) return;
		passedStopsSource?.setData(passedStops ?? empty);
	});

	$effect(() => {
		if (!map || !styleReady) return;
		map.setLayoutProperty(
			'passed-stops',
			'visibility',
			showPassedStops && passedStops ? 'visible' : 'none'
		);
	});

	$effect(() => {
		if (!map || !styleReady) return;
		map.setLayoutProperty(
			'traffic-incidents',
			'visibility',
			showIncidents && incidents ? 'visible' : 'none'
		);
		map.setLayoutProperty(
			'bus-congestion',
			'visibility',
			showCongestion && congestion ? 'visible' : 'none'
		);
	});

	$effect(() => {
		if (!map || !styleReady) return;
		const stopFilter = filterStopIds ? inFilter('stop_id', filterStopIds) : null;
		map.setFilter('stops', stopFilter);
		map.setFilter('stop-labels', stopFilter);
		map.setFilter('busyness', filterStopIds ? inFilter('stopId', filterStopIds) : null);
	});

	$effect(() => {
		if (!map || !styleReady) return;
		map.setFilter('shapes', filterRouteIds ? inFilter('route_id', filterRouteIds) : null);
		map.setFilter('live', filterRouteIds ? inFilter('routeId', filterRouteIds) : null);
	});

	$effect(() => {
		if (!map || !styleReady || !filterBounds) return;

		const desktop = window.matchMedia('(min-width: 768px)').matches;
		map.fitBounds(filterBounds, {
			padding: desktop ? { top: 60, bottom: 100, left: 400, right: 60 } : 60,
			duration: 800,
			maxZoom: 14
		});
	});

	$effect(() => {
		if (!map || !styleReady) return;
		map.setLayoutProperty(
			'live',
			'visibility',
			showLive && !showBusyness ? 'visible' : 'none'
		);
	});

	$effect(() => {
		if (!map || !styleReady || !focus) return;
		map.flyTo({
			center: [focus.lon, focus.lat],
			zoom: focus.zoom ?? 16,
			duration: 900
		});
	});

	$effect(() => {
		if (!styleReady) return;
		selectedSource?.setData(
			selected
				? {
						type: 'FeatureCollection',
						features: [
							{
								type: 'Feature',
								geometry: { type: 'Point', coordinates: [selected.lon, selected.lat] },
								properties: {}
							}
						]
					}
				: empty
		);
	});
</script>

<div class="relative h-full w-full">
	<div bind:this={container} class="h-full w-full" aria-label="Bus network map"></div>

	{#if error}
		<div
			class="absolute inset-x-0 top-3 z-20 mx-auto w-fit rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive"
		>
			{error}
		</div>
	{/if}
</div>
