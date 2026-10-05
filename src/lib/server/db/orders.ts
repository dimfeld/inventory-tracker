import type { Database } from "bun:sqlite";
import type { DeliveryState, OrderStatus } from "#lib/orders.ts";

// Type aliases (not interfaces) so they can be passed as named SQL bindings.
export type OrderFields = {
  supplier: string;
  reference: string | null;
  expectedOn: string | null;
  trackingUrl: string | null;
  notes: string | null;
};

export type Order = OrderFields & {
  id: number;
  status: OrderStatus;
  placedOn: string | null;
  shippedOn: string | null;
  deliveryState: DeliveryState;
  deliveredOn: string | null;
  createdAt: string;
};

export interface OrderSummary extends Order {
  lineCount: number;
  /** Lines that still have outstanding supply. */
  openLineCount: number;
}

export type OrderLineFields = {
  partId: number;
  supplierSku: string | null;
  purchaseQuantity: number;
  purchaseUnit: string;
  /** Base units of the part in one purchase unit. */
  packQuantity: number;
  unitPrice: string | null;
  currency: string | null;
  notes: string | null;
};

/** An order line with its part. Quantities are in the part's `baseUnit`. */
export type OrderLine = OrderLineFields & {
  id: number;
  orderId: number;
  partName: string;
  baseUnit: string;
  partArchived: boolean;
  /** Ordered amount: purchaseQuantity × packQuantity. */
  quantity: number;
  receivedQuantity: number;
  damagedQuantity: number;
  cancelledQuantity: number;
  /** quantity - received - damaged - cancelled. */
  outstanding: number;
};

/** Outstanding supply of one line of a placed or shipped order, in the part's base unit. */
export interface IncomingLine {
  orderLineId: number;
  orderId: number;
  supplier: string;
  reference: string | null;
  status: Exclude<OrderStatus, "draft">;
  expectedOn: string | null;
  partId: number;
  partName: string;
  baseUnit: string;
  outstanding: number;
}

export interface Receipt {
  id: number;
  orderId: number;
  operationId: string;
  receivedOn: string;
  notes: string | null;
}

export interface ReceiptLine {
  id: number;
  receiptId: number;
  orderLineId: number;
  partName: string;
  baseUnit: string;
  acceptedQuantity: number;
  damagedQuantity: number;
  locationId: number | null;
  locationName: string | null;
  notes: string | null;
  movementId: number | null;
}

export type NewReceiptLine = {
  receiptId: number;
  orderLineId: number;
  acceptedQuantity: number;
  damagedQuantity: number;
  locationId: number | null;
  notes: string | null;
};

const ORDER_COLUMNS = `o.id, o.supplier, o.reference, o.status, o.placed_on AS placedOn,
  o.shipped_on AS shippedOn, o.expected_on AS expectedOn, o.delivery_state AS deliveryState,
  o.delivered_on AS deliveredOn, o.tracking_url AS trackingUrl, o.notes, o.created_at AS createdAt`;

const OUTSTANDING = `max(ol.quantity - ol.received_quantity - ol.damaged_quantity
  - ol.cancelled_quantity, 0)`;

const LINE_SELECT = `SELECT ol.id, ol.order_id AS orderId, ol.part_id AS partId,
    p.name AS partName, p.base_unit AS baseUnit, p.archived_at IS NOT NULL AS partArchived,
    ol.supplier_sku AS supplierSku, ol.purchase_quantity AS purchaseQuantity,
    ol.purchase_unit AS purchaseUnit, ol.pack_quantity AS packQuantity, ol.quantity,
    ol.received_quantity AS receivedQuantity, ol.damaged_quantity AS damagedQuantity,
    ol.cancelled_quantity AS cancelledQuantity, ${OUTSTANDING} AS outstanding,
    ol.unit_price AS unitPrice, ol.currency, ol.notes
  FROM order_lines ol
  JOIN parts p ON p.id = ol.part_id`;

type RawLine = Omit<OrderLine, "partArchived"> & { partArchived: number };

function toLine(row: RawLine): OrderLine {
  return { ...row, partArchived: row.partArchived === 1 };
}

export function insertOrder(db: Database, fields: OrderFields): number {
  return db
    .query<{ id: number }, OrderFields>(
      `INSERT INTO orders (supplier, reference, expected_on, tracking_url, notes)
       VALUES ($supplier, $reference, $expectedOn, $trackingUrl, $notes) RETURNING id`
    )
    .get(fields)!.id;
}

export function updateOrder(db: Database, id: number, fields: OrderFields): void {
  db.query<void, OrderFields & { id: number }>(
    `UPDATE orders SET supplier = $supplier, reference = $reference, expected_on = $expectedOn,
       tracking_url = $trackingUrl, notes = $notes,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = $id`
  ).run({ ...fields, id });
}

