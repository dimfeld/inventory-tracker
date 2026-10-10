import type { Database } from "bun:sqlite";
import { assignInSequence } from "#lib/commitments.ts";
import { listOrderLineCommitments, setCommitmentQuantity } from "#lib/server/db/commitments.ts";
import { getOrderLine } from "#lib/server/db/orders.ts";
import { cutsFit, fitsWithin } from "#lib/pieces.ts";
import {
  deletePieceCommitments,
  listOrderLinePieceCommitments,
  shiftPieceCommitments,
} from "#lib/server/db/piece-commitments.ts";
import { insertPieceReservation } from "#lib/server/db/piece-reservations.ts";
import { addReservation } from "#lib/server/db/reservations.ts";
import { formatQuantity } from "#lib/units.ts";
import { InventoryError } from "./errors";
import type { ReceiptHooks } from "./receipts";

/**
 * Reduce an order line's commitments, highest sequence first, until they fit within its
 * outstanding supply. Call this in the transaction that lowers the outstanding supply (damage,
 * cancellation, or a correction), so the affected requirements show the shortage as needed
 * but not ordered. Returns the number of commitments reduced.
 */
export function fitOrderLineCommitments(db: Database, orderLineId: number): number {
  const outstanding = getOrderLine(db, orderLineId)?.outstanding ?? 0;
  const commitments = listOrderLineCommitments(db, [orderLineId]);
  let excess = commitments.reduce((sum, c) => sum + c.quantity, 0) - outstanding;
  let reduced = 0;
  for (const commitment of commitments.reverse()) {
    if (excess <= 0) break;
    const release = Math.min(commitment.quantity, excess);
    setCommitmentQuantity(db, commitment.id, commitment.quantity - release);
    excess -= release;
    reduced += 1;
  }
  // Piece commitments on incoming stock pieces that are no longer outstanding.
  const lost = listOrderLinePieceCommitments(db, [orderLineId]).filter(
    (c) => c.stickIndex >= outstanding
  );
  deletePieceCommitments(
    db,
    lost.map((c) => c.id)
  );
  return reduced + lost.length;
}

/**
 * Turns incoming commitments into storage reservations when their stock arrives. Accepted
 * stock fills the order line's commitments in sequence order, or as the owner assigned it on
 * the receipt. Each assigned quantity leaves the commitment and becomes a reservation for the
 * same BOM line at the receiving location. Unassigned commitments stay on the outstanding
 * supply.
 *
 * New pieces of a part tracked as pieces take the piece commitments of the lowest incoming
 * sticks: the nth new piece gets the commitments of stick n, as piece reservations of the same
 * size. A commitment that does not fit its piece, because the piece arrived in another size,
 * is released. The other sticks move down by the number of new pieces.
 */
export const commitmentReceipts: ReceiptHooks = {
  onLineReceived(db, stock) {
    const commitments = listOrderLineCommitments(db, [stock.orderLineId]);
    const assignments = stock.assignments ?? assignInSequence(commitments, stock.quantity);

    let assigned = 0;
    for (const assignment of assignments) {
      if (assignment.quantity === 0) continue;
      const commitment = commitments.find((c) => c.id === assignment.commitmentId);
      if (!commitment) {
        throw new InventoryError(
          "A commitment in the receipt assignment no longer exists. Reload and review it again."
        );
      }
      if (!Number.isInteger(assignment.quantity) || assignment.quantity < 0) {
        throw new InventoryError(`Assign whole amounts of ${commitment.baseUnit}`);
      }
      if (assignment.quantity > commitment.quantity) {
        throw new InventoryError(
          `${commitment.projectName} · ${commitment.lineDescription} has ` +
            `${formatQuantity(commitment.quantity, commitment.baseUnit)} committed; cannot ` +
            `assign ${formatQuantity(assignment.quantity, commitment.baseUnit)}`
        );
      }
      assigned += assignment.quantity;
      commitment.quantity -= assignment.quantity;
      setCommitmentQuantity(db, commitment.id, commitment.quantity);
      addReservation(db, {
        bomLineId: commitment.bomLineId,
        partId: stock.partId,
        locationId: stock.locationId,
        quantity: assignment.quantity,
      });
    }
    if (assigned > stock.quantity) {
      throw new InventoryError(
        `Only ${formatQuantity(stock.quantity, commitments[0].baseUnit)} was accepted; ` +
          `cannot assign ${formatQuantity(assigned, commitments[0].baseUnit)} to projects`
      );
    }
  },

  onPiecesReceived(db, received) {
    const commitments = listOrderLinePieceCommitments(db, [received.orderLineId]);
    const arrived = commitments.filter((c) => c.stickIndex < received.pieces.length);
    received.pieces.forEach((piece, index) => {
      const lengths: number[] = [];
      for (const commitment of arrived.filter((c) => c.stickIndex === index)) {
        const fits =
          piece.widthMm === null
            ? commitment.widthMm === null &&
              cutsFit(piece, commitment.kerfMm, [...lengths, commitment.lengthMm])
            : commitment.widthMm !== null &&
              lengths.length === 0 &&
              fitsWithin(
                { lengthMm: commitment.lengthMm, widthMm: commitment.widthMm },
                { lengthMm: piece.lengthMm, widthMm: piece.widthMm }
              );
        if (!fits) continue;
        lengths.push(commitment.lengthMm);
        insertPieceReservation(db, {
          bomLineId: commitment.bomLineId,
          pieceId: piece.id,
          lengthMm: commitment.lengthMm,
          widthMm: commitment.widthMm,
        });
      }
    });
    deletePieceCommitments(
      db,
      arrived.map((c) => c.id)
    );
    shiftPieceCommitments(db, received.orderLineId, received.pieces.length);
  },
};
