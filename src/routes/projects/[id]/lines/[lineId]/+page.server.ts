import { error, fail } from "@sveltejs/kit";
import { parseAssignForm, parseReleaseForm } from "#lib/schemas/commitment.ts";
import { parseId, text } from "#lib/schemas/result.ts";
import { parseChoiceForm } from "#lib/schemas/project.ts";
import { today } from "#lib/schemas/stock.ts";
import { runAction } from "#lib/server/forms.ts";
import { inventory } from "#lib/server/inventory/index.ts";
import { allocationAction } from "#lib/server/projects/allocation-actions.ts";
import {
  allocations,
  commitments,
  pieceAllocations,
  projects,
} from "#lib/server/projects/index.ts";
import { SOURCE_LABELS } from "#lib/server/projects/matching.ts";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = ({ params }) => {
  const projectId = Number(params.id);
  const lineId = Number(params.lineId);
  const details = projects().getProjectDetails(projectId);
  const line = projects().getLine(projectId, lineId);
  if (!details || !line) error(404, "BOM row not found");
  const { requirement, candidates } = projects().findCandidates(projectId, lineId);
  // Rows in the order the project page shows them, for previous and next links.
  const order = details.sections.flatMap((section) => section.lines.map((l) => l.id));
  const position = order.indexOf(lineId);
  return {
    project: details.project,
    position: { index: position, count: order.length },
    previousLineId: order[position - 1] ?? null,
    nextLineId: order[position + 1] ?? null,
    component: details.components.find((c) => c.id === line.componentId) ?? null,
    line,
    missingRequired: requirement.missingRequired,
    candidates: candidates.map((c) => ({ ...c, sourceLabel: SOURCE_LABELS[c.source] })),
    parts: projects().bomFormOptions().parts,
    stock: allocations().getLineStock(projectId, lineId),
    pickedPieces: pieceAllocations().listPickedPieces(projectId, lineId),
    suggestion: pieceAllocations().suggestPieces(projectId, lineId),
    incoming: commitments().listIncomingOptions(projectId, lineId),
    storageLocations: inventory().locations.listStorageLocations(),
    today: today(),
    // One ID per page load; a repeated submission of the same form is rejected.
    operationId: crypto.randomUUID(),
  };
};

export const actions: Actions = {
  reserve: allocationAction("reserve"),
  release: allocationAction("release"),
  pick: allocationAction("pick"),
  use: allocationAction("use"),
  return: allocationAction("return"),

  assignIncoming: async ({ request, params }) => {
    const parsed = parseAssignForm(await request.formData());
    if (!parsed.success) return fail(400, { action: "incoming", errors: parsed.errors });
    return runAction("incoming", () => {
      commitments().assign({
        ...parsed.data,
        projectId: Number(params.id),
        lineId: Number(params.lineId),
      });
      return { action: "incoming", success: "Incoming supply committed to this row." };
    });
  },

  releaseIncoming: async ({ request, params }) => {
    const parsed = parseReleaseForm(await request.formData());
    if (!parsed.success) return fail(400, { action: "incoming", errors: parsed.errors });
    return runAction("incoming", () => {
      commitments().release({
        ...parsed.data,
        projectId: Number(params.id),
        lineId: Number(params.lineId),
      });
      return { action: "incoming", success: "Commitment released." };
    });
  },

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
