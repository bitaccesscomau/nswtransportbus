# NSW Bus Network

Live map and data collection for the NSW bus network, built from Transport for NSW open data.

The static timetable and the live feeds are versioned in Postgres/PostGIS so the network can be analysed over time: stop redundancy, stop spacing and coverage, route supply, and reliability. Live data is the only irreversible input, so collection starts before the analysis UI is complete.

## Status

Phase 0 is complete:

- SvelteKit 3 + Svelte 5 + Tailwind 4 + shadcn-svelte app shell
- Postgres 18 + PostGIS 3.6 schema, managed by Drizzle ORM/drizzle-kit
- Versioned GTFS static import (agencies, routes, stops, trips, stop times, shapes, calendars)
- Live collector: vehicle positions every 15 s, trip updates every 60 s
- MapLibre map with route shapes, stop tiles, live vehicles over SSE, stop search and detail cards
- Historical playback: time slider, play/pause, 1×–1800× speed, ±1 minute steps, and a Live return
- Delay-coloured vehicles: teal on time, yellow 2–5 min late, orange 5–10 min, red 10+ min
- Purple route highlighting for the selected stop; click a route badge to isolate its shape, show direction triangles at both ends, and optionally show grey passed stops
- Stop busyness page: day-of-week × hour heatmap, route table, confidence and sample counts
- Toggleable busyness heatmap on the main map
- Settings for net change, modelled gross boardings, or a band-change index
- Filters for suburbs, routes, and routes active now or at a specific time
- Live Traffic NSW incidents/roadworks/floods/events, with nearby-disruption reasons in the bus and stop cards
- Optional bus-speed congestion proxy overlay (Live Traffic has no general flow feed)
- Data-health page with feed versions, collector polls, partitions and storage sizes

Next phases: the analysis views (redundancy, spacing/coverage, supply and reliability).

## Stack

| Layer | Choice |
| --- | --- |
| Runtime / package manager | Bun 1.4 |
| App | Svelte 5.57, SvelteKit 3.2, Vite 8, TypeScript 6 |
| UI | Tailwind CSS 4, shadcn-svelte 1.8 (bits-ui 2) |
| Map | MapLibre GL JS 6 + OpenFreeMap (no API key) |
| Data | Postgres 18, PostGIS 3.6, Drizzle ORM 0.45 |
| GTFS-R | protobufjs with the TfNSW extension proto |

## Quick start

```sh
bun install
cp .env.example .env
# Put your Transport for NSW Open Data Hub key in .env as TFNSW_API_KEY
bun run db:up
bun run db:migrate
bun run gtfs:import
bun run suburbs:import
bun run traffic:import
```

Then run the two long-lived processes in separate terminals:

```sh
bun run collect   # writes live observations
bun run dev       # http://localhost:5173
```

Open `/` for the map and `/data` for ingestion health.

### Production build

```sh
bun run build
bun run start     # or: PORT=3000 bun ./build/index.js
```

The app reads `DATABASE_URL` from the environment (or `.env` under Bun).

### Keep collection running

Collection must outlive the terminal; missed polls cannot be backfilled. Templates are in `deploy/`.

macOS (launchd):

```sh
cp deploy/com.nswbus.collector.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.nswbus.collector.plist
```

Linux (systemd):

```sh
sudo cp deploy/nswbus-collector.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now nswbus-collector
```

Edit the absolute project and Bun paths in the template first, and stop any manually started collector. On a laptop, sleep pauses collection; run it on an always-on machine for a clean multi-week window.

## What is collected

- **Static:** the complete bus GTFS bundle from
  `/v1/gtfs/schedule/buses` (nightly upstream). The bundle currently contains every
  contracted bus operator, so it is a superset of Greater Sydney; regional routes can be
  filtered later by contract.
- **Vehicle positions:** `/v1/gtfs/vehiclepos/buses`, every 15 s. One row per vehicle
  per poll in `vehicle_positions`, plus the latest state in `live_vehicles`.
- **Trip updates:** `/v1/gtfs/realtime/buses`, every 60 s. Only stop-time updates whose
  predicted arrival/departure is within −15/+5 minutes of now are persisted; each
  trip-stop is upserted so the row holds the closest report to the realised event.
- **Coverage:** every poll is written to `poll_runs`, successful or not. Gaps are visible
  rather than inferred.

