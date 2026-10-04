import { fail, redirect } from "@sveltejs/kit";
import { categoryOptions } from "#lib/categories.ts";
import { parsePartForm } from "#lib/schemas/part.ts";
import { runAction } from "#lib/server/forms.ts";
import { inventory } from "#lib/server/inventory/index.ts";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = () => ({
  categories: categoryOptions(inventory().catalog.listCategories()),
  attributeOptions: inventory().catalog.attributeOptions(),
});

export const actions: Actions = {
  default: async ({ request }) => {
    const parsed = parsePartForm(await request.formData());
    if (!parsed.success) return fail(400, { errors: parsed.errors });
    const result = runAction("create", () => inventory().catalog.createPart(parsed.data));
    if (typeof result !== "number") return result;
    redirect(303, `/parts/${result}`);
  },
};
