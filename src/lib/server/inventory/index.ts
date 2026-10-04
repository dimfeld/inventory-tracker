import { getDb } from "#lib/server/db/index.ts";
import { createCatalogService } from "./catalog";
import { createLocationService } from "./locations";
import { storageReservations } from "./reservations";
import { createStockService } from "./stock";

export { isUserError } from "./errors";

let services: ReturnType<typeof createServices> | undefined;

function createServices() {
  const db = getDb();
  return {
    catalog: createCatalogService(db),
    locations: createLocationService(db),
    stock: createStockService(db, { reservations: storageReservations }),
  };
}

/** Inventory services bound to the app database. */
export function inventory() {
  services ??= createServices();
  return services;
}
