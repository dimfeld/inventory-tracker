import type { Database } from "bun:sqlite";
import { money, multiply, totalByCurrency, type Money, type MoneyTotals } from "#lib/money.ts";
import { getPart, type Part } from "#lib/server/db/catalog.ts";
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
import {
  cutWeights,
  planStockLengths,
  planStockSheets,
  type StockPlan,
} from "#lib/stock-packing.ts";
import { isUnit, UNITS } from "#lib/units.ts";
import { resolvedPart } from "./shopping";
import { listStockOptions, type StockSku } from "./stock-options";

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
  /**
   * For a cut-size row of a part tracked as pieces: the number of stock pieces that its cuts
   * come from. The row pays a share of each, so it can share them with other rows.
   */
  stockPieces: number | null;
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
  return { line, estimate: null, source: null, unknownReason: reason, stockPieces: null };
}

/** The estimate of cut-size rows of one pieces part, by line ID. */
type CutEstimates = Map<number, EstimateRow>;

/**
 * Estimates of the cut-size rows of one part tracked as pieces. All of the rows' cut pieces
 * are planned onto the part's priced stock sizes, as shopping plans them, so rows can share
 * stock pieces. Each stock piece's price is split between its cuts: a 1D cut pays in proportion
 * to its length plus the kerf, so the shares add up to the price of the piece, waste included,
 * and 2D cuts on one sheet pay equal shares.
 */
function estimateCutLines(db: Database, part: Part, lines: BomLine[]): CutEstimates {
  const result: CutEstimates = new Map();
  const options = listStockOptions(db, part.id).filter((option) => option.stock.price !== null);
  if (options.length === 0) {
    for (const line of lines) result.set(line.id, unknown(line, "No priced stock size"));
    return result;
  }

  const plans: StockPlan<StockSku, BomLine>[] = [
    planStockLengths(
      options,
      part.kerfMm,
      lines
        .filter((line) => line.cutWidthMm === null)
        .flatMap((line) =>
          Array.from({ length: line.quantity }, () => ({ key: line, lengthMm: line.cutLengthMm! }))
        )
    ),
    planStockSheets(
      options,
      lines
        .filter((line) => line.cutWidthMm !== null)
        .map((line) => ({
          key: line,
          lengthMm: line.cutLengthMm!,
          widthMm: line.cutWidthMm!,
          count: line.quantity,
          perSheet: line.cutsPerSheet ?? 1,
        }))
    ),
  ];

  const shares = new Map<number, Money[]>();
  const pieceCounts = new Map<number, number>();
  const sources = new Map<number, StockSku>();
  for (const plan of plans) {
    for (const piece of plan.pieces) {
      const weights = cutWeights(piece, part.kerfMm);
      const total = weights.reduce((sum, weight) => sum + weight, 0);
      const counted = new Set<number>();
      piece.cuts.forEach((cut, index) => {
        const line = cut.key;
        const list = shares.get(line.id) ?? [];
        list.push(multiply(piece.option.stock.price!, weights[index], total));
        shares.set(line.id, list);
        if (!sources.has(line.id)) sources.set(line.id, piece.option.stock);
        if (!counted.has(line.id)) {
          counted.add(line.id);
          pieceCounts.set(line.id, (pieceCounts.get(line.id) ?? 0) + 1);
        }
      });
    }
  }
  const unplaced = new Set(plans.flatMap((plan) => plan.unplaced.map((cut) => cut.key.id)));

  for (const line of lines) {
    if (unplaced.has(line.id)) {
      result.set(line.id, unknown(line, "The cut size does not fit any priced stock size"));
      continue;
    }
    const { totals } = totalByCurrency(shares.get(line.id) ?? []);
    if (totals.length !== 1) {
      result.set(line.id, unknown(line, "Stock sizes are priced in different currencies"));
      continue;
    }
    const sku = sources.get(line.id)!;
    result.set(line.id, {
      line,
      estimate: totals[0],
      source: { ...sku.purchase!, partName: part.name, baseUnitPrice: sku.price! },
      unknownReason: null,
      stockPieces: pieceCounts.get(line.id) ?? 0,
    });
  }
  return result;
}

export type EstimateService = ReturnType<typeof createEstimateService>;

/**
 * Project cost estimates. Each row is priced from the most recent priced purchase of its
 * resolved part on a placed or shipped order: the exact part, or the only approved choice.
 * A cut-size row of a part tracked as pieces is priced by its share of the stock pieces it
 * needs, from the latest prices of the part's supplier SKUs with a stock size.
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

      // Cut-size rows of parts tracked as pieces are priced by the stock pieces they need.
      const cutEstimates: CutEstimates = new Map();
      const cutLines = Map.groupBy(
        lines.filter((line) => line.cutLengthMm !== null && parts.get(line.id)),
        (line) => parts.get(line.id)!.id
      );
      for (const [partId, partLines] of cutLines) {
        const part = getPart(db, partId)!;
        if (part.trackingMode !== "pieces") continue;
        for (const [id, row] of estimateCutLines(db, part, partLines)) cutEstimates.set(id, row);
      }

      const rows = lines.map((line): EstimateRow => {
        const cutEstimate = cutEstimates.get(line.id);
        if (cutEstimate) return cutEstimate;
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
          stockPieces: null,
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
