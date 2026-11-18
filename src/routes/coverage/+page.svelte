<script lang="ts">
	import { onMount } from 'svelte';
	import { Clock, Footprints } from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import {
		Card,
		CardContent,
		CardHeader,
		CardTitle
	} from '#lib/components/ui/card/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Switch } from '#lib/components/ui/switch/index.js';
	import CoverageMap from '#lib/components/coverage-map.svelte';
	import { formatNumber } from '#lib/format.js';

	interface CoverageStats {
		cells: number;
		areaM2: number;
		stops: number;
		distance: number;
		cellArea: number;
		zoom: number;
	}

	let distance = $state(400);
	let cellArea = $state(100);
	let activeOnly = $state(false);
	let activeMode = $state<'now' | 'time'>('now');
	let activeAt = $state('');
	let stats = $state<CoverageStats | null>(null);

	const activeAtParam = $derived.by(() => {
		if (!activeOnly) return null;
		if (activeMode === 'now') return 'now';
		const parsed = new Date(activeAt);
		return Number.isNaN(parsed.getTime()) ? 'now' : parsed.toISOString();
	});

	function toLocalInput(date: Date): string {
		const pad = (value: number) => String(value).padStart(2, '0');
		return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
	}

	function resetActiveTime() {
		activeAt = toLocalInput(new Date());
	}

	onMount(() => {
		resetActiveTime();
	});
</script>

<svelte:head>
	<title>Stop coverage · NSW Bus Network</title>
</svelte:head>

<div class="relative h-full">
	<CoverageMap {distance} {cellArea} activeAt={activeAtParam} onStats={(value) => (stats = value)} />

	<aside
		class="absolute inset-x-3 top-3 z-10 flex max-h-[45dvh] w-auto flex-col gap-2.5 overflow-y-auto [&>*]:shrink-0 md:inset-x-auto md:left-3 md:max-h-[calc(100%-1.5rem)] md:w-[352px]"
	>
		<Card class="gap-3 py-3">
			<CardHeader class="px-3">
				<CardTitle class="text-sm">Stop coverage</CardTitle>
			</CardHeader>
			<CardContent class="space-y-3 px-3">
				<p class="text-xs text-muted-foreground">
					Find areas farther than the chosen walking distance from a bus stop. Cells are
					{formatNumber(cellArea)} m²; distance is straight-line. Cells over water are ignored.
				</p>

				<div class="space-y-1.5">
					<label for="coverage-cell-area" class="flex items-center justify-between gap-3 text-sm">
						<span class="flex items-center gap-2">
							<Footprints class="size-3.5 text-muted-foreground" /> Cell size
						</span>
						<span class="font-medium tabular-nums">{formatNumber(cellArea)} m²</span>
					</label>
					<input
						id="coverage-cell-area"
						type="range"
						min="100"
						max="10000"
						step="100"
						value={cellArea}
						oninput={(event) => (cellArea = Number(event.currentTarget.value))}
						class="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary"
						aria-label="Coverage cell size"
					/>
					<div class="flex justify-between text-[10px] text-muted-foreground">
						<span>100 m²</span>
						<span>10,000 m²</span>
					</div>
				</div>

				<div class="space-y-1.5">
					<label for="coverage-distance" class="flex items-center justify-between gap-3 text-sm">
						<span class="flex items-center gap-2">
							<Footprints class="size-3.5 text-muted-foreground" /> Walking distance
						</span>
						<span class="font-medium tabular-nums">{distance} m</span>
					</label>
					<input
						id="coverage-distance"
						type="range"
						min="50"
						max="1000"
						step="25"
						value={distance}
						oninput={(event) => (distance = Number(event.currentTarget.value))}
						class="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary"
					/>
					<div class="flex justify-between text-[10px] text-muted-foreground">
						<span>50 m</span>
						<span>1 km</span>
					</div>
				</div>

				<label class="flex items-center justify-between gap-3 text-sm">
					<span class="flex items-center gap-2">
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
						{/if}
						<p class="text-[10px] text-muted-foreground">
							Only stops served by routes active at this time count toward coverage.
						</p>
					</div>
				{/if}

				<div class="rounded-md border bg-muted/40 p-2.5">
					{#if stats}
						<div class="grid grid-cols-2 gap-x-3 gap-y-2">
							<div>
								<div class="text-lg font-semibold tabular-nums">
									{formatNumber(stats.cells)}
								</div>
								<div class="text-[10px] tracking-wide text-muted-foreground uppercase">
									{formatNumber(stats.cellArea)} m² cells
								</div>
							</div>
							<div>
								<div class="text-lg font-semibold tabular-nums">
									{(stats.areaM2 / 1_000_000).toFixed(2)} km²
								</div>
								<div class="text-[10px] tracking-wide text-muted-foreground uppercase">
									Unserviced area
								</div>
							</div>
							<div>
								<div class="text-sm font-medium tabular-nums">
									{formatNumber(stats.stops)}
								</div>
								<div class="text-[10px] tracking-wide text-muted-foreground uppercase">
									Stops considered
								</div>
							</div>
							<div>
								<div class="text-sm font-medium tabular-nums">{stats.distance} m</div>
								<div class="text-[10px] tracking-wide text-muted-foreground uppercase">
									Radius
								</div>
							</div>
						</div>
					{:else}
						<p class="text-xs text-muted-foreground">
							Zoom in or increase the cell size to calculate coverage.
						</p>
					{/if}
				</div>

				<div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
					<span class="flex items-center gap-1">
						<span class="size-2.5 rounded-sm bg-[#dc2626]"></span> Unserviced
					</span>
					<span class="flex items-center gap-1">
						<span class="size-2 rounded-full bg-[#1d4ed8]"></span> Stop
					</span>
					<span class="ml-auto">Larger cells allow lower zoom</span>
				</div>
			</CardContent>
		</Card>
	</aside>
</div>
