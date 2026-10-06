import { absoluteQuantity, type LineCoverage } from "./coverage";
import { allocations, commitments } from "./index";

/** Free storage stock of an approved part that a line can reserve with one click. */
export interface ReserveOption {
  partId: number;
  partName: string;
  baseUnit: string;
  locationId: number;
  locationName: string;
  /** Whole amount of `baseUnit`: the available stock, limited to the line's remaining need. */
  quantity: number;
}

/** Uncommitted order supply of an approved part that a line can commit with one click. */
export interface CommitOption {
  orderLineId: number;
  orderId: number;
  supplier: string;
  reference: string | null;
  expectedOn: string | null;
  partId: number;
  partName: string;
  baseUnit: string;
  /** Whole amount of `baseUnit`: the uncommitted supply, limited to what is not ordered yet. */
  quantity: number;
}

/**
 * The part of a line's `neededNotOrdered` quantity that free supply could cover, in the
 * coverage unit. Each quantity counts once: stock first, then orders, and the rest is
 * `notOrdered`. Free supply is not held for the line, so other lines may count it too.
 */
export interface UncommittedSupply {
  /** Storage stock of allowed parts that no line has reserved. */
  inStock: number;
  /** Outstanding order supply of allowed parts that no line has committed. */
  ordered: number;
  notOrdered: number;
}

export interface LineSupplyOptions {
  reserve: ReserveOption[];
  commit: CommitOption[];
  uncommitted: UncommittedSupply;
}

/** A quantity of `baseUnit` in the coverage unit. */
function inCoverageUnit(quantity: number, baseUnit: string, coverage: LineCoverage): number {
  return absoluteQuantity(quantity, baseUnit) / absoluteQuantity(1, coverage.unit);
}

/** A coverage quantity as a whole amount of `baseUnit`, rounded down so it never exceeds the need. */
function wholeOf(quantity: number, coverage: LineCoverage, baseUnit: string): number {
  return Math.floor(absoluteQuantity(quantity, coverage.unit) / absoluteQuantity(1, baseUnit));
}

/**
 * Stock and incoming supply that can cover each line's remaining need, by line ID. A line gets
 * reserve options only while stock does not cover it, and commit options only while some of it
 * is not ordered. Each option offers as much as the source has, up to that need.
 */
export function listSupplyOptions(
  projectId: number,
  coverage: Record<number, LineCoverage>
): Record<number, LineSupplyOptions> {
  return Object.fromEntries(
    Object.entries(coverage).map(([key, lineCoverage]) => {
      const lineId = Number(key);
      const reserve: ReserveOption[] = [];
      let freeStock = 0;
      if (lineCoverage.uncovered > 0) {
        for (const part of allocations().getLineStock(projectId, lineId).parts) {
          if (!part.allowed || part.archived) continue;
          const need = wholeOf(lineCoverage.uncovered, lineCoverage, part.baseUnit);
          for (const stock of part.storage) {
            freeStock += inCoverageUnit(Math.max(stock.available, 0), part.baseUnit, lineCoverage);
            const quantity = Math.min(stock.available, need);
            if (quantity <= 0) continue;
            reserve.push({
              partId: part.partId,
              partName: part.partName,
              baseUnit: part.baseUnit,
              locationId: stock.locationId,
              locationName: stock.locationName,
              quantity,
            });
          }
        }
      }

      const commit: CommitOption[] = [];
      let freeOrdered = 0;
      if (lineCoverage.neededNotOrdered > 0) {
        for (const option of commitments().listIncomingOptions(projectId, lineId)) {
          freeOrdered += inCoverageUnit(option.uncommitted, option.baseUnit, lineCoverage);
          const need = wholeOf(lineCoverage.neededNotOrdered, lineCoverage, option.baseUnit);
          const quantity = Math.min(option.uncommitted, need);
          if (quantity <= 0) continue;
          commit.push({
            orderLineId: option.orderLineId,
            orderId: option.orderId,
            supplier: option.supplier,
            reference: option.reference,
            expectedOn: option.expectedOn,
            partId: option.partId,
            partName: option.partName,
            baseUnit: option.baseUnit,
            quantity,
          });
        }
      }

      const inStock = Math.min(freeStock, lineCoverage.neededNotOrdered);
      const ordered = Math.min(freeOrdered, lineCoverage.neededNotOrdered - inStock);
      const notOrdered = lineCoverage.neededNotOrdered - inStock - ordered;
      return [lineId, { reserve, commit, uncommitted: { inStock, ordered, notOrdered } }];
    })
  );
}
