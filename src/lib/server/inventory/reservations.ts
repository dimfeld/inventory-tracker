import type { Database } from "bun:sqlite";
import type { MovementType } from "#lib/server/db/movements.ts";

/** Stock about to leave a location. Quantities are in the part's base unit. */
export interface OutgoingStockChange {
  partId: number;
  locationId: number;
  quantity: number;
  movementType: MovementType;
  balanceBefore: number;
  balanceAfter: number;
}

/**
 * Boundary for reservation rules on physical stock changes.
 *
 * The stock service calls `assertOutgoingAllowed` inside its write transaction, after the
 * physical balance check and before it writes a movement that removes stock from a location.
 * An implementation throws an InventoryError to reject the change; the transaction then
 * rolls back with no partial writes. It may also adjust reservations through `db` as part of
 * the same transaction.
 */
export interface ReservationGuard {
  assertOutgoingAllowed(db: Database, change: OutgoingStockChange): void;
}

/** Guard for an inventory without project reservations. */
export const noReservations: ReservationGuard = {
  assertOutgoingAllowed() {},
};
