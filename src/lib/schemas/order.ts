import type { CommitmentAssignment } from "#lib/commitments.ts";
import { parseCurrency } from "#lib/money.ts";
import { parseLengthMm } from "#lib/pieces.ts";
import { allText, optionalText, parseId, text, type FieldErrors, type ParseResult } from "./result";
import { today } from "./stock";

export interface OrderInput {
  supplier: string;
  /** The supplier's order number. */
  reference: string | null;
  /** YYYY-MM-DD */
  expectedOn: string | null;
  trackingUrl: string | null;
  notes: string | null;
}

export interface OrderLineInput {
  partId: number;
  supplierSku: string | null;
  /** Whole number of purchase units, such as 2 (packs). */
  purchaseQuantity: number;
  purchaseUnit: string;
  /** Base units of the part in one purchase unit. */
  packQuantity: number;
  /** Price of one purchase unit as an exact decimal string. Excludes shipping and tax. */
  unitPrice: string | null;
  currency: string | null;
  notes: string | null;
}

export interface ReceiptLineFormInput {
  operationId: string;
  receivedOn: string;
  orderLineId: number;
  acceptedQuantity: number;
  damagedQuantity: number;
  locationId: number | null;
  notes: string | null;
  cancelRemainder: boolean;
  /** The owner's assignment to incoming commitments, or null for sequence order. */
  assignments: CommitmentAssignment[] | null;
  /** Size of the received pieces of a part tracked as pieces, or null for the SKU's size. */
  pieceSize: { lengthMm: number; widthMm: number | null } | null;
}

