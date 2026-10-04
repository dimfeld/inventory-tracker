import { error, fail } from "@sveltejs/kit";
import { parseReceiptLineForm, parseReceiveAllForm } from "#lib/schemas/order.ts";
import { today } from "#lib/schemas/stock.ts";
import { runAction } from "#lib/server/forms.ts";
import { inventory } from "#lib/server/inventory/index.ts";
import type { ReceiptResult } from "#lib/server/inventory/receipts.ts";
import { formatQuantity } from "#lib/units.ts";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = ({ params }) => {
  const details = inventory().orders.getOrderDetails(Number(params.id));
  if (!details) error(404, "Order not found");
  return {
    order: details.order,
    lines: details.lines.filter((line) => line.outstanding > 0),
    storageLocations: inventory().locations.listStorageLocations(),
    today: today(),
    // One ID per page load; a repeated submission returns the receipt it already created.
    operationId: crypto.randomUUID(),
  };
};

function summary(result: ReceiptResult): string {
  if (result.repeated) return "This receipt was already recorded. No stock was added again.";
  const lines = result.lines.map((line) => {
    const usable = `${formatQuantity(line.acceptedQuantity, line.baseUnit)} of ${line.partName}`;
    const destination = line.locationName ? ` to ${line.locationName}` : "";
    const damaged =
      line.damagedQuantity > 0
        ? ` (${formatQuantity(line.damagedQuantity, line.baseUnit)} damaged)`
        : "";
    return `${usable}${destination}${damaged}`;
  });
  return `Received ${lines.join("; ")}.`;
}

export const actions: Actions = {
  receiveLine: async ({ request, params }) => {
    const parsed = parseReceiptLineForm(await request.formData());
    if (!parsed.success) return fail(400, { action: "receive", errors: parsed.errors });
    const { operationId, receivedOn, ...line } = parsed.data;
    return runAction("receive", () => {
      const result = inventory().receipts.receive({
        operationId,
        orderId: Number(params.id),
        receivedOn,
        notes: null,
        lines: [line],
      });
      return { action: "receive", success: summary(result) };
    });
  },

  receiveAll: async ({ request, params }) => {
    const parsed = parseReceiveAllForm(await request.formData());
    if (!parsed.success) return fail(400, { action: "receive", errors: parsed.errors });
    return runAction("receive", () => {
      const result = inventory().receipts.receiveAllOutstanding({
        ...parsed.data,
        orderId: Number(params.id),
      });
      return { action: "receive", success: summary(result) };
    });
  },
};
