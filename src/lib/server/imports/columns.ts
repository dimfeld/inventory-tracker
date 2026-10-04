/**
 * Lines from CSV columns that the owner mapped, without a model. The result has the shape of
 * the model's output with every value marked as source-stated, so it goes through the same
 * normalization and review.
 */
import type { CsvRow } from "#lib/csv.ts";
import type { ColumnRole, CsvSettings, ImportKind } from "#lib/imports.ts";
import { InventoryError } from "#lib/server/inventory/errors.ts";
import type { MarkedValue, OrderOutput, ProjectOutput } from "./schema";
import { csvTable } from "./source";

const stated = (value: string | undefined): MarkedValue =>
  value ? { value, provenance: "source" } : null;

const WHOLE = /^\d+$/;

function wholeNumber(value: string | undefined) {
  return value && WHOLE.test(value)
    ? { value: Number(value), provenance: "source" as const }
    : null;
}

export function outputFromColumns(
  kind: ImportKind,
  rows: CsvRow[],
  settings: CsvSettings
): OrderOutput | ProjectOutput {
  if (!settings.roles.includes("description")) {
    throw new InventoryError("Choose at least one description column");
  }
  const { dataRows } = csvTable(rows, settings);
  const records = dataRows
    .map((row) => {
      const cells = (role: ColumnRole) =>
        settings.roles.flatMap((r, i) => (r === role && row.cells[i] ? [row.cells[i]] : []));
      const cell = (role: ColumnRole) => cells(role).join(" ") || undefined;
      return {
        cell,
        description: cells("description").join(" "),
        evidence: { row: row.row, excerpt: row.cells.join(", ") },
      };
    })
    .filter((record) => record.description !== "");

  const shared = (record: (typeof records)[number]) => ({
    description: record.description,
    category: null,
    manufacturer: stated(record.cell("manufacturer")),
    partNumber: stated(record.cell("part_number")),
    supplierSku: stated(record.cell("supplier_sku")),
    attributes: [],
    evidence: record.evidence,
    unresolved: [],
    notes: stated(record.cell("notes")),
  });

  const common = (role: ColumnRole) => {
    const values = [...new Set(records.map((record) => record.cell(role)).filter(Boolean))];
    return values.length === 1 ? stated(values[0]) : null;
  };

  if (kind === "order") {
    return {
      supplier: common("supplier"),
      reference: common("order_reference"),
      lines: records.map((record) => ({
        ...shared(record),
        purchaseQuantity: wholeNumber(record.cell("quantity")),
        purchaseUnit: stated(record.cell("purchase_unit")),
        packQuantity: wholeNumber(record.cell("pack_quantity")),
        baseUnit: stated(record.cell("unit")),
        unitPrice: stated(record.cell("unit_price")),
        currency: stated(record.cell("currency")),
      })),
    };
  }

  const groups: ProjectOutput["groups"] = [];
  for (const record of records) {
    const name = record.cell("group");
    if (name && !groups.some((g) => g.name === name)) {
      groups.push({ name, evidence: record.evidence });
    }
  }
  return {
    projectName: null,
    groups,
    lines: records.map((record) => ({
      ...shared(record),
      quantity: stated(record.cell("quantity")),
      // BOM quantities without a unit column are counts; the mark shows it was not stated.
      unit: settings.roles.includes("unit")
        ? stated(record.cell("unit"))
        : { value: "pcs", provenance: "inferred" as const },
      referenceDesignators: stated(record.cell("reference_designators")),
      group: stated(record.cell("group")),
    })),
  };
}
