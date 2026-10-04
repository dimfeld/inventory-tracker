import { parseId, text, type FieldErrors, type ParseResult } from "./result";

export interface AssignFormInput {
  orderLineId: number;
  /** Whole amount of the order line part's base unit. */
  quantity: number;
}

export interface ReleaseFormInput {
  commitmentId: number;
  quantity: number;
}

const WHOLE = /^\d+$/;

function requiredId(form: FormData, name: string, message: string, errors: FieldErrors): number {
  const id = parseId(text(form, name));
  if (id === null || Number.isNaN(id)) errors[name] = message;
  return id ?? 0;
}

function quantity(form: FormData, errors: FieldErrors): number {
  const value = text(form, "quantity");
  if (!WHOLE.test(value) || Number(value) === 0) errors.quantity = "Enter a whole quantity";
  return Number(value);
}

/** Commit incoming supply to a row. Fields: `order_line_id` and `quantity`. */
export function parseAssignForm(form: FormData): ParseResult<AssignFormInput> {
  const errors: FieldErrors = {};
  const orderLineId = requiredId(form, "order_line_id", "Choose an order line", errors);
  const amount = quantity(form, errors);
  if (Object.keys(errors).length > 0) return { success: false, errors };
  return { success: true, data: { orderLineId, quantity: amount } };
}

/** Release part of a commitment. Fields: `commitment_id` and `quantity`. */
export function parseReleaseForm(form: FormData): ParseResult<ReleaseFormInput> {
  const errors: FieldErrors = {};
  const commitmentId = requiredId(form, "commitment_id", "Choose a commitment", errors);
  const amount = quantity(form, errors);
  if (Object.keys(errors).length > 0) return { success: false, errors };
  return { success: true, data: { commitmentId, quantity: amount } };
}
