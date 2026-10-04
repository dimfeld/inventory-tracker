import { fail, redirect } from "@sveltejs/kit";
import { parseNewImportForm } from "#lib/schemas/import.ts";
import { imports } from "#lib/server/imports/index.ts";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = ({ url }) => {
  const created = url.searchParams.get("created");
  const skipped = url.searchParams.get("skipped");
  const hasBatchCounts =
    created !== null && skipped !== null && /^\d+$/.test(created) && /^\d+$/.test(skipped);
  return {
    imports: imports().listImports(),
    batch: hasBatchCounts ? { created: Number(created), skipped: Number(skipped) } : null,
  };
};

export const actions: Actions = {
  default: async ({ request }) => {
    const parsed = parseNewImportForm(await request.formData());
    if (!parsed.success) return fail(400, { errors: parsed.errors });
    const result = imports().createCsvOrderBatch(parsed.data);
    if (!result.batched || (result.ids.length === 1 && result.skipped.length === 0)) {
      redirect(303, `/imports/${result.ids[0]}`);
    }
    redirect(303, `/imports?created=${result.ids.length}&skipped=${result.skipped.length}`);
  },
};