/** Set the purchase and delivery state columns that are given. */
export function updateOrderState(
  db: Database,
  id: number,
  state: Partial<Pick<Order, "status" | "placedOn" | "shippedOn" | "deliveryState" | "deliveredOn">>
): void {
  const columns = {
    status: "status",
    placedOn: "placed_on",
    shippedOn: "shipped_on",
    deliveryState: "delivery_state",
    deliveredOn: "delivered_on",
  } as const;
  const keys = (Object.keys(state) as (keyof typeof columns)[]).filter(
    (key) => state[key] !== undefined
  );
  const assignments = keys.map((key) => `${columns[key]} = ?`);
  db.run(
    `UPDATE orders SET ${assignments.join(", ")},
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ?`,
    [...keys.map((key) => state[key] ?? null), id]
  );
}

export function getOrder(db: Database, id: number): Order | null {
  return db.query<Order, [number]>(`SELECT ${ORDER_COLUMNS} FROM orders o WHERE o.id = ?`).get(id);
}

export function listOrders(db: Database): OrderSummary[] {
  return db
    .query<OrderSummary, []>(
      `SELECT ${ORDER_COLUMNS}, count(ol.id) AS lineCount,
         coalesce(sum(${OUTSTANDING} > 0), 0) AS openLineCount
       FROM orders o
       LEFT JOIN order_lines ol ON ol.order_id = o.id
       GROUP BY o.id
       ORDER BY coalesce(o.placed_on, o.created_at) DESC, o.id DESC`
    )
    .all();
}

/** Price and quantities of an order line, for its actual purchase cost. */
export interface LineCostFields {
  orderId: number;
  unitPrice: string | null;
  currency: string | null;
  quantity: number;
  cancelledQuantity: number;
  packQuantity: number;
}

/** Price and quantities of every order line. */
export function listLineCostFields(db: Database): LineCostFields[] {
  return db
    .query<LineCostFields, []>(
      `SELECT order_id AS orderId, unit_price AS unitPrice, currency, quantity,
         cancelled_quantity AS cancelledQuantity, pack_quantity AS packQuantity
       FROM order_lines ORDER BY id`
    )
    .all();
}

/** A priced line of a placed or shipped order. */
export interface PricedPurchase {
  orderLineId: number;
  orderId: number;
  supplier: string;
  reference: string | null;
  placedOn: string | null;
  partId: number;
  baseUnit: string;
  purchaseUnit: string;
  packQuantity: number;
  unitPrice: string;
  currency: string;
}

/**
 * The most recent priced line of a placed or shipped order for each of the given parts. Draft
 * orders are not purchases. Recency is placed date, then order ID, then line ID.
 */
export function listLatestPricedPurchases(db: Database, partIds: number[]): PricedPurchase[] {
  return db
    .query<PricedPurchase & { rank: number }, [string]>(
      `SELECT * FROM (
         SELECT ol.id AS orderLineId, o.id AS orderId, o.supplier, o.reference,
           o.placed_on AS placedOn, ol.part_id AS partId, p.base_unit AS baseUnit,
           ol.purchase_unit AS purchaseUnit, ol.pack_quantity AS packQuantity,
           ol.unit_price AS unitPrice, ol.currency,
           row_number() OVER (
             PARTITION BY ol.part_id ORDER BY o.placed_on DESC, o.id DESC, ol.id DESC
           ) AS rank
         FROM order_lines ol
         JOIN orders o ON o.id = ol.order_id
         JOIN parts p ON p.id = ol.part_id
         WHERE o.status IN ('placed', 'shipped') AND ol.unit_price IS NOT NULL
           AND ol.part_id IN (SELECT value FROM json_each(?))
       ) WHERE rank = 1`
    )
    .all(JSON.stringify(partIds))
    .map(({ rank: _rank, ...purchase }) => purchase);
}

/** Other orders from the same supplier with the same reference, ignoring case. */
export function listOrdersWithReference(
  db: Database,
  supplier: string,
  reference: string,
  excludeId: number | null
): Order[] {
  return db
    .query<Order, [string, string, number]>(
      `SELECT ${ORDER_COLUMNS} FROM orders o
       WHERE o.supplier = ? COLLATE NOCASE AND o.reference = ? COLLATE NOCASE AND o.id <> ?
       ORDER BY o.id`
    )
    .all(supplier, reference, excludeId ?? 0);
}

export function insertOrderLine(db: Database, orderId: number, fields: OrderLineFields): number {
  return db
    .query<{ id: number }, OrderLineFields & { orderId: number }>(
      `INSERT INTO order_lines (order_id, part_id, supplier_sku, purchase_quantity, purchase_unit,
         pack_quantity, unit_price, currency, notes)
       VALUES ($orderId, $partId, $supplierSku, $purchaseQuantity, $purchaseUnit, $packQuantity,
         $unitPrice, $currency, $notes)
       RETURNING id`
    )
    .get({ ...fields, orderId })!.id;
}

export function updateOrderLine(db: Database, id: number, fields: OrderLineFields): void {
  db.query<void, OrderLineFields & { id: number }>(
    `UPDATE order_lines SET part_id = $partId, supplier_sku = $supplierSku,
       purchase_quantity = $purchaseQuantity, purchase_unit = $purchaseUnit,
       pack_quantity = $packQuantity, unit_price = $unitPrice, currency = $currency,
       notes = $notes, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = $id`
  ).run({ ...fields, id });
}

