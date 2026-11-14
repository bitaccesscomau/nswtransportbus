<script lang="ts">
	import { ArrowLeft, Settings } from '@lucide/svelte';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Card, CardContent, CardHeader, CardTitle } from '#lib/components/ui/card/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import {
		confidence,
		metricLabel,
		metricValue,
		settings
	} from '#lib/settings.svelte.js';
	import type { BusynessCell } from '#lib/server/queries.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const days = [
		{ value: 1, label: 'Mon' },
		{ value: 2, label: 'Tue' },
		{ value: 3, label: 'Wed' },
		{ value: 4, label: 'Thu' },
		{ value: 5, label: 'Fri' },
		{ value: 6, label: 'Sat' },
		{ value: 7, label: 'Sun' }
	];

	const heatClasses = [
		'bg-muted/40',
		'bg-amber-100',
		'bg-amber-200',
		'bg-amber-300',
		'bg-amber-400',
		'bg-red-500'
	];

	const routeBadges = $derived([
		...new Map(
			data.stop.routes.map((route) => [
				route.shortName ?? route.longName ?? route.routeId,
				route
			])
		).values()
	]);

	const cellsByKey = $derived(
		new Map(data.busyness.cells.map((cell) => [`${cell.dow}-${cell.hour}`, cell]))
	);

	const cellsWithValues = $derived.by(() =>
		days.flatMap((day) =>
			Array.from({ length: 24 }, (_, hour) => {
				const cell = cellsByKey.get(`${day.value}-${hour}`) ?? null;
				return {
					day,
					hour,
					cell,
					value: cell ? metricValue(cell) : null
				};
			})
		)
	);

	const maxValue = $derived.by(() => {
		const values = cellsWithValues
			.map((cell) => cell.value)
			.filter((value): value is number => value !== null && value > 0)
			.sort((a, b) => a - b);

		return values.length > 0 ? values[Math.floor(values.length * 0.95)] : 1;
	});

	const routeRows = $derived(
		data.busyness.routes
			.map((route) => ({
				...route,
				value: metricValue(route),
				confidence: confidence(route.samples)
			}))
			.sort((a, b) => b.value - a.value)
	);

	function level(value: number | null): number {
		if (value === null || value <= 0) return 0;
		return Math.min(5, Math.ceil((value / maxValue) * 5));
	}

	function cellClass(cell: BusynessCell | null, value: number | null): string {
		if (!cell) return 'bg-muted/40';
		if (value === null || value <= 0) return 'bg-slate-200';
		const heat = heatClasses[level(value)];
		return cell.samples < settings.lowSample ? `${heat} opacity-40` : heat;
	}

	function cellTitle(day: string, hour: number, cell: BusynessCell | null): string {
		const time = `${day} ${String(hour).padStart(2, '0')}:00`;
		if (!cell) return `${time} · no observations`;
		return `${time} · ${formatValue(metricValue(cell))} · ${cell.samples}/${cell.events} samples · ${confidence(cell.samples)} confidence`;
	}

	function formatValue(value: number): string {
		return value.toFixed(2);
	}

	function confidenceClass(value: 'low' | 'medium' | 'high'): string {
		if (value === 'low') return 'border-amber-300 bg-amber-50 text-amber-700';
		if (value === 'medium') return 'border-sky-300 bg-sky-50 text-sky-700';
		return 'border-emerald-300 bg-emerald-50 text-emerald-700';
	}
</script>

<svelte:head>
	<title>{data.stop.stopName} · Busyness · NSW Bus Network</title>
</svelte:head>

