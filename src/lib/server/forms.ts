import { fail } from "@sveltejs/kit";
import { isUserError } from "#lib/server/inventory/index.ts";

/**
 * Run a form action body. Errors that describe a rejected request become a 400 failure with
 * `{ action, message }`; other errors propagate.
 */
export function runAction<T>(action: string, fn: () => T) {
  try {
    return fn();
  } catch (error) {
    if (isUserError(error)) {
      return fail(400, { action, message: error.message });
    }
    throw error;
  }
}
