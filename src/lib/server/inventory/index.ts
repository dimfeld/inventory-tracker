import { getDb } from "#lib/server/db/index.ts";
import { createCatalogService } from "./catalog";
import { commitmentReceipts } from "./commitments";
import { createLocationService } from "./locations";
import { createOrderService } from "./orders";
import { createReceiptService } from "./receipts";
import { storageReservations } from "./reservations";
import { createStockService } from "./stock";
import { createTaxonomyService } from "./taxonomy";

export { isUserError } from "./errors";

let services: ReturnType<typeof createServices> | undefined;

function createServices() {
  const db = getDb();
  return {
    catalog: createCatalogService(db),
    taxonomy: createTaxonomyService(db),
    locations: createLocationService(db),
    stock: createStockService(db, { reservations: storageReservations }),
    orders: createOrderService(db),
    receipts: createReceiptService(db, { hooks: commitmentReceipts }),
  };
}

/** Inventory services bound to the app database. */
export function inventory() {
  services ??= createServices();
  return services;
}
