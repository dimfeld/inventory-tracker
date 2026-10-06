import { money, multiply, type Money } from "./money";
import { formatQuantity, UnitError } from "./units";

export const ORDER_STATUSES = ["draft", "placed", "shipped"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const DELIVERY_STATES = ["not_delivered", "awaiting_review", "reviewed"] as const;
export type DeliveryState = (typeof DELIVERY_STATES)[number];

/** Delivery state of one order line. */
export const DELIVERY_LABELS: Record<DeliveryState, string> = {
  not_delivered: "Not delivered",
  awaiting_review: "Delivered, awaiting review",
  reviewed: "Delivery reviewed",
};

export const ORDER_DELIVERY_STATUSES = [
  "not_delivered",
  "partly_delivered",
  "awaiting_review",
  "reviewed",
] as const;
export type OrderDeliveryStatus = (typeof ORDER_DELIVERY_STATUSES)[number];

export const ORDER_DELIVERY_LABELS: Record<OrderDeliveryStatus, string> = {
  not_delivered: "Not delivered",
  partly_delivered: "Partly delivered",
  awaiting_review: "Delivered, awaiting review",
  reviewed: "Delivery reviewed",
};

/** Delivery fields of an order line, for the order's delivery status. */
export interface LineDelivery {
  quantity: number;
  receivedQuantity: number;
  damagedQuantity: number;
  cancelledQuantity: number;
  deliveryState: DeliveryState;
}

/**
 * Delivery status of an order, derived from its lines. It is for display only. Lines whose
 * whole quantity is cancelled are ignored. A line that is not delivered but already had a
 * partial receipt counts as partly delivered. Any line awaiting review makes the order await
 * review.
 */
export function orderDeliveryStatus(lines: LineDelivery[]): OrderDeliveryStatus {
  const active = lines.filter((line) => line.cancelledQuantity < line.quantity);
  if (active.some((line) => line.deliveryState === "awaiting_review")) return "awaiting_review";
  if (active.length > 0 && active.every((line) => line.deliveryState === "reviewed")) {
    return "reviewed";
  }
  const delivered = active.some(
    (line) =>
      line.deliveryState !== "not_delivered" || line.receivedQuantity + line.damagedQuantity > 0
  );
  return delivered ? "partly_delivered" : "not_delivered";
}

/** Quantities of an order line, all in the part's base unit. */
export interface LineQuantities {
  quantity: number;
  receivedQuantity: number;
  damagedQuantity: number;
  cancelledQuantity: number;
}

/** Supply of a line that has not arrived or been cancelled, in the part's base unit. */
export function outstandingQuantity(line: LineQuantities): number {
  return Math.max(
    line.quantity - line.receivedQuantity - line.damagedQuantity - line.cancelledQuantity,
    0
  );
}

/**
 * Base quantity of a purchase: `purchaseQuantity` purchase units of `packQuantity` base units
 * each. Both must be positive integers; the pack size is never assumed.
 */
export function packConversion(purchaseQuantity: number, packQuantity: number): number {
  if (!Number.isInteger(purchaseQuantity) || purchaseQuantity <= 0) {
    throw new UnitError("Purchase quantity must be a positive whole number");
  }
  if (!Number.isInteger(packQuantity) || packQuantity <= 0) {
    throw new UnitError("Pack size must be a positive whole number of base units");
  }
  return purchaseQuantity * packQuantity;
}

/** Text such as "2 pack × 100 pcs = 200 pcs". */
export function describePackConversion(line: {
  purchaseQuantity: number;
  purchaseUnit: string;
  packQuantity: number;
  baseUnit: string;
}): string {
  const total = packConversion(line.purchaseQuantity, line.packQuantity);
  return (
    `${line.purchaseQuantity} ${line.purchaseUnit} × ${formatQuantity(line.packQuantity, line.baseUnit)}` +
    ` = ${formatQuantity(total, line.baseUnit)}`
  );
}

/**
 * Actual purchase cost of an order line: the price of one purchase unit × the ordered base
 * quantity that was not cancelled ÷ the pack size. Damaged stock was still paid for. The price
 * is the goods price only, so the cost excludes shipping and tax. Null when the line has no
 * price.
 */
export function orderLineCost(line: {
  unitPrice: string | null;
  currency: string | null;
  quantity: number;
  cancelledQuantity: number;
  packQuantity: number;
}): Money | null {
  if (line.unitPrice === null || line.currency === null) return null;
  return multiply(
    money(line.unitPrice, line.currency),
    line.quantity - line.cancelledQuantity,
    line.packQuantity
  );
}