At 15 s polling the collector makes about 6,000 requests/day, well inside the default
60,000/day, 5/s Bronze quota. Expect tens of GB of storage over 30 days at peak fleet size.

## Playback and delay colours

The timeline at the bottom of the map reads `vehicle_positions` and shows the last position
per vehicle within 120 seconds of the selected time. The slider spans all retained
partitions; playback speed is simulated seconds per real second (60× means one minute of
network time per second).

While playing, vehicle dots are interpolated between successive snapshots (a 350 ms eased
chase at roughly 30 fps), so they move continuously instead of jumping every poll.
Scrubbing or stepping snaps to the selected snapshot; returning to live cancels
interpolation. The path is a straight line between GPS points, not a road-snapped path.

Each vehicle is coloured by its latest observed delay:

| Band | Colour |
| --- | --- |
| On time or early (< 2 min late) | teal |
| 2–5 min late | yellow |
| 5–10 min late | orange |
| 10+ min late | red |
| No recent delay observation | grey |

Delay comes from `trip_delays`, an append-only row per trip per trip-update poll, using the
latest row at or before the position time within 15 minutes. This keeps rewinds accurate
instead of showing the latest delay for every past frame. It is the GTFS-R prediction at a
timing point, not a measured arrival; a vehicle without a recent prediction is grey rather
than guessed. `vehicle_delay(trip_id, service_date, at)` and an index on
`trip_delays (trip_id, service_date, observed_at desc)` keep the lookup cheap enough for
playback.

## Filters

The sidebar filters stops, routes, and live vehicles together:

- **Suburbs** — ABS Suburbs and Localities 2021 boundaries. Selecting a suburb limits
  stops to that suburb and routes to those serving it.
- **Route type** — bus, school bus, rail replacement, or ferry. Labels come from the
  extended GTFS/HVT route type codes.
- **Routes** — search by route number or name, multiple selections. Selecting up to 20
  routes also limits stops to the stops those routes serve.
- **Active routes only** — schedule-based: routes with a trip in progress at "now" or a
  chosen local time. Uses `service_dates` and the precomputed `trip_times`; the active
  window is ±5 minutes and covers trips crossing midnight.

Filters compose as suburb ∩ route type ∩ route ∩ active. The map fits the filtered extent, live
vehicles are filtered by route, and the card shows the filtered stop/route counts. The
active filter is schedule-based, not a live-vehicle observation.

`bun run suburbs:import` downloads the ABS SAL 2021 shapefile, imports NSW polygons into
PostGIS, and maps stops to suburbs. The GTFS importer refreshes the stop mapping after
each nightly feed.

## Traffic incidents and congestion

The collector polls the Live Traffic NSW Hazards API every five minutes for incidents,
roadworks, floods, major events, and fires:

```
/v1/live/hazards/incident/open
/v1/live/hazards/roadwork/open
/v1/live/hazards/flood/open
/v1/live/hazards/majorevent/open
/v1/live/hazards/fire/open
```

Current rows live in `traffic_incidents`; stale rows are removed after each successful
source poll. The map has an optional **Traffic incidents** overlay, coloured by source.
Clicking a live bus or a stop shows up to four nearby disruptions within 750 m, with the
category, name, and distance. This is a proximity hint, not a causal attribution.

Live Traffic does **not** publish a general traffic-flow/congestion feed. The optional
**Bus congestion** overlay is a proxy built from our own vehicle positions: a 0.005°
grid of average moving bus speed over the last ten minutes, with at least three samples
per cell. Green is fast, red is slow; it is explicitly labelled as a bus-speed proxy, not
general traffic. It refreshes every 30 seconds while enabled.

The optional **Traffic lights** overlay shows TfNSW/RMS-managed traffic-signal locations
(vehicle and pedestrian) as black dots with an amber ring. It comes from the TfNSW
**Traffic Lights Location** dataset (June 2026) and is a static asset snapshot, not a live
signal-state feed. Refresh it with `bun run traffic:import`.

## Route inspection

Clicking a route badge in the stop card highlights that exact shape and fits the map to it.
The **Passed stops (grey)** toggle in
Layers (enabled only when a route is selected, on by default) adds stops within 30 m of the
selected shape that are **not** served by trips using that shape. They are drawn as grey dots
matching the regular stop markers; click one to open its stop card. This is shape-specific: a stop served by another
direction or variant of the same route can still appear as passed.

