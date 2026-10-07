import { error, fail, redirect } from "@sveltejs/kit";
import { categoryOptions } from "#lib/categories.ts";
import { parsePartForm } from "#lib/schemas/part.ts";
import { parseId } from "#lib/schemas/result.ts";
import { runAction } from "#lib/server/forms.ts";
import { inventory } from "#lib/server/inventory/index.ts";
import type { Actions, PageServerLoad } from "./$types";

/** With `?from=<part ID>`, the form starts as a copy of that part. */
export const load: PageServerLoad = ({ url }) => {
  const { catalog } = inventory();
  const fromId = parseId(url.searchParams.get("from") ?? "");
  let copy = null;
  if (fromId !== null) {
    const input = Number.isNaN(fromId) ? null : catalog.copyPartInput(fromId);
    if (!input) error(404, "The part to copy was not found");
    copy = {
      fromName: input.name,
      initial: {
        ...input,
        attributes: input.attributes.map((a) => ({ label: a.label, rawValue: a.value })),
        supplierParts: [],
      },
    };
  }
  return {
    copy,
    categories: categoryOptions(catalog.listCategories()),
    attributeOptions: catalog.attributeOptions(),
  };
};

export const actions: Actions = {
  default: async ({ request }) => {
    const parsed = parsePartForm(await request.formData());
    if (!parsed.success) return fail(400, { errors: parsed.errors });
    const result = runAction("create", () => inventory().catalog.createPart(parsed.data));
    if (typeof result !== "number") return result;
    redirect(303, `/parts/${result}`);
  },
};
