import { error, fail } from "@sveltejs/kit";
import { parseDate, parseOrderForm, parseOrderLineForm } from "#lib/schemas/order.ts";
import { parseId, text } from "#lib/schemas/result.ts";
import { today } from "#lib/schemas/stock.ts";
import { runAction } from "#lib/server/forms.ts";
import { inventory } from "#lib/server/inventory/index.ts";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = ({ params }) => {
  const details = inventory().orders.getOrderDetails(Number(params.id));
  if (!details) error(404, "Order not found");
  return { ...details, parts: inventory().orders.partOptions(), today: today() };
};

/** The order line ID of a line action. Returns null when it is missing or invalid. */
function lineId(form: FormData): number | null {
  const id = parseId(text(form, "line_id"));
  return id === null || Number.isNaN(id) ? null : id;
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
  deliver: stateAction(
    (id, date) => inventory().orders.markDelivered(id, date),
    "Marked delivered. No stock was added; review the items to receive them."
  ),
  finishReview: stateAction((id) => inventory().orders.finishReview(id), "Review finished."),

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
