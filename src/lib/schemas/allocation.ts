import { isUnit, type Unit } from "#lib/units.ts";
import { optionalText, parseId, text, type FieldErrors, type ParseResult } from "./result";
import { today } from "./stock";

export type AllocationAction = "reserve" | "release" | "pick" | "use" | "return";

export interface AllocationFormInput {
  lineId: number;
  partId: number;
  /** Storage location: the reservation's location, or the return destination. Null for use. */
  locationId: number | null;
  amount: string;
  unit: Unit;
  /** Required for actions that move stock. */
  operationId: string;
  occurredOn: string;
  reason: string | null;
  reserveAgain: boolean;
}

const AMOUNT = /^\d+(\.\d+)?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Actions that write a stock movement and need a unique operation ID. */
const MOVES_STOCK: AllocationAction[] = ["pick", "use", "return"];

function requiredId(form: FormData, name: string, message: string, errors: FieldErrors): number {
  const id = parseId(text(form, name));
  if (id === null || Number.isNaN(id)) errors[name] = message;
  return id ?? 0;
}

/**
 * Parse a reserve, release, pick, use, or return form. Fields: `line_id`, `part_id`,
 * `location_id` (all but use), `amount`, `unit`, and for stock movements `operation_id` and
 * optional `occurred_on`. Use takes an optional `reason`; return takes a `reserve_again` checkbox.
 */
export function parseAllocationForm(
  action: AllocationAction,
  form: FormData
): ParseResult<AllocationFormInput> {
  const errors: FieldErrors = {};
  const lineId = requiredId(form, "line_id", "Choose a BOM row", errors);
  const partId = requiredId(form, "part_id", "Choose a part", errors);
  const locationId =
    action === "use" ? null : requiredId(form, "location_id", "Choose a location", errors);

  const amount = text(form, "amount");
  if (!AMOUNT.test(amount)) errors.amount = "Enter a quantity";
  const unit = text(form, "unit");
  if (!isUnit(unit)) errors.unit = "Choose a unit";

  const operationId = text(form, "operation_id");
  if (!operationId && MOVES_STOCK.includes(action)) {
    errors.operation_id = "Missing operation ID; reload the page";
  }
  const occurredOn = text(form, "occurred_on") || today();
  if (!DATE.test(occurredOn)) errors.occurred_on = "Enter a date as YYYY-MM-DD";

  if (Object.keys(errors).length > 0) return { success: false, errors };
  return {
    success: true,
    data: {
      lineId,
      partId,
      locationId,
      amount,
      unit: unit as Unit,
      operationId,
      occurredOn,
      reason: optionalText(form, "reason"),
      reserveAgain: text(form, "reserve_again") === "on",
    },
  };
}
