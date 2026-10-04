import { error, fail } from "@sveltejs/kit";
import { parseId, text } from "#lib/schemas/result.ts";
import { parseChoiceForm } from "#lib/schemas/project.ts";
import { runAction } from "#lib/server/forms.ts";
import { projects } from "#lib/server/projects/index.ts";
import { SOURCE_LABELS } from "#lib/server/projects/matching.ts";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = ({ params }) => {
  const projectId = Number(params.id);
  const lineId = Number(params.lineId);
  const details = projects().getProjectDetails(projectId);
  const line = projects().getLine(projectId, lineId);
  if (!details || !line) error(404, "BOM row not found");
  const { requirement, candidates } = projects().findCandidates(projectId, lineId);
  return {
    project: details.project,
    component: details.components.find((c) => c.id === line.componentId) ?? null,
    line,
    missingRequired: requirement.missingRequired,
    candidates: candidates.map((c) => ({ ...c, sourceLabel: SOURCE_LABELS[c.source] })),
    parts: projects().bomFormOptions().parts,
  };
};

export const actions: Actions = {
  approve: async ({ request, params }) => {
    const parsed = parseChoiceForm(await request.formData());
    if (!parsed.success) return fail(400, { action: "approve", errors: parsed.errors });
    return runAction("approve", () => {
      projects().approveChoice(Number(params.id), Number(params.lineId), parsed.data);
      return { action: "approve", success: "Part approved. No stock was reserved." };
    });
  },

  removeChoice: async ({ request, params }) => {
    const choiceId = parseId(text(await request.formData(), "choice_id"));
    if (choiceId === null || Number.isNaN(choiceId)) {
      return fail(400, { action: "approve", message: "Choose an approval" });
    }
    return runAction("approve", () => {
      projects().removeChoice(Number(params.id), Number(params.lineId), choiceId);
      return { action: "approve", success: "Approval removed." };
    });
  },
};
