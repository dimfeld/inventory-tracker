import { error, fail, redirect } from "@sveltejs/kit";
import { categoryOptions } from "#lib/categories.ts";
import { parsePartForm } from "#lib/schemas/part.ts";
import { runAction } from "#lib/server/forms.ts";
import { inventory } from "#lib/server/inventory/index.ts";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = ({ params }) => {
  const { catalog } = inventory();
  const details = catalog.getPartDetails(Number(params.id));
  if (!details) error(404, "Part not found");
  return {
    part: details.part,
    initial: {
      ...details.part,
      attributes: details.attributes,
      aliases: details.aliases,
      tags: details.tags,
      supplierParts: details.supplierParts,
      tracking: {
        mode: details.part.trackingMode,
        lengthKey: details.pieceDimensions?.length.key ?? null,
        widthKey: details.pieceDimensions?.width?.key ?? null,
        kerfMm: details.part.kerfMm,
        minOffcutMm: details.part.minOffcutMm,
      },
    },
    baseUnitLocked: catalog.hasMovements(details.part.id),
    categories: categoryOptions(catalog.listCategories()),
    attributeOptions: catalog.attributeOptions(),
  };
};

export const actions: Actions = {
  default: async ({ request, params }) => {
    const id = Number(params.id);
    const parsed = parsePartForm(await request.formData());
    if (!parsed.success) return fail(400, { errors: parsed.errors });
    const failure = runAction("update", () => inventory().catalog.updatePart(id, parsed.data));
    if (failure) return failure;
    redirect(303, `/parts/${id}`);
  },
};
