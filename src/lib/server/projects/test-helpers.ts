import type { BomLineInput, ProjectInput } from "#lib/schemas/project.ts";
import { createTestInventory } from "#lib/server/inventory/test-helpers.ts";
import { createProjectService, type ProjectServiceOptions } from "./projects";

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
