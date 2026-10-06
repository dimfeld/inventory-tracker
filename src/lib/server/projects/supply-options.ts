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

export interface LineSupplyOptions {
  reserve: ReserveOption[];
  commit: CommitOption[];
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
      if (lineCoverage.uncovered > 0) {
        for (const part of allocations().getLineStock(projectId, lineId).parts) {
          if (!part.allowed || part.archived) continue;
          const need = wholeOf(lineCoverage.uncovered, lineCoverage, part.baseUnit);
          for (const stock of part.storage) {
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
      if (lineCoverage.neededNotOrdered > 0) {
        for (const option of commitments().listIncomingOptions(projectId, lineId)) {
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
      return [lineId, { reserve, commit }];
    })
  );
}
