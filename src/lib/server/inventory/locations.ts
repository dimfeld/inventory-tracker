import type { Database } from "bun:sqlite";
import { getLocationByName, insertLocation, listLocations } from "#lib/server/db/locations.ts";
import { InventoryError } from "./errors";

export type LocationService = ReturnType<typeof createLocationService>;

export function createLocationService(db: Database) {
  return {
    listLocations: () => listLocations(db),

    createLocation(fields: { name: string; notes: string | null }): number {
      return db.transaction(() => {
        if (getLocationByName(db, fields.name)) {
          throw new InventoryError(`Location "${fields.name}" already exists`);
        }
        return insertLocation(db, fields);
      })();
    },
  };
}
