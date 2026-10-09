import type { Database } from "bun:sqlite";
import { getPart, type Part } from "#lib/server/db/catalog.ts";
import { getLocation } from "#lib/server/db/locations.ts";
import {
  getBalance,
  getMovementByOperationId,
  insertMovement,
  type Movement,
  type MovementType,
  type NewMovement,
} from "#lib/server/db/movements.ts";
import { assertUnit, formatQuantity, toBaseQuantity, type Unit } from "#lib/units.ts";
import {
  DuplicateOperationError,
  InsufficientStockError,
  InventoryError,
  NotFoundError,
} from "./errors";
import { requireBulkPart } from "./pieces";
import { noReservations, type ReservationAdjustment, type ReservationGuard } from "./reservations";

interface StockActionBase {
  /** Unique ID for this submission. A repeated ID is rejected without writing. */
  operationId: string;
  partId: number;
  /** YYYY-MM-DD */
  occurredOn: string;
}

interface AmountInput {
  /** Decimal amount in `unit`. It must convert to a whole number of the part's base unit. */
  amount: string;
  unit: Unit;
}

export interface OpeningStockInput extends StockActionBase, AmountInput {
  locationId: number;
  reason?: string | null;
}

export interface TransferInput extends StockActionBase, AmountInput {
  fromLocationId: number;
  toLocationId: number;
  reason?: string | null;
}

export interface RemovalInput extends StockActionBase, AmountInput {
  locationId: number;
  reason: string;
}

export interface StockCountInput extends StockActionBase {
  locationId: number;
  /** Counted amount in `unit`. */
  countedAmount: string;
  unit: Unit;
  reason: string;
}

export interface StockCountResult {
  /** Unit of the quantities below: the part's base unit. */
  baseUnit: string;
  previousQuantity: number;
  countedQuantity: number;
  /** The correction movement, or null when the count matched the recorded balance. */
  movement: Movement | null;
  /** Reservations at the location reduced to fit the counted stock. */
  releasedReservations: ReservationAdjustment[];
}

export interface StockServiceOptions {
  reservations?: ReservationGuard;
}

export type StockService = ReturnType<typeof createStockService>;

/**
 * Physical stock changes. Each change runs in one SQLite transaction, checks the resulting
 * balances, and appends movements. Existing movements are never changed.
 */
