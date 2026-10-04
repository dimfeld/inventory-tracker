import type { Database } from "bun:sqlite";
import { getLocation } from "#lib/server/db/locations.ts";
import { insertMovement } from "#lib/server/db/movements.ts";
import {
  addToLineTotals,
  getOrder,
  getReceiptByOperationId,
  insertReceipt,
  insertReceiptLine,
  listOrderLines,
  listReceiptLines,
  type Order,
  type OrderLine,
  type Receipt,
  type ReceiptLine,
} from "#lib/server/db/orders.ts";
import { formatQuantity } from "#lib/units.ts";
import { InventoryError, NotFoundError } from "./errors";

export interface ReceiptLineInput {
  orderLineId: number;
  /** Usable amount in the part's base unit. It goes into storage at `locationId`. */
  acceptedQuantity: number;
  /** Damaged or rejected amount in the part's base unit. It does not become stock. */
  damagedQuantity: number;
  /** Storage destination; required when `acceptedQuantity` is above zero. */
  locationId: number | null;
  notes: string | null;
  /** After this receipt, cancel whatever is still outstanding on the line. */
  cancelRemainder?: boolean;
}

export interface ReceiptInput {
  /** Unique ID for this submission. A repeated ID returns the existing receipt. */
  operationId: string;
  orderId: number;
  /** YYYY-MM-DD */
  receivedOn: string;
  notes: string | null;
  lines: ReceiptLineInput[];
}

export interface ReceiveAllInput {
  operationId: string;
  orderId: number;
  receivedOn: string;
  /** Storage destination of every outstanding line. */
  locationId: number;
  notes: string | null;
}

export interface ReceiptResult {
  receipt: Receipt;
  lines: ReceiptLine[];
  /** True when the operation ID was already recorded and nothing changed. */
  repeated: boolean;
}

/** Accepted stock that a receipt line added to storage. Quantities are in the base unit. */
export interface ReceivedStock {
  receiptLineId: number;
  orderLineId: number;
  partId: number;
  locationId: number;
  quantity: number;
  movementId: number;
}

/**
 * Extension point for rules that run when received stock enters storage.
 *
 * The receipt service calls `onLineReceived` inside its write transaction for each receipt
 * line with accepted stock, after it records the stock movement and updates the order line's
 * totals. An implementation can write through `db` in the same transaction, for example to turn
 * incoming project commitments on the order line into storage reservations at the destination.
 * Throwing an InventoryError rejects the receipt and rolls back every write.
 */
export interface ReceiptHooks {
  onLineReceived(db: Database, stock: ReceivedStock): void;
}

/** Hooks for an inventory without incoming commitments. */
export const noReceiptHooks: ReceiptHooks = {
  onLineReceived() {},
};

export interface ReceiptServiceOptions {
  hooks?: ReceiptHooks;
}

export type ReceiptService = ReturnType<typeof createReceiptService>;

/**
 * Order receipts. Each receipt runs in one SQLite transaction that writes the receipt, adds
 * accepted stock to storage, and updates the order lines' outstanding supply.
 */
