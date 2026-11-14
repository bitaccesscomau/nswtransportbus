import { customType } from 'drizzle-orm/pg-core';

/**
 * Drizzle's built-in geometry helper always emits `geometry(point)` and cannot
 * express SRIDs, geography, or linestrings. These opaque custom types let
 * drizzle-kit emit the correct PostGIS DDL; spatial values are read through
 * explicit SQL, never through the ORM's row mapper.
 */
export const pointGeometry = customType<{ data: string; driverData: string }>({
	dataType: () => 'geometry(Point, 4326)'
});

export const pointGeography = customType<{ data: string; driverData: string }>({
	dataType: () => 'geography'
});

export const lineGeometry = customType<{ data: string; driverData: string }>({
	dataType: () => 'geometry(LineString, 4326)'
});
