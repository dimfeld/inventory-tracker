import { inventory } from "#lib/server/inventory/index.ts";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = ({ url }) => {
  const includeArchived = url.searchParams.get("archived") === "1";
  return {
    includeArchived,
    parts: inventory().catalog.listParts({ includeArchived }),
  };
};
