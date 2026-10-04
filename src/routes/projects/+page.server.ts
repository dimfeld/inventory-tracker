import { fail, redirect } from "@sveltejs/kit";
import { parseProjectForm } from "#lib/schemas/project.ts";
import { runAction } from "#lib/server/forms.ts";
import { projects } from "#lib/server/projects/index.ts";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = () => ({
  projects: projects().listProjects(),
});

export const actions: Actions = {
  create: async ({ request }) => {
    const parsed = parseProjectForm(await request.formData());
    if (!parsed.success) return fail(400, { action: "create", errors: parsed.errors });
    const result = runAction("create", () => projects().createProject(parsed.data));
    if (typeof result !== "number") return result;
    redirect(303, `/projects/${result}`);
  },
};
