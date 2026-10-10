import { shopping } from "#lib/server/projects/index.ts";
import { parseComponentFilter } from "#lib/server/projects/projects.ts";
import type { PageServerLoad } from "./$types";

/**
 * Query: `project` (repeated) selects projects. Without one, every planned, active, and paused
 * project is included. `component` is a component ID or "ungrouped".
 */
export const load: PageServerLoad = ({ url }) => {
  const projects = shopping().openProjects();
  const selected = url.searchParams.getAll("project").map(Number);
  const component = parseComponentFilter(url.searchParams.get("component"));
  return {
    projects,
    selected,
    component,
    items: shopping().getShoppingList({
      projectIds: selected.length > 0 ? selected : null,
      component,
    }),
  };
};
