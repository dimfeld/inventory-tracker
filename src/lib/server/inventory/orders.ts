import type { Database } from "bun:sqlite";
import { getPart } from "#lib/server/db/catalog.ts";
import { searchParts } from "#lib/server/db/part-search.ts";
import {
  addToLineTotals,
  deleteOrderLine,
  getOrder,
  getOrderLine,
  insertOrder,
  insertOrderLine,
  listIncomingLines,
  listOrderLines,
  listOrderReceipts,
  listOrders,
  listOrdersWithReference,
  listReceiptLines,
  updateOrder,
  updateOrderLine,
  updateOrderState,
  type Order,
  type OrderLine,
} from "#lib/server/db/orders.ts";
import { packConversion } from "#lib/orders.ts";
import type { OrderInput, OrderLineInput } from "#lib/schemas/order.ts";
import { formatQuantity } from "#lib/units.ts";
import { InventoryError, NotFoundError } from "./errors";

/** Placed and shipped outstanding supply of one part, in its base unit. */
export interface IncomingSummary {
  partId: number;
  partName: string;
  baseUnit: string;
  placed: number;
  shipped: number;
}

export interface SaveOrderResult {
  id: number;
  /**
   * Other orders with the same supplier and reference. A repeated reference can be a
   * legitimate repeat purchase, so it is a warning and the save still happens.
   */
  sameReference: Order[];
}

export type OrderService = ReturnType<typeof createOrderService>;

/**
 * Purchase orders: manual entry, purchase and delivery state, line corrections, and outstanding
 * supply. Nothing here changes stock; only the receipt service adds stock.
 */
