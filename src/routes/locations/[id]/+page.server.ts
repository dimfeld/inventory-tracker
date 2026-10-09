import { error } from "@sveltejs/kit";
import { inventory } from "#lib/server/inventory/index.ts";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = ({ params }) => {
  const { locations, pieces } = inventory();
  const location = locations.getLocation(Number(params.id));
  if (!location) error(404, "Location not found");
  return { location, pieces: pieces.listLocationPieces(location.id) };
};
