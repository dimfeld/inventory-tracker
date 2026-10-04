import { error, fail } from "@sveltejs/kit";
import { parseId, text } from "#lib/schemas/result.ts";
import { parseComponentForm, parseProjectForm } from "#lib/schemas/project.ts";
import { runAction } from "#lib/server/forms.ts";
import { projects } from "#lib/server/projects/index.ts";
import type { ComponentFilter } from "#lib/server/projects/projects.ts";
import type { Actions, PageServerLoad } from "./$types";

function componentFilter(value: string | null): ComponentFilter {
  if (value === "ungrouped") return "ungrouped";
  const id = parseId(value ?? "");
  return id === null || Number.isNaN(id) ? null : id;
}

export const load: PageServerLoad = ({ params, url }) => {
  const filter = componentFilter(url.searchParams.get("component"));
  const details = projects().getProjectDetails(Number(params.id), filter);
  if (!details) error(404, "Project not found");
  return { ...details, filter };
};

/** A required ID field from a form. Returns null when it is missing or invalid. */
function requiredId(form: FormData, name: string): number | null {
  const id = parseId(text(form, name));
  return id === null || Number.isNaN(id) ? null : id;
}

export const actions: Actions = {
  update: async ({ request, params }) => {
    const parsed = parseProjectForm(await request.formData());
    if (!parsed.success) return fail(400, { action: "update", errors: parsed.errors });
    return runAction("update", () => {
      projects().updateProject(Number(params.id), parsed.data);
      return { action: "update", success: "Project saved." };
    });
  },

  createComponent: async ({ request, params }) => {
    const parsed = parseComponentForm(await request.formData());
    if (!parsed.success) return fail(400, { action: "component", errors: parsed.errors });
    return runAction("component", () => {
      projects().createComponent(Number(params.id), parsed.data);
      return { action: "component", success: `Added ${parsed.data.name}.` };
    });
  },

  renameComponent: async ({ request, params }) => {
    const form = await request.formData();
    const id = requiredId(form, "component_id");
    const parsed = parseComponentForm(form);
    if (id === null) return fail(400, { action: "component", message: "Choose a component" });
    if (!parsed.success) return fail(400, { action: "component", errors: parsed.errors });
    return runAction("component", () => {
      projects().updateComponent(Number(params.id), id, parsed.data);
      return { action: "component", success: "Component saved." };
    });
  },

  moveComponent: async ({ request, params }) => {
    const form = await request.formData();
    const id = requiredId(form, "component_id");
    const direction = text(form, "direction");
    if (id === null || (direction !== "up" && direction !== "down")) {
      return fail(400, { action: "component", message: "Choose a component and direction" });
    }
    return runAction("component", () => {
      projects().moveComponent(Number(params.id), id, direction);
      return { action: "component" };
    });
  },

  removeComponent: async ({ request, params }) => {
    const id = requiredId(await request.formData(), "component_id");
    if (id === null) return fail(400, { action: "component", message: "Choose a component" });
    return runAction("component", () => {
      projects().removeComponent(Number(params.id), id);
      return { action: "component", success: "Component removed; its rows are now ungrouped." };
    });
  },

  assignLine: async ({ request, params }) => {
    const form = await request.formData();
    const lineId = requiredId(form, "line_id");
    const componentId = parseId(text(form, "component_id"));
    if (lineId === null || Number.isNaN(componentId)) {
      return fail(400, { action: "line", message: "Choose a row and a component" });
    }
    return runAction("line", () => {
      projects().setLineComponent(Number(params.id), lineId, componentId);
      return { action: "line" };
    });
  },

  deleteLine: async ({ request, params }) => {
    const lineId = requiredId(await request.formData(), "line_id");
    if (lineId === null) return fail(400, { action: "line", message: "Choose a row" });
    return runAction("line", () => {
      projects().deleteBomLine(Number(params.id), lineId);
      return { action: "line", success: "Row deleted." };
    });
  },
};
