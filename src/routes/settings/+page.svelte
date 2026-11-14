<script lang="ts">
	import { Card, CardContent, CardHeader, CardTitle } from '#lib/components/ui/card/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Separator } from '#lib/components/ui/separator/index.js';
	import {
		metricLabel,
		saveSettings,
		settings,
		type Metric
	} from '#lib/settings.svelte.js';

	const metrics: { value: Metric; label: string; description: string }[] = [
		{
			value: 'net',
			label: 'Net change',
			description:
				'Boardings minus alightings, in seat-equivalents. This is the quantity the occupancy change actually measures.'
		},
		{
			value: 'gross',
			label: 'Modelled gross boardings',
			description:
				'Adds an assumed alighting share of the before-stop load. Transparent but not measured; tune the rate below.'
		},
		{
			value: 'band',
			label: 'Band-change index',
			description:
				'Ordinal change in occupancy band (MANY → FEW = +1). No passenger or capacity assumption.'
		}
	];

	$effect(() => {
		settings.metric;
		settings.alightingRate;
		settings.lowSample;
		settings.showConfidence;
		saveSettings();
	});
</script>

<svelte:head>
	<title>Settings · NSW Bus Network</title>
</svelte:head>

<div class="h-full overflow-y-auto">
	<div class="mx-auto max-w-2xl space-y-5 p-5">
		<div>
			<h1 class="text-xl font-semibold tracking-tight">Settings</h1>
			<p class="text-sm text-muted-foreground">
				Saved locally in this browser. Applies to the stop busyness page and the map heatmap.
			</p>
		</div>

		<Card class="gap-3 py-4">
			<CardHeader class="px-4">
				<CardTitle class="text-sm">Busyness metric</CardTitle>
			</CardHeader>
			<CardContent class="space-y-3 px-4">
				{#each metrics as metric (metric.value)}
					<label class="flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors hover:bg-muted/50">
						<input
							type="radio"
							name="metric"
							value={metric.value}
							bind:group={settings.metric}
							class="mt-0.5 accent-primary"
						/>
						<span>
							<span class="block text-sm font-medium">{metric.label}</span>
							<span class="mt-0.5 block text-xs text-muted-foreground">{metric.description}</span>
						</span>
					</label>
				{/each}

				<Separator />

				<label class="flex items-center justify-between gap-4">
					<span>
						<span class="block text-sm">Alighting rate for modelled gross</span>
						<span class="text-xs text-muted-foreground">
							Share of the before-stop load assumed to alight at each stop.
						</span>
					</span>
					<Input
						type="number"
						bind:value={settings.alightingRate}
						min="0"
						max="1"
						step="0.01"
						class="w-24 text-right"
					/>
				</label>
			</CardContent>
		</Card>

		<Card class="gap-3 py-4">
			<CardHeader class="px-4">
				<CardTitle class="text-sm">Confidence</CardTitle>
			</CardHeader>
			<CardContent class="space-y-3 px-4">
				<label class="flex items-center justify-between gap-4">
					<span>
						<span class="block text-sm">Low-sample threshold</span>
						<span class="text-xs text-muted-foreground">
							Cells below this many usable observations are marked low confidence.
						</span>
					</span>
					<Input
						type="number"
						bind:value={settings.lowSample}
						min="1"
						step="1"
						class="w-24 text-right"
					/>
				</label>

				<label class="flex items-center gap-3 text-sm">
					<input type="checkbox" bind:checked={settings.showConfidence} class="accent-primary" />
					Show sample counts and confidence labels
				</label>
			</CardContent>
		</Card>

		<Card class="gap-2 py-4">
			<CardHeader class="px-4">
				<CardTitle class="text-sm">About the estimate</CardTitle>
			</CardHeader>
			<CardContent class="space-y-2 px-4 text-xs leading-relaxed text-muted-foreground">
				<p>
					Current metric: <strong class="text-foreground">{metricLabel()}</strong>. Values are in
					seat-equivalents, derived from occupancy bands:
					EMPTY 0, MANY 0.25, FEW 0.75, STANDING 1.1, CRUSHED 1.3, FULL 1.5.
				</p>
				<p>
					The feed reports occupancy bands, not passenger counts. A band change is therefore a
					coarse estimate; a positive net change means more passengers boarded than alighted at
					that stop.
				</p>
				<p>
					Stop events are matched from trip-update arrival/departure predictions and the last
					position before arrival versus the first position after departure. Missing data is
					excluded from averages and shown in the sample count.
				</p>
			</CardContent>
		</Card>
	</div>
</div>