export function createReceiptService(db: Database, options: ReceiptServiceOptions = {}) {
  const hooks = options.hooks ?? noReceiptHooks;

  function inTransaction<T>(fn: () => T): T {
    return db.transaction(fn).immediate();
  }

  function existingResult(operationId: string): ReceiptResult | null {
    const receipt = getReceiptByOperationId(db, operationId);
    if (!receipt) return null;
    return { receipt, lines: listReceiptLines(db, [receipt.id]), repeated: true };
  }

  function requireReceivable(orderId: number): Order {
    const order = getOrder(db, orderId);
    if (!order) throw new NotFoundError(`Order ${orderId} does not exist`);
    if (order.status === "draft") {
      throw new InventoryError("Place the order before you receive it");
    }
    return order;
  }

  function requireStorage(locationId: number | null) {
    const location = locationId === null ? null : getLocation(db, locationId);
    if (!location) throw new InventoryError("Choose a storage location for the accepted items");
    if (location.kind !== "storage") {
      throw new InventoryError(`${location.name} is not a storage location`);
    }
  }

  function checkLine(line: OrderLine, input: ReceiptLineInput) {
    const amounts = [input.acceptedQuantity, input.damagedQuantity];
    if (amounts.some((amount) => !Number.isInteger(amount) || amount < 0)) {
      throw new InventoryError(`${line.partName}: enter whole amounts of ${line.baseUnit}`);
    }
    const arriving = input.acceptedQuantity + input.damagedQuantity;
    if (arriving === 0) {
      throw new InventoryError(
        `${line.partName}: enter an accepted or damaged amount, or cancel the remainder instead`
      );
    }
    if (arriving > line.outstanding) {
      throw new InventoryError(
        `${line.partName}: ${formatQuantity(line.outstanding, line.baseUnit)} is outstanding; ` +
          `cannot receive ${formatQuantity(arriving, line.baseUnit)}. ` +
          "Correct the order line first if more arrived."
      );
    }
    if (input.acceptedQuantity > 0) {
      requireStorage(input.locationId);
      if (line.partArchived) {
        throw new InventoryError(`${line.partName} is archived. Restore it before receiving it.`);
      }
    }
  }

  function receive(input: ReceiptInput): ReceiptResult {
    return inTransaction(() => {
      const existing = existingResult(input.operationId);
      if (existing) return existing;

      requireReceivable(input.orderId);
      if (input.lines.length === 0) throw new InventoryError("Choose at least one line to receive");
      const orderLines = new Map(listOrderLines(db, input.orderId).map((l) => [l.id, l]));
      const seen = new Set<number>();
      for (const lineInput of input.lines) {
        const line = orderLines.get(lineInput.orderLineId);
        if (!line) {
          throw new NotFoundError(`Order line ${lineInput.orderLineId} is not on this order`);
        }
        if (seen.has(line.id)) throw new InventoryError(`${line.partName} is listed twice`);
        seen.add(line.id);
        checkLine(line, lineInput);
      }

      const receiptId = insertReceipt(db, {
        orderId: input.orderId,
        operationId: input.operationId,
        receivedOn: input.receivedOn,
        notes: input.notes,
      });
      for (const lineInput of input.lines) {
        const line = orderLines.get(lineInput.orderLineId)!;
        const receiptLineId = insertReceiptLine(db, {
          receiptId,
          orderLineId: line.id,
          acceptedQuantity: lineInput.acceptedQuantity,
          damagedQuantity: lineInput.damagedQuantity,
          locationId: lineInput.acceptedQuantity > 0 ? lineInput.locationId : null,
          notes: lineInput.notes,
        });
        const remainder = line.outstanding - lineInput.acceptedQuantity - lineInput.damagedQuantity;
        addToLineTotals(db, line.id, {
          received: lineInput.acceptedQuantity,
          damaged: lineInput.damagedQuantity,
          cancelled: lineInput.cancelRemainder ? remainder : 0,
        });
        if (lineInput.acceptedQuantity > 0) {
          const movement = insertMovement(db, {
            // Movement operation IDs are unique, so each line gets its own.
            operationId: `${input.operationId}:${line.id}`,
            partId: line.partId,
            quantity: lineInput.acceptedQuantity,
            fromLocationId: null,
            toLocationId: lineInput.locationId,
            movementType: "receipt",
            occurredOn: input.receivedOn,
            reason: null,
            receiptLineId,
          });
          hooks.onLineReceived(db, {
            receiptLineId,
            orderLineId: line.id,
            partId: line.partId,
            locationId: lineInput.locationId!,
            quantity: lineInput.acceptedQuantity,
            movementId: movement.id,
          });
        }
      }

      return {
        receipt: getReceiptByOperationId(db, input.operationId)!,
        lines: listReceiptLines(db, [receiptId]),
        repeated: false,
      };
    });
  }

  return {
    /**
     * Record one receipt of some or all of an order's lines. A repeated operation ID returns
     * the receipt it created without writing again. Accepted and damaged amounts together
     * cannot exceed a line's outstanding supply.
     */
    receive,

    /** Accept everything still outstanding on the order into one storage location. */
    receiveAllOutstanding(input: ReceiveAllInput): ReceiptResult {
      return inTransaction(() => {
        const existing = existingResult(input.operationId);
        if (existing) return existing;
        requireReceivable(input.orderId);
        const lines = listOrderLines(db, input.orderId).filter((line) => line.outstanding > 0);
        if (lines.length === 0) throw new InventoryError("Nothing is outstanding on this order");
        return receive({
          operationId: input.operationId,
          orderId: input.orderId,
          receivedOn: input.receivedOn,
          notes: input.notes,
          lines: lines.map((line) => ({
            orderLineId: line.id,
            acceptedQuantity: line.outstanding,
            damagedQuantity: 0,
            locationId: input.locationId,
            notes: null,
          })),
        });
      });
    },
  };
}
