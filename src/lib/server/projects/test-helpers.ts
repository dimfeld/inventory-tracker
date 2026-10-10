import type { Database } from "bun:sqlite";
import type { BomLineInput, ProjectInput } from "#lib/schemas/project.ts";
import { commitmentReceipts } from "#lib/server/inventory/commitments.ts";
import { createReceiptService } from "#lib/server/inventory/receipts.ts";
import { storageReservations } from "#lib/server/inventory/reservations.ts";
import { createTestInventory } from "#lib/server/inventory/test-helpers.ts";
import { bomAllocationGuard } from "./allocations";
import { createCommitmentService } from "./commitments";
import { createEstimateService } from "./estimates";
import { createPieceAllocationService } from "./piece-allocations";
import { createProjectService, type ProjectServiceOptions } from "./projects";
import { createShoppingService } from "./shopping";
import { createAllocationService } from "./stock-allocations";

export function createTestProjects(options: ProjectServiceOptions = {}) {
  const inventory = createTestInventory();
  return { ...inventory, projects: createProjectService(inventory.db, options) };
}

export function projectInput(overrides: Partial<ProjectInput> = {}): ProjectInput {
  return { name: "Desk lamp", status: "planned", notes: null, links: [], ...overrides };
}

export function lineInput(overrides: Partial<BomLineInput> = {}): BomLineInput {
  return {
    description: "M3 screw",
    amount: "4",
    unit: "pcs",
    componentId: null,
    referenceDesignators: null,
    notes: null,
    partId: null,
    categoryId: null,
    manufacturer: null,
    partNumber: null,
    constraints: [],
    cutLengthMm: null,
    cutWidthMm: null,
    ...overrides,
  };
}

export function equal(key: string, value: string) {
  return { key, comparison: "equal" as const, value, maxValue: null };
}

/** Project, stock, and order services with the app's reservation and allocation rules. */
export function createTestAllocations() {
  const inventory = createTestInventory(undefined, { reservations: storageReservations });
  return {
    ...inventory,
    receipts: createReceiptService(inventory.db, { hooks: commitmentReceipts }),
    projects: createProjectService(inventory.db, { allocations: bomAllocationGuard }),
    allocations: createAllocationService(inventory.db),
    pieceAllocations: createPieceAllocationService(inventory.db),
    commitments: createCommitmentService(inventory.db),
    shopping: createShoppingService(inventory.db),
    estimates: createEstimateService(inventory.db),
  };
}

/**
 * Stock movements, reservations, incoming commitments, and order line quantities, to show that
 * an operation leaves them unchanged.
 */
export function stockAndCommitments(db: Database) {
  return {
    movements: db.query("SELECT * FROM stock_movements ORDER BY id").all(),
    reservations: db.query("SELECT * FROM reservations ORDER BY id").all(),
    pieceReservations: db.query("SELECT * FROM piece_reservations ORDER BY id").all(),
    commitments: db.query("SELECT * FROM incoming_commitments ORDER BY id").all(),
    orderLines: db
      .query(
        `SELECT id, part_id, quantity, received_quantity, damaged_quantity, cancelled_quantity
         FROM order_lines ORDER BY id`
      )
      .all(),
  };
}
