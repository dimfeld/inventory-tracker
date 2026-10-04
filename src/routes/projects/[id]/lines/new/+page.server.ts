import { error, fail, redirect } from "@sveltejs/kit";
import { parseId } from "#lib/schemas/result.ts";
import { parseBomLineForm } from "#lib/schemas/project.ts";
import { runAction } from "#lib/server/forms.ts";
import { projects } from "#lib/server/projects/index.ts";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = ({ params, url }) => {
  const details = projects().getProjectDetails(Number(params.id));
  if (!details) error(404, "Project not found");
  const componentId = parseId(url.searchParams.get("component") ?? "");
  return {
    project: details.project,
    options: { ...projects().bomFormOptions(), components: details.components },
    componentId: Number.isNaN(componentId) ? null : componentId,
  };
};

export const actions: Actions = {
  default: async ({ request, params }) => {
    const projectId = Number(params.id);
    const parsed = parseBomLineForm(await request.formData());
    if (!parsed.success) return fail(400, { errors: parsed.errors });
    const result = runAction("create", () => projects().createBomLine(projectId, parsed.data));
    if (typeof result !== "number") return result;
    redirect(303, `/projects/${projectId}/lines/${result}`);
  },
};
