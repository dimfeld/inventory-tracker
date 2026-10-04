import { shopping } from "#lib/server/projects/index.ts";
import { parseComponentFilter } from "#lib/server/projects/projects.ts";
import type { PageServerLoad } from "./$types";

/**
 * Query: `project` (repeated) selects projects once the selection form was submitted, which
 * sets `select`; without it every planned, active, and paused project is included. `component`
 * is a component ID or "ungrouped".
 */
export const load: PageServerLoad = ({ url }) => {
  const projects = shopping().openProjects();
  const projectIds = url.searchParams.has("select")
    ? url.searchParams.getAll("project").map(Number)
    : null;
  const component = parseComponentFilter(url.searchParams.get("component"));
  return {
    projects,
    selected: projectIds ?? projects.map((p) => p.id),
    component,
    items: shopping().getShoppingList({ projectIds, component }),
  };
};
