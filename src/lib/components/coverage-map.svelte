<script lang="ts">
	import { onMount } from 'svelte';
	import {
		AttributionControl,
		Map as MapLibreMap,
		NavigationControl,
		ScaleControl,
		setWorkerUrl,
		type GeoJSONSource,
		type ImageSource
	} from 'maplibre-gl';
	import mapLibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
	import type { FeatureCollection, Point } from 'geojson';
	import 'maplibre-gl/dist/maplibre-gl.css';

	setWorkerUrl(mapLibreWorkerUrl);

	interface CoverageStop {
		stopId: string;
		stopName: string;
		lat: number;
		lon: number;
	}

	export interface CoverageStats {
		cells: number;
		areaM2: number;
		stops: number;
		distance: number;
		cellArea: number;
		zoom: number;
	}

	let {
		distance = 400,
		cellArea = 100,
		activeAt = null,
		onStats
	}: {
		distance?: number;
		cellArea?: number;
		activeAt?: string | null;
		onStats?: (stats: CoverageStats | null) => void;
	} = $props();

	const MAX_CELLS = 2_000_000;
	const IMAGE_SIZE = 1024;
	const TRANSPARENT =
		'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
	const empty: FeatureCollection = { type: 'FeatureCollection', features: [] };

	let container: HTMLDivElement;
	let map: MapLibreMap | undefined;
	let coverageSource: ImageSource | undefined;
	let stopsSource: GeoJSONSource | undefined;
	let canvas: HTMLCanvasElement | undefined;
	let stops: CoverageStop[] = [];
	let stopsLoaded = $state(false);
	let mapReady = $state(false);
	let error = $state<string | null>(null);
	let computeTimer: ReturnType<typeof setTimeout> | undefined;
	let stopController: AbortController | undefined;

	const R = 6378137;
	const MAX_LAT = 85.05112878;

	function lonToX(lon: number): number {
		return (lon * Math.PI / 180) * R;
	}

	function latToY(lat: number): number {
		const clamped = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
		return R * Math.log(Math.tan(Math.PI / 4 + (clamped * Math.PI) / 360));
	}

	function coordinatesFromMap(): [[number, number], [number, number], [number, number], [number, number]] | null {
		if (!map) return null;
		const bounds = map.getBounds();
		const west = bounds.getWest();
		const south = bounds.getSouth();
		const east = bounds.getEast();
		const north = bounds.getNorth();
		return [
			[west, north],
			[east, north],
			[east, south],
			[west, south]
		];
	}

	function updateStopsLayer() {
		stopsSource?.setData({
			type: 'FeatureCollection',
			features: stops.map((stop) => ({
				type: 'Feature',
				geometry: { type: 'Point', coordinates: [stop.lon, stop.lat] },
				properties: { stopId: stop.stopId, stopName: stop.stopName }
			}))
		});
	}

	async function loadStops() {
		stopController?.abort();
		const controller = new AbortController();
		stopController = controller;
		stopsLoaded = false;
		const params = new URLSearchParams();
		if (activeAt) {
			params.set('active', '1');
			params.set('at', activeAt);
		}

		try {
			const response = await fetch(`/api/coverage/stops?${params}`, {
				signal: controller.signal
			});
			if (!response.ok) throw new Error('stop request failed');
			const body = (await response.json()) as CoverageStop[];
			if (stopController !== controller) return;
			stops = body;
			stopsLoaded = true;
			updateStopsLayer();
			scheduleCompute();
		} catch (requestError) {
			if (controller.signal.aborted) return;
			error = requestError instanceof Error ? requestError.message : 'Could not load stops';
			onStats?.(null);
		}
	}

	function scheduleCompute() {
		if (computeTimer) clearTimeout(computeTimer);
		computeTimer = setTimeout(() => computeCoverage(), 100);
	}

	function waterMaskData(
		viewX0: number,
		viewY0: number,
		viewX1: number,
		viewY1: number
	): Uint8ClampedArray | null {
		if (!map) return null;
		const waterLayerIds = map
			.getStyle()
			.layers.filter(
				(layer) =>
					layer.type === 'fill' &&
					(layer.id === 'water' ||
						('source-layer' in layer && layer['source-layer'] === 'water'))
			)
			.map((layer) => layer.id);
		if (waterLayerIds.length === 0) return null;

		const features = map.queryRenderedFeatures({ layers: waterLayerIds });
		if (features.length === 0) return null;

		const mask = document.createElement('canvas');
		mask.width = IMAGE_SIZE;
		mask.height = IMAGE_SIZE;
		const context = mask.getContext('2d');
		if (!context) return null;
		context.fillStyle = '#ffffff';

		const project = (lon: number, lat: number): [number, number] => [
			((lonToX(lon) - viewX0) / (viewX1 - viewX0)) * IMAGE_SIZE,
			((viewY1 - latToY(lat)) / (viewY1 - viewY0)) * IMAGE_SIZE
		];

		for (const feature of features) {
			const geometry = feature.geometry;
			if (!geometry) continue;
			const polygons =
				geometry.type === 'Polygon'
					? [geometry.coordinates]
					: geometry.type === 'MultiPolygon'
						? geometry.coordinates
						: [];

			for (const polygon of polygons) {
				context.beginPath();
				for (const ring of polygon) {
					ring.forEach((coordinate, index) => {
						const [x, y] = project(coordinate[0], coordinate[1]);
						if (index === 0) context.moveTo(x, y);
						else context.lineTo(x, y);
					});
					context.closePath();
				}
				context.fill('evenodd');
			}
		}

		return context.getImageData(0, 0, IMAGE_SIZE, IMAGE_SIZE).data;
	}

	function clearCoverage() {
		if (!coverageSource) return;
		const coordinates = coordinatesFromMap();
		if (!coordinates) return;
		if (!canvas) {
			canvas = document.createElement('canvas');
			canvas.width = IMAGE_SIZE;
			canvas.height = IMAGE_SIZE;
		}
		const context = canvas.getContext('2d');
		if (!context) return;
		context.clearRect(0, 0, IMAGE_SIZE, IMAGE_SIZE);
		coverageSource.updateImage({ image: canvas, coordinates });
	}

	function computeCoverage() {
		if (!map || !coverageSource || !stopsLoaded) return;
		const cellSize = Math.sqrt(cellArea);

		const bounds = map.getBounds();
		const west = bounds.getWest();
		const south = bounds.getSouth();
		const east = bounds.getEast();
		const north = bounds.getNorth();
		const viewX0 = lonToX(west);
		const viewX1 = lonToX(east);
		const viewY0 = latToY(south);
		const viewY1 = latToY(north);
		const distanceM = Math.max(10, distance);
		const gridX0 = viewX0 - distanceM - cellSize;
		const gridX1 = viewX1 + distanceM + cellSize;
		const gridY0 = viewY0 - distanceM - cellSize;
		const gridY1 = viewY1 + distanceM + cellSize;
		const cols = Math.ceil((gridX1 - gridX0) / cellSize);
		const rows = Math.ceil((gridY1 - gridY0) / cellSize);

		if (cols * rows > MAX_CELLS) {
			error = `Too many ${cellArea} m² cells here. Zoom in or increase the cell size.`;
			clearCoverage();
			onStats?.(null);
			return;
		}

		const distances = new Float32Array(cols * rows);
		distances.fill(1e9);

		for (const stop of stops) {
			const x = lonToX(stop.lon);
			const y = latToY(stop.lat);
			if (x < gridX0 || x >= gridX1 || y < gridY0 || y >= gridY1) continue;
			const col = Math.floor((x - gridX0) / cellSize);
			const row = Math.floor((gridY1 - y) / cellSize);
			if (col < 0 || col >= cols || row < 0 || row >= rows) continue;
			distances[row * cols + col] = 0;
		}

		const diagonal = Math.SQRT2;
		for (let row = 0; row < rows; row += 1) {
			const base = row * cols;
			for (let col = 0; col < cols; col += 1) {
				let d = distances[base + col];
				if (col > 0) d = Math.min(d, distances[base + col - 1] + 1);
				if (row > 0) {
					d = Math.min(d, distances[base - cols + col] + 1);
					if (col > 0) d = Math.min(d, distances[base - cols + col - 1] + diagonal);
					if (col < cols - 1) d = Math.min(d, distances[base - cols + col + 1] + diagonal);
				}
				distances[base + col] = d;
			}
		}

		for (let row = rows - 1; row >= 0; row -= 1) {
			const base = row * cols;
			for (let col = cols - 1; col >= 0; col -= 1) {
				let d = distances[base + col];
				if (col < cols - 1) d = Math.min(d, distances[base + col + 1] + 1);
				if (row < rows - 1) {
					d = Math.min(d, distances[base + cols + col] + 1);
					if (col < cols - 1) d = Math.min(d, distances[base + cols + col + 1] + diagonal);
					if (col > 0) d = Math.min(d, distances[base + cols + col - 1] + diagonal);
				}
				distances[base + col] = d;
			}
		}

		const viewCol0 = Math.max(0, Math.floor((viewX0 - gridX0) / cellSize));
		const viewCol1 = Math.min(cols, Math.ceil((viewX1 - gridX0) / cellSize));
		const viewRow0 = Math.max(0, Math.floor((gridY1 - viewY1) / cellSize));
		const viewRow1 = Math.min(rows, Math.ceil((gridY1 - viewY0) / cellSize));
		const viewCols = viewCol1 - viewCol0;
		const viewRows = viewRow1 - viewRow0;

		if (viewCols <= 0 || viewRows <= 0) return;

		if (!canvas) {
			canvas = document.createElement('canvas');
			canvas.width = IMAGE_SIZE;
			canvas.height = IMAGE_SIZE;
		}
		const context = canvas.getContext('2d');
		if (!context) return;
		context.clearRect(0, 0, IMAGE_SIZE, IMAGE_SIZE);
		context.fillStyle = '#dc2626';

		const thresholdCells = distanceM / cellSize;
		const cellWidth = IMAGE_SIZE / viewCols;
		const cellHeight = IMAGE_SIZE / viewRows;
		const waterMask = waterMaskData(viewX0, viewY0, viewX1, viewY1);
		let unserviced = 0;

		for (let row = viewRow0; row < viewRow1; row += 1) {
			const base = row * cols;
			for (let col = viewCol0; col < viewCol1; col += 1) {
				if (distances[base + col] <= thresholdCells) continue;
				if (waterMask) {
					const pixelX = Math.min(
						IMAGE_SIZE - 1,
						Math.max(0, Math.floor((col - viewCol0 + 0.5) * cellWidth))
					);
					const pixelY = Math.min(
						IMAGE_SIZE - 1,
						Math.max(0, Math.floor((row - viewRow0 + 0.5) * cellHeight))
					);
					if (waterMask[(pixelY * IMAGE_SIZE + pixelX) * 4 + 3] > 0) continue;
				}
				unserviced += 1;
				context.fillRect(
					(col - viewCol0) * cellWidth,
					(row - viewRow0) * cellHeight,
					cellWidth + 0.25,
					cellHeight + 0.25
				);
			}
		}

		const coordinates = coordinatesFromMap();
		if (!coordinates) return;
		coverageSource.updateImage({ image: canvas, coordinates });
		error = null;
		onStats?.({
			cells: unserviced,
			areaM2: unserviced * cellArea,
			stops: stops.length,
			distance: distanceM,
			cellArea,
			zoom: map.getZoom()
		});
	}

	$effect(() => {
		if (!mapReady) return;
		void loadStops();
	});

	$effect(() => {
		const distanceMeters = distance;
		const area = cellArea;
		if (!mapReady) return;
		void distanceMeters;
		void area;
		scheduleCompute();
	});

	onMount(() => {
		const instance = new MapLibreMap({
			container,
			style: 'https://tiles.openfreemap.org/styles/positron',
			center: [151.05, -33.86],
			zoom: 16,
			hash: true,
			maxZoom: 20,
			dragRotate: false,
			pitchWithRotate: false,
			attributionControl: false
		});
		map = instance;
		instance.addControl(new NavigationControl({ showCompass: false }), 'top-right');
		instance.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left');
		instance.addControl(new AttributionControl({ compact: true }), 'bottom-right');

		instance.on('load', () => {
			const coordinates = coordinatesFromMap();
			if (!coordinates) return;
			instance.addSource('coverage', {
				type: 'image',
				url: TRANSPARENT,
				coordinates
			});
			instance.addLayer({
				id: 'coverage',
				type: 'raster',
				source: 'coverage',
				paint: {
					'raster-opacity': 0.65,
					'raster-resampling': 'nearest',
					'raster-fade-duration': 0
				}
			});
			instance.addSource('coverage-stops', { type: 'geojson', data: empty });
			instance.addLayer({
				id: 'coverage-stops',
				type: 'circle',
				source: 'coverage-stops',
				paint: {
					'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 1.5, 16, 3.5, 20, 5],
					'circle-color': '#1d4ed8',
					'circle-opacity': 0.9,
					'circle-stroke-color': '#ffffff',
					'circle-stroke-width': 0.8
				}
			});
			coverageSource = instance.getSource('coverage') as ImageSource;
			stopsSource = instance.getSource('coverage-stops') as GeoJSONSource;
			mapReady = true;
			instance.on('moveend', scheduleCompute);
			instance.once('idle', scheduleCompute);
			scheduleCompute();
		});
		instance.on('error', (event) => {
			console.error('coverage map error', event.error?.message);
		});

		return () => {
			if (computeTimer) clearTimeout(computeTimer);
			stopController?.abort();
			instance.remove();
		};
	});
</script>

<div bind:this={container} class="h-full w-full"></div>

{#if error}
	<div
		class="pointer-events-none absolute top-3 right-3 z-10 max-w-xs rounded-md border bg-background/95 px-3 py-2 text-xs shadow-lg"
	>
		{error}
	</div>
{/if}
