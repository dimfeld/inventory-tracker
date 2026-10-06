import type { Database } from "bun:sqlite";
import { getPart } from "#lib/server/db/catalog.ts";
import {
  deleteOrderLineCommitments,
  listOrderLineCommitments,
} from "#lib/server/db/commitments.ts";
import { searchParts } from "#lib/server/db/part-search.ts";
import {
  addToLineTotals,
  deleteOrderLine,
  getOrder,
  getOrderLine,
  insertOrder,
  insertOrderLine,
  listIncomingLines,
  listLineCostFields,
  listLineDeliveryFields,
  listOrderLines,
  listOrderReceipts,
  listOrders,
  listOrdersWithReference,
  listReceiptLines,
  settleLineDelivery,
  updateLineDelivery,
  updateOrder,
  updateOrderLine,
  updateOrderState,
  type IncomingLine,
  type Order,
  type OrderLine,
} from "#lib/server/db/orders.ts";
import { parseCurrency, totalByCurrency } from "#lib/money.ts";
import { orderDeliveryStatus, orderLineCost, packConversion } from "#lib/orders.ts";
import type { OrderInput, OrderLineInput } from "#lib/schemas/order.ts";
import { formatQuantity } from "#lib/units.ts";
import { fitOrderLineCommitments } from "./commitments";
import { InventoryError, NotFoundError } from "./errors";

/**
 * Placed and shipped outstanding supply of one part, in its base unit, with the order lines that
 * hold it, earliest expected first.
 */
export interface IncomingSummary {
  partId: number;
  partName: string;
  baseUnit: string;
  placed: number;
  shipped: number;
  lines: IncomingLine[];
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
 * Purchase orders: manual entry, purchase state, line delivery state, line corrections, and
 * outstanding supply. Nothing here changes stock; only the receipt service adds stock. Line prices and
 * actual purchase costs never change stock, reservations, or commitments. Corrections and
 * cancellations that lower a line's outstanding supply reduce its incoming project
 * commitments in the same transaction and return how many were reduced.
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

  /** The given lines of a placed or shipped order, each once. */
  function requireDeliveryLines(orderId: number, lineIds: number[]): OrderLine[] {
    if (requireOrder(orderId).status === "draft") {
      throw new InventoryError("Place the order before you mark lines delivered");
    }
    if (lineIds.length === 0) throw new InventoryError("Choose at least one line");
    return [...new Set(lineIds)].map((lineId) => requireLine(orderId, lineId));
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
    if (fields.unitPrice !== null && parseCurrency(fields.currency) !== fields.currency) {
      throw new InventoryError("Enter the currency of the price as a three-letter code");
    }
    return packConversion(fields.purchaseQuantity, fields.packQuantity);
  }

  return {
    /** Orders with their actual purchase cost totals per currency. */
    listOrders() {
      const costs = Map.groupBy(listLineCostFields(db), (line) => line.orderId);
      const deliveries = Map.groupBy(listLineDeliveryFields(db), (line) => line.orderId);
      return listOrders(db).map((order) => ({
        ...order,
        costs: totalByCurrency((costs.get(order.id) ?? []).map(orderLineCost)),
        delivery: orderDeliveryStatus(deliveries.get(order.id) ?? []),
      }));
    },

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
      const lines = listOrderLines(db, id).map((line) => ({ ...line, cost: orderLineCost(line) }));
      return {
        order,
        lines,
        delivery: orderDeliveryStatus(lines),
        costs: totalByCurrency(lines.map((line) => line.cost)),
        commitments: listOrderLineCommitments(
          db,
          lines.map((line) => line.id)
        ),
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
     * Record that a parcel with the given lines arrived on `deliveredOn`. The lines wait for
     * review; usable stock changes only when a receipt is recorded. A line that is already
     * awaiting review gets the new date. Returns the number of lines marked.
     */
    markLinesDelivered(orderId: number, lineIds: number[], deliveredOn: string): number {
      return inTransaction(() => {
        const lines = requireDeliveryLines(orderId, lineIds);
        const settled = lines.find((line) => line.outstanding === 0);
        if (settled) {
          throw new InventoryError(`${settled.partName} has no outstanding quantity to deliver`);
        }
        updateLineDelivery(
          db,
          lines.map((line) => line.id),
          "awaiting_review",
          deliveredOn
        );
        return lines.length;
      });
    },

    /**
     * Mark every line that is not delivered and has outstanding quantity delivered on
     * `deliveredOn`. Returns the number of lines marked.
     */
    markOutstandingDelivered(orderId: number, deliveredOn: string): number {
      return inTransaction(() => {
        const lineIds = listOrderLines(db, orderId)
          .filter((line) => line.outstanding > 0 && line.deliveryState === "not_delivered")
          .map((line) => line.id);
        if (lineIds.length === 0) {
          requireOrder(orderId);
          throw new InventoryError("No outstanding line is waiting for delivery");
        }
        requireDeliveryLines(orderId, lineIds);
        updateLineDelivery(db, lineIds, "awaiting_review", deliveredOn);
        return lineIds.length;
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
     * cancelled, and the part cannot change after any of it arrived. A part change releases
     * the line's commitments, which were for the old part.
     */
    updateLine(orderId: number, lineId: number, input: OrderLineInput): number {
      return inTransaction(() => {
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
        settleLineDelivery(db, lineId);
        return input.partId === line.partId
          ? fitOrderLineCommitments(db, lineId)
          : deleteOrderLineCommitments(db, lineId);
      });
    },

    /** Remove a line that nothing has arrived for. Otherwise cancel its remainder. */
    removeLine(orderId: number, lineId: number): number {
      return inTransaction(() => {
        const line = requireLine(orderId, lineId);
        if (line.receivedQuantity + line.damagedQuantity > 0) {
          throw new InventoryError(
            "Part of this line has arrived, so it stays on the order. Cancel its remainder instead."
          );
        }
        const released = deleteOrderLineCommitments(db, lineId);
        deleteOrderLine(db, lineId);
        return released;
      });
    },

    /** Cancel the outstanding supply of a line. Received and damaged amounts stay. */
    cancelRemainder(orderId: number, lineId: number): number {
      return inTransaction(() => {
        const line = requireLine(orderId, lineId);
        if (line.outstanding === 0) {
          throw new InventoryError("This line has no outstanding quantity to cancel");
        }
        addToLineTotals(db, lineId, { received: 0, damaged: 0, cancelled: line.outstanding });
        settleLineDelivery(db, lineId);
        return fitOrderLineCommitments(db, lineId);
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
        lines,
      }));
    },
  };
}
