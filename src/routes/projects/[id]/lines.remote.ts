import { invalid } from "@sveltejs/kit";
import * as z from "zod";
import { form } from "$app/server";
import { isUnit } from "#lib/units.ts";
import { isUserError } from "#lib/server/inventory/index.ts";
import { allocations, commitments, projects } from "#lib/server/projects/index.ts";

/** Run a service call. A rejected request becomes a form issue with the service's message. */
function attempt(fn: () => void) {
  try {
    fn();
  } catch (error) {
    if (!isUserError(error)) throw error;
    invalid(error.message);
  }
}

const id = z.number().int();
const quantity = z.number().int().positive();

/**
 * Approve a part for a BOM requirement from the project table, as a confirmed match (not a
 * substitute). Use one instance per line with `approvePart.for(lineId)`.
 */
export const approvePart = form(
  z.object({ projectId: id, lineId: id, partId: id }),
  ({ projectId, lineId, partId }) =>
    attempt(() =>
      projects().approveChoice(projectId, lineId, { partId, substitute: false, note: null })
    )
);

/**
 * Reserve storage stock of an approved part for a line. `quantity` is a whole amount of `unit`,
 * the part's base unit. Use one instance per line, part, and location.
 */
export const reserveStock = form(
  z.object({
    projectId: id,
    lineId: id,
    partId: id,
    locationId: id,
    quantity,
    unit: z.string().refine(isUnit, "Choose a unit"),
  }),
  ({ quantity, ...input }) =>
    attempt(() => allocations().reserve({ ...input, amount: String(quantity) }))
);

/**
 * Commit uncommitted order supply to a line. `quantity` is a whole amount of the order line
 * part's base unit. Use one instance per line and order line.
 */
export const commitIncoming = form(
  z.object({ projectId: id, lineId: id, orderLineId: id, quantity }),
  (input) => attempt(() => commitments().assign(input))
);
