import type { Database } from "bun:sqlite";
import { categoryIdByPath } from "#lib/server/inventory/fixtures.ts";
import { partInput } from "#lib/server/inventory/test-helpers.ts";
import { createTestProjects } from "#lib/server/projects/test-helpers.ts";
import type { ExtractionResult, Extractor } from "./extractor";
import { createImportService } from "./imports";
import { MODEL_ID } from "./openai";

/** An extractor that returns a stored answer instead of calling the model. */
export function fixtureExtractor(output: unknown, overrides: Partial<ExtractionResult> = {}) {
  const calls: Parameters<Extractor>[0][] = [];
  const extractor: Extractor = async (request) => {
    calls.push(request);
    return {
      output,
      modelId: MODEL_ID,
      usage: { inputTokens: 1200, outputTokens: 800, totalTokens: 2000 },
      ...overrides,
    };
  };
  return Object.assign(extractor, { calls });
}

const COUNTED_TABLES = [
  "parts",
  "orders",
  "order_lines",
  "projects",
  "project_components",
  "bom_lines",
  "stock_movements",
  "receipts",
] as const;

/** Row counts of the inventory tables that imports may create records in. */
export function inventoryCounts(db: Database): Record<(typeof COUNTED_TABLES)[number], number> {
  return Object.fromEntries(
    COUNTED_TABLES.map((table) => [
      table,
      db.query<{ n: number }, []>(`SELECT count(*) AS n FROM ${table}`).get()!.n,
    ])
  ) as Record<(typeof COUNTED_TABLES)[number], number>;
}

/**
 * Import, project, and catalog services with a small catalog: a 4.7k and a 10k 0805 resistor
 * (the 10k one has a manufacturer part number) and an M3 × 8 pan head screw.
 */
export function createTestImports() {
  const context = createTestProjects();
  const { catalog } = context;
  const resistors = categoryIdByPath(catalog, "Electronics / Passives / Resistors");
  const screws = categoryIdByPath(catalog, "Hardware / Fasteners / Screws");
  const attrs = (values: Record<string, string>) =>
    Object.entries(values).map(([key, value]) => ({ key, label: key, value }));
  const parts = {
    resistor4k7: catalog.createPart(
      partInput({
        name: "4.7k resistor 0805",
        categoryId: resistors,
        attributes: attrs({ resistance: "4.7k", tolerance: "1%", package: "0805" }),
      })
    ),
    resistor10k: catalog.createPart(
      partInput({
        name: "10k resistor 0805",
        categoryId: resistors,
        partNumber: "RC0805FR-0710KL",
        attributes: attrs({ resistance: "10k", tolerance: "1%", package: "0805" }),
      })
    ),
    screw: catalog.createPart(
      partInput({
        name: "M3 × 8 pan head screw",
        categoryId: screws,
        attributes: attrs({ thread: "M3x8", head: "pan" }),
      })
    ),
  };
  return {
    ...context,
    imports: createImportService(context.db),
    parts,
    categories: { resistors, screws },
  };
}