<div class="h-full overflow-y-auto">
	<div class="mx-auto max-w-5xl space-y-5 p-5">
		<div class="flex flex-wrap items-start justify-between gap-3">
			<div>
				<Button variant="ghost" size="sm" href="/" class="-ml-2 mb-1">
					<ArrowLeft class="size-3.5" /> Back to map
				</Button>
				<h1 class="text-xl font-semibold tracking-tight">{data.stop.stopName}</h1>
				<p class="font-mono text-xs text-muted-foreground">Stop {data.stop.stopId}</p>
			</div>
			<Button variant="outline" size="sm" href="/settings">
				<Settings class="size-3.5" /> Settings
			</Button>
		</div>

		<div class="flex flex-wrap gap-1">
			{#each routeBadges as route (route.shortName ?? route.longName ?? route.routeId)}
				<Badge variant="outline" class="border-violet-300 bg-violet-50 text-violet-700">
					{route.shortName ?? route.longName ?? route.routeId}
				</Badge>
			{/each}
		</div>

		<Card class="gap-3 py-4">
			<CardHeader class="px-4">
				<CardTitle class="text-sm">Day-of-week × hour busyness</CardTitle>
				<p class="text-xs text-muted-foreground">
					{metricLabel()} · {settings.metric === 'gross'
						? `${(settings.alightingRate * 100).toFixed(0)}% alighting assumption`
						: 'seat-equivalents'} · positive = net boardings
				</p>
			</CardHeader>
			<CardContent class="px-4">
				<div class="overflow-x-auto">
					<div
						class="grid min-w-[720px] gap-0.5"
						style="grid-template-columns: 40px repeat(24, minmax(0, 1fr));"
					>
						<div></div>
						{#each Array.from({ length: 24 }, (_, hour) => hour) as hour (hour)}
							<div class="pb-1 text-center text-[9px] text-muted-foreground">
								{hour % 3 === 0 ? String(hour).padStart(2, '0') : ''}
							</div>
						{/each}

						{#each days as day (day.value)}
							<div class="flex items-center text-[10px] text-muted-foreground">{day.label}</div>
							{#each Array.from({ length: 24 }, (_, hour) => hour) as hour (hour)}
								{@const cell = cellsByKey.get(`${day.value}-${hour}`) ?? null}
								{@const value = cell ? metricValue(cell) : null}
								<div
									class="h-6 rounded-[2px] {cellClass(cell, value)}"
									title={cellTitle(day.label, hour, cell)}
								></div>
							{/each}
						{/each}
					</div>
				</div>

				<div class="mt-3 flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
					<span class="flex items-center gap-1">
						<span class="size-2.5 rounded-[2px] bg-muted/40"></span> no data
					</span>
					<span class="flex items-center gap-1">
						<span class="size-2.5 rounded-[2px] bg-slate-200"></span> no net change
					</span>
					<span class="flex items-center gap-1">
						<span class="size-2.5 rounded-[2px] bg-amber-100"></span> low
					</span>
					<span class="flex items-center gap-1">
						<span class="size-2.5 rounded-[2px] bg-amber-400"></span> high
					</span>
					<span class="flex items-center gap-1">
						<span class="size-2.5 rounded-[2px] bg-red-500"></span> highest
					</span>
					<span>Faded cells have fewer than {settings.lowSample} samples.</span>
				</div>
			</CardContent>
		</Card>

		<Card class="gap-2 py-4">
			<CardHeader class="px-4">
				<CardTitle class="text-sm">By route</CardTitle>
				<p class="text-xs text-muted-foreground">Combined directions, all observed days.</p>
			</CardHeader>
			<CardContent class="px-0">
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head class="pl-4">Route</Table.Head>
							<Table.Head class="text-right">Events</Table.Head>
							<Table.Head class="text-right">Samples</Table.Head>
							<Table.Head class="text-right">{metricLabel()}</Table.Head>
							<Table.Head class="pr-4">Confidence</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each routeRows as route, index (route.routeId ?? 'unknown' + index)}
							<Table.Row>
								<Table.Cell class="pl-4">
									<Badge variant="outline" class="border-violet-300 bg-violet-50 text-violet-700">
										{route.shortName ?? route.routeId ?? 'Unknown'}
									</Badge>
								</Table.Cell>
								<Table.Cell class="text-right text-xs tabular-nums">{route.events}</Table.Cell>
								<Table.Cell class="text-right text-xs tabular-nums">{route.samples}</Table.Cell>
								<Table.Cell class="text-right text-xs font-medium tabular-nums">
									{formatValue(route.value)}
								</Table.Cell>
								<Table.Cell class="pr-4">
									<Badge variant="outline" class={confidenceClass(route.confidence)}>
										{route.confidence}
									</Badge>
								</Table.Cell>
							</Table.Row>
						{:else}
							<Table.Row>
								<Table.Cell colspan={5} class="text-sm text-muted-foreground">
									No stop observations yet. Busyness appears as the collector runs.
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</CardContent>
		</Card>

		<Card class="gap-2 py-4">
			<CardHeader class="px-4">
				<CardTitle class="text-sm">How this is estimated</CardTitle>
			</CardHeader>
			<CardContent class="space-y-2 px-4 text-xs leading-relaxed text-muted-foreground">
				<p>
					Each realised stop compares the vehicle's occupancy band just before arrival with the
					band just after departure. The difference is a net load change; positive means more
					passengers boarded than alighted.
				</p>
				<p>
					Bands are seat-based and coarse: EMPTY 0, MANY 0.25, FEW 0.75, STANDING 1.1,
					CRUSHED 1.3, FULL 1.5 seat-equivalents. The feed does not provide passenger counts.
					Use the pattern across hours and routes, not individual cell precision.
				</p>
				<p>
					Low confidence means fewer than {settings.lowSample} usable observations. Missing
					occupancy is excluded from averages and visible in the sample count.
				</p>
				<p>
					TfNSW publishes stop-time predictions mainly at timing points, so ordinary stops may
					have fewer events than the routes serving them suggest.
				</p>
				<p>Cell colours are relative to the observed range across this stop's grid.</p>
			</CardContent>
		</Card>
	</div>
</div>
