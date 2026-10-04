import type { Database } from "bun:sqlite";
import type { MovementType } from "#lib/server/db/movements.ts";
import { listReservationsAt, setReservationQuantity } from "#lib/server/db/reservations.ts";
import { formatQuantity } from "#lib/units.ts";
import { InventoryError } from "./errors";

/** Stock about to leave a location. Quantities are in the part's base unit. */
export interface OutgoingStockChange {
  partId: number;
  locationId: number;
  quantity: number;
  movementType: MovementType;
  balanceBefore: number;
  balanceAfter: number;
}

/** A reservation reduced because a stock count found less stock than was reserved. */
export interface ReservationAdjustment {
  projectId: number;
  projectName: string;
  bomLineId: number;
  lineDescription: string;
  baseUnit: string;
  released: number;
  remaining: number;
}

/**
 * Boundary for reservation rules on physical stock changes.
 *
 * The stock service calls `assertOutgoingAllowed` inside its write transaction, after the
 * physical balance check and before it writes a movement that removes stock from a location.
 * An implementation throws an InventoryError to reject the change; the transaction then
 * rolls back with no partial writes. It may also adjust reservations through `db` as part of
 * the same transaction and return the adjustments.
 */
export interface ReservationGuard {
  assertOutgoingAllowed(db: Database, change: OutgoingStockChange): ReservationAdjustment[] | void;
}

/** Guard for an inventory without project reservations. */
export const noReservations: ReservationGuard = {
  assertOutgoingAllowed() {},
};

/**
 * Keeps storage reservations within physical stock. A stock count records what is really
 * there, so a count below the reserved total reduces the newest reservations at that location
 * to fit and reports them. Other removals (transfer, loss, supplier return) cannot take
 * reserved stock; they are rejected until the owner releases reservations.
 */
export const storageReservations: ReservationGuard = {
  assertOutgoingAllowed(db, change) {
    const reservations = listReservationsAt(db, change.partId, change.locationId);
    const reserved = reservations.reduce((sum, r) => sum + r.quantity, 0);
    if (change.balanceAfter >= reserved) return [];

    const unit = reservations[0].baseUnit;
    if (change.movementType !== "count_correction") {
      const holders = [...new Set(reservations.map((r) => r.projectName))].join(", ");
      throw new InventoryError(
        `${formatQuantity(reserved, unit)} here is reserved for ${holders}; only ` +
          `${formatQuantity(Math.max(change.balanceBefore - reserved, 0), unit)} can be removed. ` +
          "Release reservations first, or record a stock count if the stock is gone."
      );
    }

    let excess = reserved - change.balanceAfter;
    const adjustments: ReservationAdjustment[] = [];
    for (const reservation of reservations) {
      if (excess === 0) break;
      const released = Math.min(reservation.quantity, excess);
      const remaining = reservation.quantity - released;
      setReservationQuantity(db, reservation.id, remaining);
      excess -= released;
      adjustments.push({
        projectId: reservation.projectId,
        projectName: reservation.projectName,
        bomLineId: reservation.bomLineId,
        lineDescription: reservation.lineDescription,
        baseUnit: reservation.baseUnit,
        released,
        remaining,
      });
    }
    return adjustments;
  },
};