export function deleteOrderLine(db: Database, id: number): void {
  db.run("DELETE FROM order_lines WHERE id = ?", [id]);
}

/** Add received, damaged, and cancelled amounts to a line's totals. */
export function addToLineTotals(
  db: Database,
  id: number,
  amounts: { received: number; damaged: number; cancelled: number }
): void {
  db.run(
    `UPDATE order_lines SET received_quantity = received_quantity + ?,
       damaged_quantity = damaged_quantity + ?, cancelled_quantity = cancelled_quantity + ?,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ?`,
    [amounts.received, amounts.damaged, amounts.cancelled, id]
  );
}

export function getOrderLine(db: Database, id: number): OrderLine | null {
  const row = db.query<RawLine, [number]>(`${LINE_SELECT} WHERE ol.id = ?`).get(id);
  return row && toLine(row);
}

export function listOrderLines(db: Database, orderId: number): OrderLine[] {
  return db
    .query<RawLine, [number]>(`${LINE_SELECT} WHERE ol.order_id = ? ORDER BY ol.id`)
    .all(orderId)
    .map(toLine);
}

export function countPartOrderLines(db: Database, partId: number): number {
  return db
    .query<{ count: number }, [number]>(
      "SELECT count(*) AS count FROM order_lines WHERE part_id = ?"
    )
    .get(partId)!.count;
}

/**
 * Lines of placed and shipped orders that still have outstanding supply. Draft orders are not
 * incoming. A line whose supply has all arrived or been cancelled is not listed, even while its
 * order stays open. `partIds` limits the result to those parts.
 */
export function listIncomingLines(db: Database, partIds?: number[]): IncomingLine[] {
  return db
    .query<IncomingLine, [string | null]>(
      `SELECT ol.id AS orderLineId, o.id AS orderId, o.supplier, o.reference, o.status,
         o.expected_on AS expectedOn, ol.part_id AS partId, p.name AS partName,
         p.base_unit AS baseUnit, ${OUTSTANDING} AS outstanding
       FROM order_lines ol
       JOIN orders o ON o.id = ol.order_id
       JOIN parts p ON p.id = ol.part_id
       WHERE o.status IN ('placed', 'shipped') AND ${OUTSTANDING} > 0
         AND (?1 IS NULL OR ol.part_id IN (SELECT value FROM json_each(?1)))
       ORDER BY p.name COLLATE NOCASE, o.expected_on IS NULL, o.expected_on, ol.id`
    )
    .all(partIds ? JSON.stringify(partIds) : null);
}

export function insertReceipt(
  db: Database,
  fields: { orderId: number; operationId: string; receivedOn: string; notes: string | null }
): number {
  return db
    .query<{ id: number }, [number, string, string, string | null]>(
      `INSERT INTO receipts (order_id, operation_id, received_on, notes) VALUES (?, ?, ?, ?)
       RETURNING id`
    )
    .get(fields.orderId, fields.operationId, fields.receivedOn, fields.notes)!.id;
}

export function insertReceiptLine(db: Database, line: NewReceiptLine): number {
  return db
    .query<{ id: number }, NewReceiptLine>(
      `INSERT INTO receipt_lines (receipt_id, order_line_id, accepted_quantity, damaged_quantity,
         location_id, notes)
       VALUES ($receiptId, $orderLineId, $acceptedQuantity, $damagedQuantity, $locationId, $notes)
       RETURNING id`
    )
    .get(line)!.id;
}

const RECEIPT_COLUMNS = `r.id, r.order_id AS orderId, r.operation_id AS operationId,
  r.received_on AS receivedOn, r.notes`;

export function getReceiptByOperationId(db: Database, operationId: string): Receipt | null {
  return db
    .query<Receipt, [string]>(`SELECT ${RECEIPT_COLUMNS} FROM receipts r WHERE r.operation_id = ?`)
    .get(operationId);
}

export function listOrderReceipts(db: Database, orderId: number): Receipt[] {
  return db
    .query<Receipt, [number]>(
      `SELECT ${RECEIPT_COLUMNS} FROM receipts r WHERE r.order_id = ?
       ORDER BY r.received_on DESC, r.id DESC`
    )
    .all(orderId);
}

export function listReceiptLines(db: Database, receiptIds: number[]): ReceiptLine[] {
  return db
    .query<ReceiptLine, [string]>(
      `SELECT rl.id, rl.receipt_id AS receiptId, rl.order_line_id AS orderLineId,
         p.name AS partName, p.base_unit AS baseUnit, rl.accepted_quantity AS acceptedQuantity,
         rl.damaged_quantity AS damagedQuantity, rl.location_id AS locationId,
         loc.name AS locationName, rl.notes, m.id AS movementId
       FROM receipt_lines rl
       JOIN order_lines ol ON ol.id = rl.order_line_id
       JOIN parts p ON p.id = ol.part_id
       LEFT JOIN locations loc ON loc.id = rl.location_id
       LEFT JOIN stock_movements m ON m.receipt_line_id = rl.id
       WHERE rl.receipt_id IN (SELECT value FROM json_each(?))
       ORDER BY rl.id`
    )
    .all(JSON.stringify(receiptIds));
}
