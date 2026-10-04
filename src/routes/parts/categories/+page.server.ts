import { fail } from "@sveltejs/kit";
import { categoryOptions } from "#lib/categories.ts";
import { parseCategoryForm } from "#lib/schemas/category.ts";
import { runAction } from "#lib/server/forms.ts";
import { inventory } from "#lib/server/inventory/index.ts";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = () => ({
  categories: categoryOptions(inventory().catalog.listCategories()),
});

export const actions: Actions = {
  create: async ({ request }) => {
    const parsed = parseCategoryForm(await request.formData());
    if (!parsed.success) return fail(400, { action: "create", errors: parsed.errors });
    return runAction("create", () => {
      inventory().catalog.createCategory(parsed.data.name, parsed.data.parentId);
      return { action: "create", created: parsed.data.name };
    });
  },
};