export function createStockService(db: Database, options: StockServiceOptions = {}) {
  const reservations = options.reservations ?? noReservations;

  function inTransaction<T>(fn: () => T): T {
    return db.transaction(fn).immediate();
  }

  function startOperation(input: StockActionBase): Part {
    if (getMovementByOperationId(db, input.operationId)) {
      throw new DuplicateOperationError(input.operationId);
    }
    const part = getPart(db, input.partId);
    if (!part) {
      throw new NotFoundError(`Part ${input.partId} does not exist`);
    }
    if (part.archivedAt) {
      throw new InventoryError(`${part.name} is archived. Restore it before changing its stock.`);
    }
    requireBulkPart(part);
    return part;
  }

  /** Ordinary stock changes apply to storage. Project holding stock changes only by BOM line. */
  function requireLocation(locationId: number) {
    const location = getLocation(db, locationId);
    if (!location) {
      throw new NotFoundError(`Location ${locationId} does not exist`);
    }
    if (location.kind === "project") {
      throw new InventoryError(
        `${location.name} holds picked stock. Use the project's use or return actions.`
      );
    }
    return location;
  }

  function positiveQuantity(part: Part, input: AmountInput): number {
    const quantity = toBaseQuantity(input.amount, input.unit, assertUnit(part.baseUnit));
    if (quantity <= 0) {
      throw new InventoryError("Quantity must be greater than zero");
    }
    return quantity;
  }

  /**
   * Check that `quantity` can leave `locationId`, including reservation rules. Returns the
   * reservations that the reservation guard reduced.
   */
  function checkOutgoing(
    part: Part,
    locationId: number,
    quantity: number,
    movementType: MovementType
  ): ReservationAdjustment[] {
    const location = requireLocation(locationId);
    const balanceBefore = getBalance(db, part.id, locationId);
    const balanceAfter = balanceBefore - quantity;
    if (balanceAfter < 0) {
      throw new InsufficientStockError(
        `${location.name} has ${formatQuantity(balanceBefore, part.baseUnit)} of ${part.name}; ` +
          `cannot remove ${formatQuantity(quantity, part.baseUnit)}`
      );
    }
    return (
      reservations.assertOutgoingAllowed(db, {
        partId: part.id,
        locationId,
        quantity,
        movementType,
        balanceBefore,
        balanceAfter,
      }) ?? []
    );
  }

  function record(
    input: StockActionBase,
    movement: Omit<NewMovement, "operationId" | "partId" | "occurredOn">
  ) {
    return insertMovement(db, {
      operationId: input.operationId,
      partId: input.partId,
      occurredOn: input.occurredOn,
      ...movement,
    });
  }

  function removeToOutside(input: RemovalInput, movementType: "loss" | "supplier_return") {
    return inTransaction(() => {
      const part = startOperation(input);
      const quantity = positiveQuantity(part, input);
      checkOutgoing(part, input.locationId, quantity, movementType);
      return record(input, {
        quantity,
        fromLocationId: input.locationId,
        toLocationId: null,
        movementType,
        reason: input.reason,
      });
    });
  }

  return {
    /** Add stock that comes from outside the inventory, such as existing stock when the app starts. */
    recordOpeningStock(input: OpeningStockInput): Movement {
      return inTransaction(() => {
        const part = startOperation(input);
        const quantity = positiveQuantity(part, input);
        requireLocation(input.locationId);
        return record(input, {
          quantity,
          fromLocationId: null,
          toLocationId: input.locationId,
          movementType: "opening",
          reason: input.reason ?? null,
        });
      });
    },

    /** Move stock between two locations. Total stock does not change. */
    transfer(input: TransferInput): Movement {
      return inTransaction(() => {
        const part = startOperation(input);
        if (input.fromLocationId === input.toLocationId) {
          throw new InventoryError("Choose two different locations");
        }
        const quantity = positiveQuantity(part, input);
        requireLocation(input.toLocationId);
        checkOutgoing(part, input.fromLocationId, quantity, "transfer");
        return record(input, {
          quantity,
          fromLocationId: input.fromLocationId,
          toLocationId: input.toLocationId,
          movementType: "transfer",
          reason: input.reason ?? null,
        });
      });
    },

    /** Remove lost, damaged, or discarded stock from inventory. */
    recordLoss(input: RemovalInput): Movement {
      return removeToOutside(input, "loss");
    },

    /** Remove stock that goes back to its supplier. */
    recordSupplierReturn(input: RemovalInput): Movement {
      return removeToOutside(input, "supplier_return");
    },

    /**
     * Record a physical count. When the count differs from the derived balance, append a
     * correction movement for the difference. Earlier movements stay unchanged.
     */
    recordStockCount(input: StockCountInput): StockCountResult {
      return inTransaction(() => {
        const part = startOperation(input);
        requireLocation(input.locationId);
        const countedQuantity = toBaseQuantity(
          input.countedAmount,
          input.unit,
          assertUnit(part.baseUnit)
        );
        const previousQuantity = getBalance(db, part.id, input.locationId);
        const difference = countedQuantity - previousQuantity;

        let movement: Movement | null = null;
        let releasedReservations: ReservationAdjustment[] = [];
        if (difference > 0) {
          movement = record(input, {
            quantity: difference,
            fromLocationId: null,
            toLocationId: input.locationId,
            movementType: "count_correction",
            reason: input.reason,
          });
        } else if (difference < 0) {
          releasedReservations = checkOutgoing(
            part,
            input.locationId,
            -difference,
            "count_correction"
          );
          movement = record(input, {
            quantity: -difference,
            fromLocationId: input.locationId,
            toLocationId: null,
            movementType: "count_correction",
            reason: input.reason,
          });
        }
        return {
          baseUnit: part.baseUnit,
          previousQuantity,
          countedQuantity,
          movement,
          releasedReservations,
        };
      });
    },
  };
}
