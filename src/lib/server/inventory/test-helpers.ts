import type { Database } from "bun:sqlite";
import { openDatabase } from "#lib/server/db/connection.ts";
import type { PartInput } from "#lib/schemas/part.ts";
import { createCatalogService } from "./catalog";
import { createLocationService } from "./locations";
import { createStockService, type StockServiceOptions } from "./stock";

export function createTestInventory(
  db: Database = openDatabase(":memory:"),
  options: StockServiceOptions = {}
) {
  return {
    db,
    catalog: createCatalogService(db),
    locations: createLocationService(db),
    stock: createStockService(db, options),
  };
}

export function partInput(overrides: Partial<PartInput> = {}): PartInput {
  return {
    name: "M3 × 8 mm socket-head screw",
    categoryId: null,
    baseUnit: "pcs",
    manufacturer: null,
    partNumber: null,
    notes: null,
    attributes: [],
    aliases: [],
    supplierParts: [],
    ...overrides,
  };
}

let nextOperation = 0;
export function opId(): string {
  nextOperation += 1;
  return `test-op-${nextOperation}`;
}
