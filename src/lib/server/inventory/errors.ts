import { UnitError } from "#lib/units.ts";

/** An error caused by the requested change. Its message is safe to show to the owner. */
export class InventoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class NotFoundError extends InventoryError {}

export class InsufficientStockError extends InventoryError {}

export class DuplicateOperationError extends InventoryError {
  constructor(readonly operationId: string) {
    super("This operation was already recorded.");
  }
}

/** True for errors that describe a rejected request rather than a bug. */
export function isUserError(error: unknown): error is Error {
  return error instanceof InventoryError || error instanceof UnitError;
}
