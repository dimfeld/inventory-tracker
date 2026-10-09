import type { Database } from "bun:sqlite";
import { openDatabase } from "#lib/server/db/connection.ts";
import type { PartInput } from "#lib/schemas/part.ts";
import { createCatalogService } from "./catalog";
import { createConversionService } from "./conversion";
import { createLocationService } from "./locations";
import { createOrderService } from "./orders";
import { createPieceService } from "./pieces";
import { createReceiptService } from "./receipts";
import { createStockService, type StockServiceOptions } from "./stock";
import { createTaxonomyService } from "./taxonomy";

export function createTestInventory(
  db: Database = openDatabase(":memory:"),
  options: StockServiceOptions = {}
) {
  return {
    db,
    catalog: createCatalogService(db),
    taxonomy: createTaxonomyService(db),
    locations: createLocationService(db),
    stock: createStockService(db, options),
    pieces: createPieceService(db),
    conversion: createConversionService(db),
    orders: createOrderService(db),
    receipts: createReceiptService(db),
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
    tags: [],
    supplierParts: [],
    ...overrides,
  };
}

let nextOperation = 0;
export function opId(): string {
  nextOperation += 1;
  return `test-op-${nextOperation}`;
}
