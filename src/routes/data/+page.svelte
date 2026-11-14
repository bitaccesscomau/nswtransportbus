<script lang="ts">
	import { refreshAll } from '$app/navigation';
	import { Activity, Database, HardDrive, RefreshCw } from '@lucide/svelte';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Card, CardContent, CardHeader, CardTitle } from '#lib/components/ui/card/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import { formatBytes, formatNumber } from '#lib/format.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const pollStatus = (status: number | null) => {
		if (status === 200) return 'secondary';
		if (status === null) return 'outline';
		return 'destructive';
	};

	$effect(() => {
		const timer = setInterval(() => refreshAll(), 15_000);
		return () => clearInterval(timer);
	});
</script>

<svelte:head>
	<title>Data health · NSW Bus Network</title>
</svelte:head>

<div class="h-full overflow-y-auto">
	<div class="mx-auto max-w-6xl space-y-5 p-5">
		<div class="flex items-start justify-between gap-4">
			<div>
				<h1 class="text-xl font-semibold tracking-tight">Data health</h1>
				<p class="text-sm text-muted-foreground">
					Static feed versions, live collector polls, and storage footprint.
				</p>
			</div>
			<Button variant="outline" size="sm" onclick={() => refreshAll()}>
				<RefreshCw class="size-3.5" /> Refresh
			</Button>
		</div>

		{#if !data.ready || !data.health}
			<Card class="border-destructive/30">
				<CardHeader>
					<CardTitle class="text-sm">Database unavailable</CardTitle>
				</CardHeader>
				<CardContent class="text-sm text-muted-foreground">
					<p>Start the database and apply migrations:</p>
					<pre class="mt-2 rounded-md bg-muted p-2 font-mono text-xs">bun run db:up
bun run db:migrate</pre>
				</CardContent>
			</Card>
		{:else}
			<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
				{#each [
					{ label: 'Database', value: data.health.sizes.database, icon: Database },
					{ label: 'Positions', value: data.health.sizes.positions, icon: HardDrive },
					{ label: 'Observations', value: data.health.sizes.observations, icon: Activity },
					{ label: 'Delay history', value: data.health.sizes.delays, icon: Activity },
					{ label: 'Day partitions', value: formatNumber(data.health.sizes.partitions), icon: HardDrive }
				] as stat}
					<Card class="gap-1 py-3">
						<CardContent class="px-3">
							<p class="flex items-center gap-1.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
								<stat.icon class="size-3" /> {stat.label}
							</p>
							<p class="mt-1 text-lg font-semibold tabular-nums">{stat.value}</p>
						</CardContent>
					</Card>
				{/each}
			</div>

			<Card class="gap-2 py-3">
				<CardHeader class="px-4">
					<CardTitle class="text-sm">Static feed versions</CardTitle>
				</CardHeader>
				<CardContent class="px-0">
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head class="pl-4">ID</Table.Head>
								<Table.Head>Source</Table.Head>
								<Table.Head>Imported</Table.Head>
								<Table.Head>SHA-256</Table.Head>
								<Table.Head class="text-right">Archive</Table.Head>
								<Table.Head class="pr-4">State</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each data.health.feeds as feed (feed.id)}
								<Table.Row>
									<Table.Cell class="pl-4 font-mono text-xs">{feed.id}</Table.Cell>
									<Table.Cell class="max-w-[280px] truncate text-xs" title={feed.source}>
										{feed.source}
									</Table.Cell>
									<Table.Cell class="text-xs tabular-nums">{feed.fetchedAt}</Table.Cell>
									<Table.Cell class="font-mono text-[10px] text-muted-foreground">
										{feed.sha256.slice(0, 12)}
									</Table.Cell>
									<Table.Cell class="text-right text-xs tabular-nums">
										{formatBytes(feed.bytes)}
									</Table.Cell>
									<Table.Cell class="pr-4">
										{#if feed.isActive}
											<Badge variant="secondary">active</Badge>
										{:else}
											<Badge variant="outline">inactive</Badge>
										{/if}
									</Table.Cell>
								</Table.Row>
							{:else}
								<Table.Row>
									<Table.Cell colspan={6} class="text-sm text-muted-foreground">
										No feed imported yet. Run <code class="font-mono">bun run gtfs:import</code>.
									</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				</CardContent>
			</Card>

			<Card class="gap-2 py-3">
				<CardHeader class="px-4">
					<CardTitle class="text-sm">Recent collector polls</CardTitle>
				</CardHeader>
				<CardContent class="px-0">
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head class="pl-4">Feed</Table.Head>
								<Table.Head>Started</Table.Head>
								<Table.Head>Finished</Table.Head>
								<Table.Head class="text-right">Entities</Table.Head>
								<Table.Head class="text-right">Payload</Table.Head>
								<Table.Head class="pr-4">Status</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each data.health.polls as poll, index (index)}
								<Table.Row>
									<Table.Cell class="pl-4 font-mono text-xs">{poll.feed}</Table.Cell>
									<Table.Cell class="text-xs tabular-nums">{poll.startedAt}</Table.Cell>
									<Table.Cell class="text-xs tabular-nums">{poll.finishedAt ?? '—'}</Table.Cell>
									<Table.Cell class="text-right text-xs tabular-nums">
										{formatNumber(poll.entities)}
									</Table.Cell>
									<Table.Cell class="text-right text-xs tabular-nums">
										{formatBytes(poll.bytes)}
									</Table.Cell>
									<Table.Cell class="pr-4">
										<Badge variant={pollStatus(poll.httpStatus)}>
											{poll.httpStatus ?? 'pending'}
										</Badge>
										{#if poll.error}
											<p class="mt-1 max-w-[260px] truncate text-[10px] text-destructive" title={poll.error}>
												{poll.error}
											</p>
										{/if}
									</Table.Cell>
								</Table.Row>
							{:else}
								<Table.Row>
									<Table.Cell colspan={6} class="text-sm text-muted-foreground">
										No polls yet. Start <code class="font-mono">bun run collect</code>.
									</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				</CardContent>
			</Card>

			<p class="text-xs text-muted-foreground">
				Contains data sourced from Transport for NSW under CC BY 4.0. Postgres 18 + PostGIS 3.6.
			</p>
		{/if}
	</div>
</div>
