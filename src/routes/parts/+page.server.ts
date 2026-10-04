import { categoryOptions } from "#lib/categories.ts";
import { inventory } from "#lib/server/inventory/index.ts";
import { parsePartFilters } from "./filters";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = ({ url }) => {
  const { catalog } = inventory();
  const filters = parsePartFilters(url.searchParams);
  return {
    filters,
    categories: categoryOptions(catalog.listCategories()),
    tags: catalog.listTags(),
    facets: catalog.partFacets(filters.category, filters.archived),
    parts: catalog.searchParts({
      text: filters.q || null,
      categoryId: filters.category,
      attributes: Object.entries(filters.attributes).map(([key, values]) => ({ key, values })),
      tags: filters.tags,
      includeArchived: filters.archived,
    }),
  };
};
