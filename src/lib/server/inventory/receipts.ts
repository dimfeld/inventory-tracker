import type { Database } from "bun:sqlite";
import type { CommitmentAssignment } from "#lib/commitments.ts";
import { getPart, getSupplierPartBySku, type Part } from "#lib/server/db/catalog.ts";
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
  recordReceiptDelivery,
  type Order,
  type OrderLine,
  type Receipt,
  type ReceiptLine,
} from "#lib/server/db/orders.ts";
import { formatQuantity } from "#lib/units.ts";
import { fitOrderLineCommitments } from "./commitments";
import { InventoryError, NotFoundError } from "./errors";
import {
  checkPieceSize,
  insertIncomingPieces,
  pieceDimensions,
  type PieceSizeInput,
} from "./pieces";

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
  /**
   * The owner's assignment of accepted stock to the line's incoming commitments. Null or absent
   * assigns it in commitment sequence order.
   */
  assignments?: CommitmentAssignment[] | null;
  /**
   * Size of every accepted piece of a part tracked as pieces. Absent uses the stock size of the
   * line's supplier SKU.
   */
  pieceSize?: { lengthMm: number; widthMm: number | null } | null;
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
  /** Receive only these order lines. Absent receives every outstanding line. */
  orderLineIds?: number[];
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
  /** The owner's assignment to incoming commitments, or null for sequence order. */
  assignments: CommitmentAssignment[] | null;
}

/**
 * Extension point for rules that run when received stock enters storage.
 *
 * The receipt service calls `onLineReceived` inside its write transaction for each receipt
 * line with accepted stock, after it records the stock movement and updates the order line's
 * totals. An implementation can write through `db` in the same transaction, for example to turn
 * incoming project commitments on the order line into storage reservations at the destination.
 * Throwing an InventoryError rejects the receipt and rolls back every write. After the hook,
 * the service reduces commitments that no longer fit the line's outstanding supply.
 */
export interface ReceiptHooks {
  onLineReceived(db: Database, stock: ReceivedStock): void;
}

/** Hooks for an inventory without incoming commitments. */
export const noReceiptHooks: ReceiptHooks = {
  onLineReceived() {},
};

/** An order line of a part tracked as pieces, as the receipt form needs it. */
export interface PieceReceiptLine {
  lengthLabel: string;
  /** Null for 1D pieces. */
  widthLabel: string | null;
  /** The supplier SKU's stock size, or null when the receipt must give the size. */
  stockSize: PieceSizeInput | null;
}

export interface ReceiptServiceOptions {
  hooks?: ReceiptHooks;
}

export type ReceiptService = ReturnType<typeof createReceiptService>;

