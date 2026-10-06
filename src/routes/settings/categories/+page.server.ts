import { inventory } from "#lib/server/inventory/index.ts";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = () => ({
  categories: inventory().taxonomy.listCategories(),
});
