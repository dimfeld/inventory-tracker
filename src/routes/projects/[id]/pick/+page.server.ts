import { error } from "@sveltejs/kit";
import { today } from "#lib/schemas/stock.ts";
import { allocationAction } from "#lib/server/projects/allocation-actions.ts";
import { allocations, pieceAllocations, projects } from "#lib/server/projects/index.ts";
import { parseComponentFilter } from "#lib/server/projects/projects.ts";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = ({ params, url }) => {
  const filter = parseComponentFilter(url.searchParams.get("component"));
  const details = projects().getProjectDetails(Number(params.id));
  if (!details) error(404, "Project not found");
  return {
    project: details.project,
    components: details.components,
    filter,
    stops: allocations().getPickList(details.project.id, filter),
    pieceStops: pieceAllocations().getPiecePickList(details.project.id, filter),
    today: today(),
    // One ID per page load; a repeated submission of the same form is rejected.
    operationId: crypto.randomUUID(),
  };
};

export const actions: Actions = {
  pick: allocationAction("pick"),
};
