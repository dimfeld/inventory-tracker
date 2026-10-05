import { error } from "@sveltejs/kit";
import { estimates } from "#lib/server/projects/index.ts";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = ({ params }) => {
  const estimate = estimates().getProjectEstimate(Number(params.id));
  if (!estimate) error(404, "Project not found");
  return estimate;
};
