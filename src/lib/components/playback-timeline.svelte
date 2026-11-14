<script lang="ts">
	import { FastForward, Pause, Play, Radio, Rewind } from '@lucide/svelte';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';

	let {
		bounds,
		value,
		playing,
		speed,
		mode,
		loading,
		onchange,
		ontoggle,
		onstep,
		onspeed,
		onlive
	}: {
		bounds: { min: number; max: number } | null;
		value: number;
		playing: boolean;
		speed: number;
		mode: 'live' | 'history';
		loading: boolean;
		onchange: (value: number) => void;
		ontoggle: () => void;
		onstep: (seconds: number) => void;
		onspeed: (speed: number) => void;
		onlive: () => void;
	} = $props();

	const timeFormat = new Intl.DateTimeFormat('en-AU', {
		timeZone: 'Australia/Sydney',
		weekday: 'short',
		day: '2-digit',
		month: 'short',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hour12: false
	});

	const speeds = [
		{ value: 1, label: '1×' },
		{ value: 10, label: '10×' },
		{ value: 60, label: '60×' },
		{ value: 300, label: '300×' },
		{ value: 1800, label: '1800×' }
	];

	const formatTime = (milliseconds: number) => timeFormat.format(new Date(milliseconds));
</script>

<div class="absolute right-3 bottom-3 left-3 z-10 md:left-[392px]">
	<div class="rounded-lg border bg-background/95 p-2.5 shadow-lg backdrop-blur">
		<div class="flex items-center gap-1.5">
			<Button variant="ghost" size="icon-sm" onclick={() => onstep(-60)} aria-label="Back one minute">
				<Rewind class="size-4" />
			</Button>
			<Button
				size="icon-sm"
				onclick={ontoggle}
				aria-label={playing ? 'Pause playback' : 'Play history'}
			>
				{#if playing}
					<Pause class="size-4" />
				{:else}
					<Play class="size-4" />
				{/if}
			</Button>
			<Button variant="ghost" size="icon-sm" onclick={() => onstep(60)} aria-label="Forward one minute">
				<FastForward class="size-4" />
			</Button>

			<select
				class="h-8 rounded-md border bg-background px-1.5 text-xs tabular-nums outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
				aria-label="Playback speed"
				value={speed}
				onchange={(event) => onspeed(Number(event.currentTarget.value))}
			>
				{#each speeds as option (option.value)}
					<option value={option.value}>{option.label}</option>
				{/each}
			</select>

			<div class="min-w-0 flex-1 px-2">
				<input
					type="range"
					min={bounds?.min ?? 0}
					max={bounds?.max ?? 1}
					step={15000}
					value={value}
					disabled={!bounds}
					oninput={(event) => onchange(Number(event.currentTarget.value))}
					aria-label="Historical time"
					class="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary disabled:cursor-not-allowed disabled:opacity-50"
				/>
			</div>

			<Button
				size="sm"
				variant={mode === 'live' ? 'default' : 'outline'}
				onclick={onlive}
				aria-label="Return to live vehicles"
			>
				<Radio class="size-3.5" /> Live
			</Button>
		</div>

		<div class="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
			<span class="font-medium text-foreground tabular-nums">{formatTime(value)}</span>
			{#if mode === 'history'}
				<Badge variant="outline">history</Badge>
			{/if}
			{#if loading}
				<span>Loading…</span>
			{/if}

			<div class="ml-auto flex flex-wrap items-center gap-2.5">
				<span class="flex items-center gap-1">
					<span class="size-2 rounded-full bg-[#0d9488]"></span> On time
				</span>
				<span class="flex items-center gap-1">
					<span class="size-2 rounded-full bg-[#eab308]"></span> 2–5 min
				</span>
				<span class="flex items-center gap-1">
					<span class="size-2 rounded-full bg-[#f97316]"></span> 5–10 min
				</span>
				<span class="flex items-center gap-1">
					<span class="size-2 rounded-full bg-[#dc2626]"></span> 10+ min
				</span>
				<span class="flex items-center gap-1">
					<span class="size-2 rounded-full bg-[#94a3b8]"></span> No data
				</span>
			</div>
		</div>
	</div>
</div>
