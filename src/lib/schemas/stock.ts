import { isUnit, type Unit } from "#lib/units.ts";
import { optionalText, parseId, text, type FieldErrors, type ParseResult } from "./result";

export type StockAction = "opening" | "transfer" | "loss" | "supplier_return" | "count";

/** Fields shared by every stock form. Location fields depend on the action. */
export interface StockFormInput {
  operationId: string;
  occurredOn: string;
  amount: string;
  unit: Unit;
  reason: string | null;
  locationId: number;
  /** Destination for transfers. */
  toLocationId: number | null;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const AMOUNT = /^\d+(\.\d+)?$/;

/** Actions that must explain why stock left or changed. */
const REASON_REQUIRED: StockAction[] = ["loss", "supplier_return", "count"];

export function today(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export function parseStockForm(action: StockAction, form: FormData): ParseResult<StockFormInput> {
  const errors: FieldErrors = {};

  const operationId = text(form, "operation_id");
  if (!operationId) errors.operation_id = "Missing operation ID; reload the page";

  const occurredOn = text(form, "occurred_on") || today();
  if (!DATE.test(occurredOn)) errors.occurred_on = "Enter a date as YYYY-MM-DD";

  const amount = text(form, "amount");
  if (!AMOUNT.test(amount)) errors.amount = "Enter a non-negative number";

  const unit = text(form, "unit");
  if (!isUnit(unit)) errors.unit = "Choose a unit";

  const reason = optionalText(form, "reason");
  if (!reason && REASON_REQUIRED.includes(action)) errors.reason = "Enter a reason";

  const locationId = parseId(text(form, "location_id"));
  if (locationId === null || Number.isNaN(locationId)) errors.location_id = "Choose a location";

  let toLocationId: number | null = null;
  if (action === "transfer") {
    toLocationId = parseId(text(form, "to_location_id"));
    if (toLocationId === null || Number.isNaN(toLocationId)) {
      errors.to_location_id = "Choose a destination";
    }
  }

  if (Object.keys(errors).length > 0) return { success: false, errors };

  return {
    success: true,
    data: {
      operationId,
      occurredOn,
      amount,
      unit: unit as Unit,
      reason,
      locationId: locationId!,
      toLocationId,
    },
  };
}