export function createOrderService(db: Database) {
  function inTransaction<T>(fn: () => T): T {
    return db.transaction(fn).immediate();
  }

  function requireOrder(id: number): Order {
    const order = getOrder(db, id);
    if (!order) throw new NotFoundError(`Order ${id} does not exist`);
    return order;
  }

  function requireLine(orderId: number, lineId: number): OrderLine {
    const line = getOrderLine(db, lineId);
    if (!line || line.orderId !== orderId) {
      throw new NotFoundError(`Order line ${lineId} does not exist in this order`);
    }
    return line;
  }

  function sameReference(order: OrderInput, id: number | null): Order[] {
    return order.reference ? listOrdersWithReference(db, order.supplier, order.reference, id) : [];
  }

  /** Check a line's part and quantities. Returns the ordered base quantity. */
  function checkLine(fields: OrderLineInput): number {
    const part = getPart(db, fields.partId);
    if (!part) throw new NotFoundError(`Part ${fields.partId} does not exist`);
    if (part.archivedAt) {
      throw new InventoryError(`${part.name} is archived. Restore it before ordering it.`);
    }
    if (fields.unitPrice !== null && !fields.currency) {
      throw new InventoryError("Enter the currency of the price");
    }
    return packConversion(fields.purchaseQuantity, fields.packQuantity);
  }

  return {
    listOrders: () => listOrders(db),

    /** Parts that can be added to an order: every part that is not archived. */
    partOptions: () =>
      searchParts(db, {
        text: null,
        categoryId: null,
        attributes: [],
        tags: [],
        includeArchived: false,
      }).map(({ id, name, baseUnit }) => ({ id, name, baseUnit })),

    getOrderDetails(id: number) {
      const order = getOrder(db, id);
      if (!order) return null;
      const receipts = listOrderReceipts(db, id);
      const receiptLines = Map.groupBy(
        listReceiptLines(
          db,
          receipts.map((r) => r.id)
        ),
        (line) => line.receiptId
      );
      return {
        order,
        lines: listOrderLines(db, id),
        receipts: receipts.map((receipt) => ({
          ...receipt,
          lines: receiptLines.get(receipt.id) ?? [],
        })),
        sameReference: sameReference(order, id),
      };
    },

    createOrder(input: OrderInput, lines: OrderLineInput[] = []): SaveOrderResult {
      return inTransaction(() => {
        const id = insertOrder(db, input);
        for (const line of lines) {
          checkLine(line);
          insertOrderLine(db, id, line);
        }
        return { id, sameReference: sameReference(input, id) };
      });
    },

    updateOrder(id: number, input: OrderInput): SaveOrderResult {
      return inTransaction(() => {
        requireOrder(id);
        updateOrder(db, id, input);
        return { id, sameReference: sameReference(input, id) };
      });
    },

    /** Draft to placed. From now on the order's outstanding lines are incoming supply. */
    markPlaced(id: number, placedOn: string): void {
      inTransaction(() => {
        const order = requireOrder(id);
        if (order.status !== "draft") throw new InventoryError("This order is already placed");
        if (listOrderLines(db, id).length === 0) {
          throw new InventoryError("Add at least one line before placing the order");
        }
        updateOrderState(db, id, { status: "placed", placedOn });
      });
    },

    markShipped(id: number, shippedOn: string): void {
      inTransaction(() => {
        const order = requireOrder(id);
        if (order.status !== "placed") {
          throw new InventoryError("Only a placed order can be marked shipped");
        }
        updateOrderState(db, id, { status: "shipped", shippedOn });
      });
    },

    /**
     * Record that a parcel arrived. Its lines wait for review; usable stock changes only when
     * a receipt is recorded.
     */
    markDelivered(id: number, deliveredOn: string): void {
      inTransaction(() => {
        if (requireOrder(id).status === "draft") {
          throw new InventoryError("Place the order before you mark it delivered");
        }
        updateOrderState(db, id, { deliveryState: "awaiting_review", deliveredOn });
      });
    },

    /** Record that the delivered parcel has been reviewed. */
    finishReview(id: number): void {
      inTransaction(() => {
        const order = requireOrder(id);
        if (order.deliveryState !== "awaiting_review") {
          throw new InventoryError("This order has no delivery awaiting review");
        }
        updateOrderState(db, id, { deliveryState: "reviewed" });
      });
    },

    addLine(orderId: number, input: OrderLineInput): number {
      return inTransaction(() => {
        requireOrder(orderId);
        checkLine(input);
        return insertOrderLine(db, orderId, input);
      });
    },

    /**
     * Correct a line. The ordered quantity cannot go below what already arrived or was
     * cancelled, and the part cannot change after any of it arrived.
     */
    updateLine(orderId: number, lineId: number, input: OrderLineInput): void {
      inTransaction(() => {
        const line = requireLine(orderId, lineId);
        const quantity = checkLine(input);
        const arrived = line.receivedQuantity + line.damagedQuantity;
        if (input.partId !== line.partId && arrived > 0) {
          throw new InventoryError("The part cannot change after some of the line has arrived");
        }
        const settled = arrived + line.cancelledQuantity;
        if (quantity < settled) {
          throw new InventoryError(
            `${formatQuantity(settled, line.baseUnit)} of this line already arrived or was ` +
              `cancelled; the corrected quantity cannot be less`
          );
        }
        updateOrderLine(db, lineId, input);
      });
    },

    /** Remove a line that nothing has arrived for. Otherwise cancel its remainder. */
    removeLine(orderId: number, lineId: number): void {
      inTransaction(() => {
        const line = requireLine(orderId, lineId);
        if (line.receivedQuantity + line.damagedQuantity > 0) {
          throw new InventoryError(
            "Part of this line has arrived, so it stays on the order. Cancel its remainder instead."
          );
        }
        deleteOrderLine(db, lineId);
      });
    },

    /** Cancel the outstanding supply of a line. Received and damaged amounts stay. */
    cancelRemainder(orderId: number, lineId: number): void {
      inTransaction(() => {
        const line = requireLine(orderId, lineId);
        if (line.outstanding === 0) {
          throw new InventoryError("This line has no outstanding quantity to cancel");
        }
        addToLineTotals(db, lineId, { received: 0, damaged: 0, cancelled: line.outstanding });
      });
    },

    /** Outstanding supply of placed and shipped orders, per line. */
    listIncomingLines: (partIds?: number[]) => listIncomingLines(db, partIds),

    /** Outstanding supply per part, with placed and shipped amounts kept apart. */
    incomingByPart(partIds?: number[]): IncomingSummary[] {
      const byPart = Map.groupBy(listIncomingLines(db, partIds), (line) => line.partId);
      return [...byPart.values()].map((lines) => ({
        partId: lines[0].partId,
        partName: lines[0].partName,
        baseUnit: lines[0].baseUnit,
        placed: lines
          .filter((l) => l.status === "placed")
          .reduce((sum, l) => sum + l.outstanding, 0),
        shipped: lines
          .filter((l) => l.status === "shipped")
          .reduce((sum, l) => sum + l.outstanding, 0),
      }));
    },
  };
}
