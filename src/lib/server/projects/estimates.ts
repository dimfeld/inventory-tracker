import type { Database } from "bun:sqlite";
import { money, multiply, totalByCurrency, type Money, type MoneyTotals } from "#lib/money.ts";
import { listLatestPricedPurchases, type PricedPurchase } from "#lib/server/db/orders.ts";
import {
  getProject,
  listBomLines,
  listChoices,
  listComponents,
  type BomLine,
  type Project,
  type ProjectComponent,
} from "#lib/server/db/projects.ts";
import { isUnit, UNITS } from "#lib/units.ts";
import { resolvedPart } from "./shopping";

/** The purchase that a row's estimate is based on. */
export interface EstimateSource extends PricedPurchase {
  partName: string;
  /** Price of one base unit: the purchase unit price ÷ the pack size. */
  baseUnitPrice: Money;
}

export interface EstimateRow {
  line: BomLine;
  /** Estimated cost of the row's whole requirement, or null when it is unknown. */
  estimate: Money | null;
  source: EstimateSource | null;
  /** Why the estimate is unknown. */
  unknownReason: string | null;
}

export interface EstimateGroup {
  /** Null for the ungrouped rows. */
  component: ProjectComponent | null;
  rows: EstimateRow[];
  totals: MoneyTotals;
}

export interface ProjectEstimate {
  project: Project;
  groups: EstimateGroup[];
  /** Every row once, whatever its group. */
  totals: MoneyTotals;
}

/**
 * Base units in one `unit`, as an exact fraction, or null when the units do not convert.
 * A row in mm of a part stocked in m is 1/1000 m per mm.
 */
function unitFactor(unit: string, baseUnit: string): [number, number] | null {
  if (unit === baseUnit) return [1, 1];
  if (!isUnit(unit) || !isUnit(baseUnit)) return null;
  const from = UNITS[unit];
  const to = UNITS[baseUnit];
  return from.dimension === to.dimension ? [from.size, to.size] : null;
}

function unknown(line: BomLine, reason: string): EstimateRow {
  return { line, estimate: null, source: null, unknownReason: reason };
}

export type EstimateService = ReturnType<typeof createEstimateService>;

/**
 * Project cost estimates. Each row is priced from the most recent priced purchase of its
 * resolved part on a placed or shipped order: the exact part, or the only approved choice.
 * Prices are goods only, without shipping and tax, and are not an inventory valuation.
 * Estimates cover the row's whole requirement, not only what is left to buy. Different
 * currencies stay separate, and rows without an estimate are counted, never treated as zero.
 *
 * This only reads: it never changes stock, reservations, or commitments.
 */
export function createEstimateService(db: Database) {
  return {
    getProjectEstimate(projectId: number): ProjectEstimate | null {
      const project = getProject(db, projectId);
      if (!project) return null;
      const lines = listBomLines(db, projectId);
      const choices = Map.groupBy(
        listChoices(
          db,
          lines.map((line) => line.id)
        ),
        (choice) => choice.bomLineId
      );
      const parts = new Map(
        lines.map((line) => [line.id, resolvedPart(line, choices.get(line.id) ?? [])])
      );
      const partIds = [...new Set([...parts.values()].flatMap((part) => (part ? [part.id] : [])))];
      const purchases = new Map(
        listLatestPricedPurchases(db, partIds).map((purchase) => [purchase.partId, purchase])
      );

      const rows = lines.map((line): EstimateRow => {
        const part = parts.get(line.id);
        if (!part) return unknown(line, "No single chosen part");
        const purchase = purchases.get(part.id);
        if (!purchase) return unknown(line, "No priced purchase of the part");
        const factor = unitFactor(line.unit, purchase.baseUnit);
        if (!factor) return unknown(line, `Unit mismatch: ${line.unit} and ${purchase.baseUnit}`);
        const baseUnitPrice = multiply(
          money(purchase.unitPrice, purchase.currency),
          1,
          purchase.packQuantity
        );
        return {
          line,
          estimate: multiply(baseUnitPrice, line.quantity * factor[0], factor[1]),
          source: { ...purchase, partName: part.name, baseUnitPrice },
          unknownReason: null,
        };
      });

      const byComponent = Map.groupBy(rows, (row) => row.line.componentId);
      const groups = [...listComponents(db, projectId), null]
        .map((component) => {
          const groupRows = byComponent.get(component?.id ?? null) ?? [];
          return {
            component,
            rows: groupRows,
            totals: totalByCurrency(groupRows.map((row) => row.estimate)),
          };
        })
        .filter((group) => group.component !== null || group.rows.length > 0);

      return { project, groups, totals: totalByCurrency(rows.map((row) => row.estimate)) };
    },
  };
}