/**
 * Order receipts. Each receipt runs in one SQLite transaction that writes the receipt, adds
 * accepted stock to storage, updates the order lines' outstanding supply and delivery state,
 * and reduces incoming commitments that damaged or cancelled supply no longer covers.
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

  /** The stock size of the order line's supplier SKU, or null when it has none. */
  function skuStockSize(order: Order, line: OrderLine): PieceSizeInput | null {
    if (!line.supplierSku) return null;
    const sku = getSupplierPartBySku(db, line.partId, order.supplier, line.supplierSku);
    if (sku?.stockLengthMm == null) return null;
    return { lengthMm: sku.stockLengthMm, widthMm: sku.stockWidthMm };
  }

  /**
   * The size of the pieces a receipt line makes: the input's size, or else the stock size of
   * the order line's supplier SKU.
   */
  function receivedPieceSize(
    order: Order,
    line: OrderLine,
    part: Part,
    input: ReceiptLineInput
  ): PieceSizeInput {
    const size = input.pieceSize ?? skuStockSize(order, line);
    if (!size) {
      throw new InventoryError(
        `${line.partName}: the supplier SKU has no stock size. Enter the size of the pieces.`
      );
    }
    try {
      checkPieceSize(pieceDimensions(db, part), size);
    } catch (error) {
      if (error instanceof InventoryError) {
        throw new InventoryError(`${line.partName}: ${error.message}`);
      }
      throw error;
    }
    return size;
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

      const order = requireReceivable(input.orderId);
      if (input.lines.length === 0) throw new InventoryError("Choose at least one line to receive");
      const orderLines = new Map(listOrderLines(db, input.orderId).map((l) => [l.id, l]));
      const seen = new Set<number>();
      // Size of the received pieces of each pieces line, by order line ID.
      const pieceSizes = new Map<number, PieceSizeInput>();
      for (const lineInput of input.lines) {
        const line = orderLines.get(lineInput.orderLineId);
        if (!line) {
          throw new NotFoundError(`Order line ${lineInput.orderLineId} is not on this order`);
        }
        if (seen.has(line.id)) throw new InventoryError(`${line.partName} is listed twice`);
        seen.add(line.id);
        checkLine(line, lineInput);
        const part = getPart(db, line.partId)!;
        if (part.trackingMode === "pieces" && lineInput.acceptedQuantity > 0) {
          pieceSizes.set(line.id, receivedPieceSize(order, line, part, lineInput));
        }
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
        // A receipt is the delivery and the review of what arrived, even when the line was
        // never marked delivered.
        recordReceiptDelivery(db, line.id, input.receivedOn);
        const pieceSize = pieceSizes.get(line.id);
        if (pieceSize) {
          // One new piece per accepted unit. Commitments to pieces parts cannot be made yet,
          // so the commitment hook does not run; fitting below releases any that remain.
          insertIncomingPieces(
            db,
            getPart(db, line.partId)!,
            Array.from({ length: lineInput.acceptedQuantity }, () => pieceSize),
            {
              operationId: `${input.operationId}:${line.id}`,
              toLocationId: lineInput.locationId,
              movementType: "receipt",
              occurredOn: input.receivedOn,
              reason: null,
              receiptLineId,
            }
          );
        } else if (lineInput.acceptedQuantity > 0) {
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
            assignments: lineInput.assignments ?? null,
          });
        }
        fitOrderLineCommitments(db, line.id);
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
     * Receipt details of the order's lines of parts tracked as pieces, by order line ID: the
     * dimension labels, and the SKU stock size that receipts use when no size is entered.
     */
    pieceLines(orderId: number): Record<number, PieceReceiptLine> {
      const order = getOrder(db, orderId);
      if (!order) return {};
      const result: Record<number, PieceReceiptLine> = {};
      for (const line of listOrderLines(db, orderId)) {
        const part = getPart(db, line.partId)!;
        if (part.trackingMode !== "pieces") continue;
        const { length, width } = pieceDimensions(db, part);
        result[line.id] = {
          lengthLabel: length.label,
          widthLabel: width?.label ?? null,
          stockSize: skuStockSize(order, line),
        };
      }
      return result;
    },

    /**
     * Record one receipt of some or all of an order's lines. A repeated operation ID returns
     * the receipt it created without writing again. Accepted and damaged amounts together
     * cannot exceed a line's outstanding supply.
     */
    receive,

    /**
     * Accept everything still outstanding on the order, or on the lines in `orderLineIds`, into
     * one storage location.
     */
    receiveAllOutstanding(input: ReceiveAllInput): ReceiptResult {
      return inTransaction(() => {
        const existing = existingResult(input.operationId);
        if (existing) return existing;
        requireReceivable(input.orderId);
        let lines = listOrderLines(db, input.orderId);
        if (input.orderLineIds) {
          const ids = new Set(input.orderLineIds);
          lines = lines.filter((line) => ids.has(line.id));
          if (lines.length !== ids.size) throw new NotFoundError("A line is not on this order");
          const settled = lines.find((line) => line.outstanding === 0);
          if (settled) throw new InventoryError(`${settled.partName} has nothing outstanding`);
        }
        lines = lines.filter((line) => line.outstanding > 0);
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