Clicking a stop also lists its next 12 scheduled departures from the active timetable,
including route, headsign, time, and minutes away.

## Route pace

The **Map view** dropdown in Layers switches between **Default**, **Route pace**, and
**Slowdown hotspots**.

**Route pace** colours scheduled bus shapes by the distance-weighted average timetable
time per kilometre. The scale is calibrated from the active feed's 5th–95th percentile
(1.4–4.2 min/km; median 2.5), with green faster and red slower. It is a
scheduled-timetable view, not live congestion. The underlying `route_paces` materialized
view is refreshed by `bun run gtfs:import`.

## Bus lanes

The **Bus lanes** toggle overlays the TfNSW Bus Lanes dataset on the map. It covers the
Greater Sydney metro area, Newcastle and Wollongong, with road name, operating hours and
lane type in the click popup. Pink sections are bus lanes or 24-hour bus-only lanes
(BU/BO); amber sections are HOV lanes (HO) included for context. The snapshot is from the
TfNSW Bus Lanes release; refresh it with `bun run bus-lanes:import`.

## Speed zones and clearways

Two independent Layers settings add road controls:

- **Speed zones** colours TfNSW speed-limit lines by limit (40–110 km/h in the legend;
  exact limit and zone type in the popup).
- **Clearways** shows TfNSW clearway sections as dashed cyan lines, with street, clearway
  hours and bus/transit-lane details in the popup.

The speed-zone snapshot is the current TfNSW release; the clearways snapshot is from 2018
and TfNSW notes it may be incomplete. Refresh them with `bun run speed-zones:import` and
`bun run clearways:import`.

## Slowdown hotspots

**Slowdown hotspots** colours 200 m sections of bus shapes by the average moving speed
observed in the last 24 hours of sampled collected GPS. Sections need at least three samples;
the calibrated p10/p50/p90 speeds are 17.5/29.9/48.8 km/h, so the legend uses 18/30/49 km/h.
Red is slow and green fast. This is an observed route-section view: the line follows the
road used by the bus, and clicking a section shows its route, speed, and sample count.
`slow_segments` is refreshed every 15 minutes by the collector; run
`bun run slowdowns:derive` to refresh it manually.

## Suburb overlays

The Layers card includes independent **Suburb names** and **Suburb shading** toggles.
**Suburb shading** uses the ABS Suburbs and Localities 2021 boundaries, filling each
suburb with a deterministic colour from a 20-colour palette and a white boundary.
**Suburb names** toggles the basemap's native `label_other` place layer rather than
adding a duplicate suburb-label layer.

## Stop busyness

Busyness is derived from occupancy-band changes around each realised stop. For every
stop event in `trip_observations`, the derivation finds the vehicle's last occupancy
before arrival and first occupancy after departure (30 s dwell buffer, 5 min windows).
The change is a **net** load change: boardings minus alightings, in seat-equivalents.
The feed reports bands, not passenger counts.

| Band | Seat-equivalents |
| --- | --- |
| EMPTY | 0 |
| MANY_SEATS_AVAILABLE | 0.25 |
| FEW_SEATS_AVAILABLE | 0.75 |
| STANDING_ROOM_ONLY | 1.1 |
| CRUSHED_STANDING_ROOM_ONLY | 1.3 |
| FULL | 1.5 |

Three metrics are available in Settings:

- **Net change** — the measured occupancy change.
- **Modelled gross boardings** — adds an assumed alighting share (default 15%) of the
  before-stop load. A transparent model, not a measurement.
- **Band-change index** — the ordinal band change, with no capacity assumption.

The stop page shows a 7×24 day-of-week × hour grid and a per-route table. The map has a
toggleable busyness heatmap with day/hour selection; it shows the top 500 positive stops
and hides live vehicles while active. Low-sample cells are faded, and the sample count is
always visible.

Derived events live in `stop_boarding_events` (one row per realised stop). The collector
recomputes the last two hours every five minutes; use `bun run busyness:derive --days 2`
to backfill. TfNSW publishes stop-time predictions mainly at timing points, so ordinary
stops may have fewer events than the routes serving them suggest.

## Data model

Static tables are versioned by `feed_version_id`; `feed_versions.is_active` selects the
current timetable. Service dates are expanded into `service_dates` so queries can join a
trip to an operating day without re-expanding calendars.

Live tables:

- `vehicle_positions` — append-only, partitioned by UTC day.
- `live_vehicles` — latest known position per vehicle, used by the map and SSE.
- `trip_observations` — upserted realised/recent stop predictions, partitioned by service month.
- `trip_delays` — append-only trip-level delay per poll, partitioned by day; drives playback colours.
- `stop_boarding_events` — derived net load change per realised stop, by day-of-week/hour.
- `occupancy_bands` — occupancy band to seat-equivalent and ordinal mapping.
- `suburbs` / `stop_suburbs` — ABS SAL 2021 boundaries and stop-to-suburb mapping.
- `trip_times` — first departure and last arrival per trip, for active-route filters.
- `traffic_incidents` — current Live Traffic NSW hazards, with point geometry and raw properties.
- `poll_runs` — one row per collector request.

`drop_old_partitions(days)` removes expired position, observation and delay partitions; the
collector runs it every six hours and also prunes old poll rows. The default retention is
30 days (`RETENTION_DAYS`).

## Analysis roadmap

The data model is intentionally analysis-ready:

1. **Redundant stops.** Find pairs within 400 m, then classify: same route + same direction
   is consolidation material; opposite-direction pairs are legitimate; different routes are
   an interchange. Cluster with DBSCAN and rank by affected departures.
2. **Stop spacing and coverage.** Measure inter-stop spacing along each direction, overlay
   ABS SA1 population within a 400 m catchment, and compute drop-one marginal coverage and a
   greedy max-coverage selection.
3. **Supply and utilisation.** Supply is exact from GTFS (trips, vehicle-km, service hours,
   departures per stop). There is no public per-route or per-stop patronage, so utilisation
   must be a supply/reliability screen rather than measured boardings.
4. **Reliability.** On-time performance, excess wait and bunching from the collected
   trip observations.

## TfNSW data notes

- `Authorization: apikey <key>`; 60,000 requests/day and 5/s on the default plan.
- Bus GTFS uses 36-hour times for late-night services (`25:14:00`); they are stored as
  integer seconds.
- `service_id` is only unique within a feed; the importer namespaces calendars per agency.
- `trip_id`, `route_id` and `stop_id` are stable across nightly bundles.
- `stop_id` is the TSN. Opposite-direction stops are distinct TSNs at almost the same point.
- `start_date` in the realtime feed is the calendar date of operation; trips crossing
  midnight need care when joining to service dates.
- The bus consumer guide states bus service alerts are not provided; the app does not rely on them.

## Commands

| Command | Purpose |
| --- | --- |
| `bun run db:up` / `bun run db:down` | Start/stop the PostGIS container |
| `bun run db:migrate` | Apply Drizzle migrations |
| `bun run db:generate` | Generate a migration after schema edits |
| `bun run gtfs:import` | Download and import the static bus bundle |
| `bun run suburbs:import` | Download and import ABS suburb boundaries |
| `bun run traffic:import` | Download and import TfNSW traffic-light locations |
| `bun run bus-lanes:import` | Download and import TfNSW bus lanes |
| `bun run speed-zones:import` | Download and import TfNSW speed zones |
| `bun run clearways:import` | Download and import TfNSW clearways |
| `bun run collect` | Run the live collector and busyness derivation |
| `bun run busyness:derive` | Backfill stop busyness events (default 1 day) |
| `bun run slowdowns:derive` | Refresh observed road-section slowdowns |
| `bun run retention` | Manually drop expired partitions |
| `bun run dev` | SvelteKit dev server |
| `bun run build` / `bun run start` | Production build / Node server |
| `bun run check` | SvelteCheck + TypeScript |

## Attribution

Contains data sourced from Transport for NSW under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
Suburb boundaries: ABS Suburbs and Localities 2021, © Commonwealth of Australia (ABS),
CC BY 4.0. Traffic incidents: Live Traffic NSW / Transport for NSW, CC BY 4.0.
Traffic lights: Transport for NSW Open Data Hub, Traffic Lights Location, CC BY 4.0.
Bus lanes: Transport for NSW Open Data Hub, Bus Lanes, CC BY 4.0.
Speed zones: Transport for NSW Open Data Hub, Speed Zones, CC BY 4.0.
Clearways: Transport for NSW Open Data Hub, NSW Clearways, CC BY 4.0.
Basemap © OpenStreetMap contributors, rendered by OpenFreeMap. This is an
independent project and is not an official Transport for NSW publication.

Do not commit `.env`; it contains your API key.
