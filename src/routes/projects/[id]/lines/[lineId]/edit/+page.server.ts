import { error, fail, redirect } from "@sveltejs/kit";
import { parseBomLineForm } from "#lib/schemas/project.ts";
import { runAction } from "#lib/server/forms.ts";
import { projects } from "#lib/server/projects/index.ts";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = ({ params }) => {
  const projectId = Number(params.id);
  const details = projects().getProjectDetails(projectId);
  const line = projects().getLine(projectId, Number(params.lineId));
  if (!details || !line) error(404, "BOM row not found");
  const options = { ...projects().bomFormOptions(), components: details.components };
  // Keep an archived exact part selectable on its existing row.
  if (line.partId !== null && !options.parts.some((p) => p.id === line.partId)) {
    options.parts.push({
      id: line.partId,
      name: `${line.partName} (archived)`,
      baseUnit: line.unit,
      partNumber: null,
    });
  }
  return {
    project: details.project,
    line,
    options,
    initial: {
      description: line.description,
      amount: String(line.quantity),
      unit: line.unit,
      componentId: line.componentId,
      referenceDesignators: line.referenceDesignators,
      notes: line.notes,
      partId: line.partId,
      categoryId: line.categoryId,
      manufacturer: line.manufacturer,
      partNumber: line.partNumber,
      constraints: line.constraints.map((c) => ({
        key: c.key,
        comparison: c.comparison,
        value: c.rawValue,
        maxValue: c.rawMaxValue,
      })),
    },
  };
};

export const actions: Actions = {
  default: async ({ request, params }) => {
    const projectId = Number(params.id);
    const lineId = Number(params.lineId);
    const parsed = parseBomLineForm(await request.formData());
    if (!parsed.success) return fail(400, { errors: parsed.errors });
    const failure = runAction("update", () =>
      projects().updateBomLine(projectId, lineId, parsed.data)
    );
    if (failure) return failure;
    redirect(303, `/projects/${projectId}/lines/${lineId}`);
  },
};
