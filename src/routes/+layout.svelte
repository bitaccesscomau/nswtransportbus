<script lang="ts">
	import { onMount } from 'svelte';
	import '../app.css';
	import { BusFront } from '@lucide/svelte';
	import favicon from '#lib/assets/favicon.svg';
	import { loadSettings } from '#lib/settings.svelte.js';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	onMount(loadSettings);
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>NSW Bus Network</title>
	<meta
		name="description"
		content="Live map and analysis of the NSW bus network using Transport for NSW open data."
	/>
</svelte:head>

<div class="flex h-dvh flex-col overflow-hidden bg-background">
	<header class="flex h-13 shrink-0 items-center gap-3 border-b px-4">
		<a href="/" class="flex items-center gap-2 font-semibold tracking-tight">
			<span class="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground">
				<BusFront class="size-4" />
			</span>
			<span>NSW Bus Network</span>
		</a>

		<nav class="ml-3 flex items-center gap-1 text-sm" aria-label="Primary">
			<a
				href="/"
				class="rounded-md px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
			>
				Live map
			</a>
			<a
				href="/coverage"
				class="rounded-md px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
			>
				Coverage
			</a>
			<a
				href="/data"
				class="rounded-md px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
			>
				Data health
			</a>
			<a
				href="/settings"
				class="rounded-md px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
			>
				Settings
			</a>
		</nav>

		<p class="ml-auto hidden text-xs text-muted-foreground md:block">
			Contains data sourced from Transport for NSW under CC BY 4.0
		</p>
	</header>

	<main class="min-h-0 flex-1">
		{@render children()}
	</main>
</div>
