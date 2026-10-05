import { money, multiply, type Money } from "./money";
import { formatQuantity, UnitError } from "./units";

export const ORDER_STATUSES = ["draft", "placed", "shipped"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const DELIVERY_STATES = ["not_delivered", "awaiting_review", "reviewed"] as const;
export type DeliveryState = (typeof DELIVERY_STATES)[number];

export const DELIVERY_LABELS: Record<DeliveryState, string> = {
  not_delivered: "Not delivered",
  awaiting_review: "Delivered, awaiting review",
  reviewed: "Delivery reviewed",
};

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
