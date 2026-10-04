import { fail, redirect } from "@sveltejs/kit";
import { parseNewImportForm } from "#lib/schemas/import.ts";
import { imports } from "#lib/server/imports/index.ts";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = () => ({ imports: imports().listImports() });

export const actions: Actions = {
  default: async ({ request }) => {
    const parsed = parseNewImportForm(await request.formData());
    if (!parsed.success) return fail(400, { errors: parsed.errors });
    const id = imports().createImport(parsed.data);
    redirect(303, `/imports/${id}`);
  },
};
