import type { BomLineInput, ProjectInput } from "#lib/schemas/project.ts";
import { commitmentReceipts } from "#lib/server/inventory/commitments.ts";
import { createReceiptService } from "#lib/server/inventory/receipts.ts";
import { storageReservations } from "#lib/server/inventory/reservations.ts";
import { createTestInventory } from "#lib/server/inventory/test-helpers.ts";
import { bomAllocationGuard } from "./allocations";
import { createCommitmentService } from "./commitments";
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
    commitments: createCommitmentService(inventory.db),
    shopping: createShoppingService(inventory.db),
  };
}