export interface ReceiveAllFormInput {
  operationId: string;
  receivedOn: string;
  locationId: number;
  notes: string | null;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const WHOLE = /^\d+$/;
const PRICE = /^\d+(\.\d+)?$/;

function result<T>(errors: FieldErrors, data: () => T): ParseResult<T> {
  return Object.keys(errors).length > 0
    ? { success: false, errors }
    : { success: true, data: data() };
}

function optionalDate(form: FormData, name: string, errors: FieldErrors): string | null {
  const value = optionalText(form, name);
  if (value !== null && !DATE.test(value)) errors[name] = "Enter a date as YYYY-MM-DD";
  return value;
}

/** A date field that defaults to today. */
export function parseDate(form: FormData, name: string): ParseResult<string> {
  const value = text(form, name) || today();
  return DATE.test(value)
    ? { success: true, data: value }
    : { success: false, errors: { [name]: "Enter a date as YYYY-MM-DD" } };
}

function wholeNumber(form: FormData, name: string, errors: FieldErrors, label: string): number {
  const value = text(form, name) || "0";
  if (!WHOLE.test(value)) errors[name] = `${label} must be a whole number`;
  return Number(value);
}

function operation(form: FormData, errors: FieldErrors) {
  const operationId = text(form, "operation_id");
  if (!operationId) errors.operation_id = "Missing operation ID; reload the page";
  const receivedOn = text(form, "received_on") || today();
  if (!DATE.test(receivedOn)) errors.received_on = "Enter a date as YYYY-MM-DD";
  return { operationId, receivedOn };
}

export function parseOrderForm(form: FormData): ParseResult<OrderInput> {
  const errors: FieldErrors = {};
  const supplier = text(form, "supplier");
  if (!supplier) errors.supplier = "Supplier is required";
  const expectedOn = optionalDate(form, "expected_on", errors);
  return result(errors, () => ({
    supplier,
    reference: optionalText(form, "reference"),
    expectedOn,
    trackingUrl: optionalText(form, "tracking_url"),
    notes: optionalText(form, "notes"),
  }));
}

/** The pack size is required: it is never assumed from the purchase unit. */
export function parseOrderLineForm(form: FormData): ParseResult<OrderLineInput> {
  const errors: FieldErrors = {};
  const partId = parseId(text(form, "part_id"));
  if (partId === null || Number.isNaN(partId)) errors.part_id = "Choose a part";

  const purchaseQuantity = text(form, "purchase_quantity");
  if (!WHOLE.test(purchaseQuantity) || Number(purchaseQuantity) === 0) {
    errors.purchase_quantity = "Enter how many purchase units were ordered";
  }
  const purchaseUnit = text(form, "purchase_unit");
  if (!purchaseUnit) errors.purchase_unit = "Enter the purchase unit, such as pack or each";
  const packQuantity = text(form, "pack_quantity");
  if (!WHOLE.test(packQuantity) || Number(packQuantity) === 0) {
    errors.pack_quantity = "Enter how many base units one purchase unit holds";
  }

  const unitPrice = optionalText(form, "unit_price");
  if (unitPrice !== null && !PRICE.test(unitPrice)) errors.unit_price = "Enter a price";
  const currencyText = optionalText(form, "currency");
  const currency = parseCurrency(currencyText);
  if (unitPrice !== null && currency === null) {
    errors.currency = currencyText
      ? "Enter the currency as a three-letter code, such as USD"
      : "Enter the currency";
  }

  return result(errors, () => ({
    partId: partId!,
    supplierSku: optionalText(form, "supplier_sku"),
    purchaseQuantity: Number(purchaseQuantity),
    purchaseUnit,
    packQuantity: Number(packQuantity),
    unitPrice,
    currency: unitPrice === null ? null : currency,
    notes: optionalText(form, "notes"),
  }));
}

/**
 * The owner's assignment of accepted stock to commitments: paired `assign_commitment` and
 * `assign_quantity` fields, used only when `custom_assignment` is checked.
 */
function assignments(form: FormData, errors: FieldErrors): CommitmentAssignment[] | null {
  if (text(form, "custom_assignment") !== "on") return null;
  const ids = allText(form, "assign_commitment");
  const quantities = allText(form, "assign_quantity");
  return ids.map((id, index) => {
    const quantity = quantities[index] || "0";
    if (!WHOLE.test(quantity)) errors.assign_quantity = "Assigned quantities must be whole numbers";
    const commitmentId = parseId(id);
    if (commitmentId === null || Number.isNaN(commitmentId)) {
      errors.assign_commitment = "Missing commitment; reload the page";
    }
    return { commitmentId: commitmentId ?? 0, quantity: Number(quantity) };
  });
}

/** One line of the receipt review. Quantities are in the part's base unit. */
export function parseReceiptLineForm(form: FormData): ParseResult<ReceiptLineFormInput> {
  const errors: FieldErrors = {};
  const { operationId, receivedOn } = operation(form, errors);
  const orderLineId = parseId(text(form, "order_line_id"));
  if (orderLineId === null || Number.isNaN(orderLineId)) errors.order_line_id = "Missing line";
  const acceptedQuantity = wholeNumber(form, "accepted", errors, "Usable quantity");
  const damagedQuantity = wholeNumber(form, "damaged", errors, "Damaged quantity");
  const locationId = parseId(text(form, "location_id"));
  if (Number.isNaN(locationId)) errors.location_id = "Choose a location";
  const assigned = assignments(form, errors);
  const pieceSize = parsePieceSize(form, errors);
  return result(errors, () => ({
    operationId,
    receivedOn,
    orderLineId: orderLineId!,
    acceptedQuantity,
    damagedQuantity,
    locationId,
    notes: optionalText(form, "notes"),
    cancelRemainder: text(form, "cancel_remainder") === "on",
    assignments: assigned,
    pieceSize,
  }));
}

/** The optional `piece_length` and `piece_width` of received pieces, in mm or inches. */
function parsePieceSize(form: FormData, errors: FieldErrors) {
  const length = text(form, "piece_length");
  const width = text(form, "piece_width");
  if (!length && !width) return null;
  const lengthMm = parseLengthMm(length);
  const widthMm = width ? parseLengthMm(width) : null;
  if (lengthMm === null || (width && widthMm === null)) {
    errors.piece_size = "Enter the piece size as a length, such as 1220 or 48 in";
    return null;
  }
  return { lengthMm, widthMm };
}

export function parseReceiveAllForm(form: FormData): ParseResult<ReceiveAllFormInput> {
  const errors: FieldErrors = {};
  const { operationId, receivedOn } = operation(form, errors);
  const locationId = parseId(text(form, "location_id"));
  if (locationId === null || Number.isNaN(locationId)) errors.location_id = "Choose a location";
  return result(errors, () => ({
    operationId,
    receivedOn,
    locationId: locationId!,
    notes: optionalText(form, "notes"),
  }));
}
