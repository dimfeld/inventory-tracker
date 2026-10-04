import { getDb } from "#lib/server/db/index.ts";
import { createCatalogService } from "./catalog";
import { createLocationService } from "./locations";
import { noReservations } from "./reservations";
import { createStockService } from "./stock";

export { isUserError } from "./errors";

let services: ReturnType<typeof createServices> | undefined;

function createServices() {
  const db = getDb();
  return {
    catalog: createCatalogService(db),
    locations: createLocationService(db),
    // The reservations plan replaces this guard with one that enforces storage reservations.
    stock: createStockService(db, { reservations: noReservations }),
  };
}

/** Inventory services bound to the app database. */
export function inventory() {
  services ??= createServices();
  return services;
}
