import { error, fail } from "@sveltejs/kit";
import {
  parseDate,
  parseOrderForm,
  parseOrderLineForm,
  parseReceiveAllForm,
} from "#lib/schemas/order.ts";
import { allText, parseId, text } from "#lib/schemas/result.ts";
import { today } from "#lib/schemas/stock.ts";
import { runAction } from "#lib/server/forms.ts";
import { inventory } from "#lib/server/inventory/index.ts";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = ({ params }) => {
  const details = inventory().orders.getOrderDetails(Number(params.id));
  if (!details) error(404, "Order not found");
  return {
    ...details,
    parts: inventory().catalog.partOptions(),
    pieceParts: inventory().catalog.piecePartSettings(),
    storageLocations: inventory().locations.listStorageLocations(),
    today: today(),
    // One ID per page load; a repeated submission returns the receipt it already created.
    operationId: crypto.randomUUID(),
  };
};

/** The order line ID of a line action. Returns null when it is missing or invalid. */
function lineId(form: FormData): number | null {
  const id = parseId(text(form, "line_id"));
  return id === null || Number.isNaN(id) ? null : id;
}

/** The order line IDs of a delivery action. Returns null when one is invalid. */
function lineIds(form: FormData): number[] | null {
  const ids = allText(form, "line_id").map(parseId);
  return ids.some((id) => id === null || Number.isNaN(id)) ? null : (ids as number[]);
}

/** Text such as "1 line" or "3 lines". */
function lineCount(count: number): string {
  return count === 1 ? "1 line" : `${count} lines`;
}

/** Text about project commitments that a line change reduced. */
function commitmentNote(reduced: number): string {
  return reduced > 0
    ? ` Reduced ${reduced} project commitment(s); those requirements now show the shortage.`
    : "";
}

/** An action that changes the order's state on the date in `date`. */
function stateAction(run: (orderId: number, date: string) => void, success: string) {
  return async ({ request, params }: { request: Request; params: { id: string } }) => {
    const date = parseDate(await request.formData(), "date");
    if (!date.success) return fail(400, { action: "state", errors: date.errors });
    return runAction("state", () => {
      run(Number(params.id), date.data);
      return { action: "state", success };
    });
  };
}

export const actions: Actions = {
  update: async ({ request, params }) => {
    const parsed = parseOrderForm(await request.formData());
    if (!parsed.success) return fail(400, { action: "update", errors: parsed.errors });
    return runAction("update", () => {
      inventory().orders.updateOrder(Number(params.id), parsed.data);
      return { action: "update", success: "Order saved." };
    });
  },

  place: stateAction((id, date) => inventory().orders.markPlaced(id, date), "Order placed."),
  ship: stateAction((id, date) => inventory().orders.markShipped(id, date), "Order shipped."),

  deliverLines: async ({ request, params }) => {
    const form = await request.formData();
    const ids = lineIds(form);
    const date = parseDate(form, "date");
    if (ids === null) return fail(400, { action: "delivery", message: "Choose valid lines" });
    if (!date.success) return fail(400, { action: "delivery", errors: date.errors });
    return runAction("delivery", () => {
      const count = inventory().orders.markLinesDelivered(Number(params.id), ids, date.data);
      return {
        action: "delivery",
        success: `Marked ${lineCount(count)} delivered. No stock was added; review the items to receive them.`,
      };
    });
  },

  deliverOutstanding: async ({ request, params }) => {
    const date = parseDate(await request.formData(), "date");
    if (!date.success) return fail(400, { action: "delivery", errors: date.errors });
    return runAction("delivery", () => {
      const count = inventory().orders.markOutstandingDelivered(Number(params.id), date.data);
      return {
        action: "delivery",
        success: `Marked ${lineCount(count)} delivered. No stock was added; review the items to receive them.`,
      };
    });
  },

  receiveSelected: async ({ request, params }) => {
    const form = await request.formData();
    const ids = lineIds(form);
    // The receipt date is the date of the delivery form.
    form.set("received_on", text(form, "date"));
    const parsed = parseReceiveAllForm(form);
    if (ids === null || ids.length === 0) {
      return fail(400, { action: "delivery", message: "Choose lines to receive" });
    }
    if (!parsed.success) return fail(400, { action: "delivery", errors: parsed.errors });
    return runAction("delivery", () => {
      const result = inventory().receipts.receiveAllOutstanding({
        ...parsed.data,
        orderId: Number(params.id),
        orderLineIds: ids,
      });
      return {
        action: "delivery",
        success: result.repeated
          ? "This receipt was already recorded. No stock was added again."
          : `Received ${lineCount(result.lines.length)} into stock.`,
      };
    });
  },

  addLine: async ({ request, params }) => {
    const parsed = parseOrderLineForm(await request.formData());
    if (!parsed.success) return fail(400, { action: "addLine", errors: parsed.errors });
    return runAction("addLine", () => {
      inventory().orders.addLine(Number(params.id), parsed.data);
      return { action: "addLine", success: "Line added." };
    });
  },

  updateLine: async ({ request, params }) => {
    const form = await request.formData();
    const id = lineId(form);
    const parsed = parseOrderLineForm(form);
    if (id === null) return fail(400, { action: "line", message: "Choose a line" });
    if (!parsed.success) return fail(400, { action: "line", errors: parsed.errors });
    return runAction("line", () => {
      const reduced = inventory().orders.updateLine(Number(params.id), id, parsed.data);
      return { action: "line", success: `Line corrected.${commitmentNote(reduced)}` };
    });
  },

  removeLine: async ({ request, params }) => {
    const id = lineId(await request.formData());
    if (id === null) return fail(400, { action: "line", message: "Choose a line" });
    return runAction("line", () => {
      const reduced = inventory().orders.removeLine(Number(params.id), id);
      return { action: "line", success: `Line removed.${commitmentNote(reduced)}` };
    });
  },

  cancelRemainder: async ({ request, params }) => {
    const id = lineId(await request.formData());
    if (id === null) return fail(400, { action: "line", message: "Choose a line" });
    return runAction("line", () => {
      const reduced = inventory().orders.cancelRemainder(Number(params.id), id);
      return {
        action: "line",
        success: `Outstanding quantity cancelled.${commitmentNote(reduced)}`,
      };
    });
  },
};
