import { error } from "@sveltejs/kit";
import { isNormalizationRule } from "#lib/attributes.ts";
import { categoryOptions } from "#lib/categories.ts";
import { inventory } from "#lib/server/inventory/index.ts";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = ({ params }) => {
  const { catalog, taxonomy } = inventory();
  const attribute = taxonomy.listAttributes().find((a) => a.key === params.key);
  if (!attribute) error(404, "Attribute not found");
  return {
    attribute: {
      ...attribute,
      normalization: isNormalizationRule(attribute.normalization) ? attribute.normalization : null,
    },
    values: taxonomy.listValues(attribute.key),
    categories: categoryOptions(catalog.listCategories()),
  };
};
