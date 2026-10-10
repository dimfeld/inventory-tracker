import { error } from "@sveltejs/kit";
import { today } from "#lib/schemas/stock.ts";
import { inventory } from "#lib/server/inventory/index.ts";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = ({ params }) => {
  const { locations, pieces } = inventory();
  const history = pieces.getPieceHistory(Number(params.id));
  if (!history) error(404, "Piece not found");
  return {
    ...history,
    locations: locations.listStorageLocations(),
    today: today(),
    // One ID per page load; a repeated submission of the same form is rejected.
    operationId: crypto.randomUUID(),
  };
};
