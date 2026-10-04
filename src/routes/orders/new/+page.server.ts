import { fail, redirect } from "@sveltejs/kit";
import { parseOrderForm } from "#lib/schemas/order.ts";
import { runAction } from "#lib/server/forms.ts";
import { inventory } from "#lib/server/inventory/index.ts";
import type { Actions } from "./$types";

export const actions: Actions = {
  default: async ({ request }) => {
    const parsed = parseOrderForm(await request.formData());
    if (!parsed.success) return fail(400, { errors: parsed.errors });
    const result = runAction("create", () => inventory().orders.createOrder(parsed.data));
    if (!("id" in result)) return result;
    redirect(303, `/orders/${result.id}`);
  },
};
