import { error, fail, redirect } from "@sveltejs/kit";
import { parseCsvSettingsForm, parseHeaderForm, parseSourceForm } from "#lib/schemas/import.ts";
import { parseId, text } from "#lib/schemas/result.ts";
import { runAction } from "#lib/server/forms.ts";
import { extractor, imports, parsingAvailable } from "#lib/server/imports/index.ts";
import { isUserError } from "#lib/server/inventory/index.ts";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = ({ params }) => {
  const review = imports().getReview(Number(params.id));
  if (!review) error(404, "Import not found");
  return {
    ...review,
    options: imports().reviewOptions(),
    parsingAvailable: parsingAvailable(),
    // A new ID per page view; a repeated submission of this page's commit reuses it.
    operationId: crypto.randomUUID(),
  };
};

/** The ID field `name` of a form. Returns null when it is missing or invalid. */
function idField(form: FormData, name: string): number | null {
  const id = parseId(text(form, name));
  return id === null || Number.isNaN(id) ? null : id;
}

export const actions: Actions = {
  source: async ({ request, params }) => {
    const parsed = parseSourceForm(await request.formData());
    if (!parsed.success) return fail(400, { action: "source", errors: parsed.errors });
    return runAction("source", () => {
      imports().updateSource(Number(params.id), parsed.data);
      return { action: "source", success: "Source saved. Parse again to replace the lines." };
    });
  },

  columns: async ({ request, params }) => {
    const parsed = parseCsvSettingsForm(await request.formData());
    if (!parsed.success) return fail(400, { action: "columns", errors: parsed.errors });
    return runAction("columns", () => {
      imports().setCsvSettings(Number(params.id), parsed.data);
      return { action: "columns", success: "Columns saved." };
    });
  },

  mapColumns: async ({ request, params }) => {
    const parsed = parseCsvSettingsForm(await request.formData());
    if (!parsed.success) return fail(400, { action: "columns", errors: parsed.errors });
    return runAction("columns", () => {
      const id = Number(params.id);
      imports().setCsvSettings(id, parsed.data);
      const count = imports().linesFromColumns(id);
      return { action: "columns", success: `Created ${count} line(s) from the columns.` };
    });
  },

  parse: async ({ params }) => {
    let outcome;
    try {
      outcome = await imports().parse(Number(params.id), extractor());
    } catch (error) {
      if (!isUserError(error)) throw error;
      return fail(400, { action: "parse", message: error.message });
    }
    return outcome.ok
      ? { action: "parse", success: `Parsed ${outcome.lineCount} line(s). Review them below.` }
      : fail(400, { action: "parse", message: outcome.error });
  },

  header: async ({ request, params }) => {
    const parsed = parseHeaderForm(await request.formData());
    if (!parsed.success) return fail(400, { action: "header", errors: parsed.errors });
    return runAction("header", () => {
      imports().updateHeader(Number(params.id), parsed.data);
      return { action: "header", success: "Saved." };
    });
  },

  addLine: async ({ params }) =>
    runAction("addLine", () => {
      imports().addLine(Number(params.id));
      return { action: "addLine", success: "Line added. Fill it in below." };
    }),

  addGroup: async ({ request, params }) => {
    const name = text(await request.formData(), "name");
    if (!name) return fail(400, { action: "groups", message: "Enter a group name" });
    return runAction("groups", () => {
      imports().addGroup(Number(params.id), name);
      return { action: "groups", success: `Added group "${name}".` };
    });
  },

  renameGroup: async ({ request, params }) => {
    const form = await request.formData();
    const groupId = idField(form, "group_id");
    const name = text(form, "name");
    if (groupId === null || !name)
      return fail(400, { action: "groups", message: "Enter a group name" });
    return runAction("groups", () => {
      imports().renameGroup(Number(params.id), groupId, name);
      return { action: "groups", success: "Group renamed." };
    });
  },

  removeGroup: async ({ request, params }) => {
    const groupId = idField(await request.formData(), "group_id");
    if (groupId === null) return fail(400, { action: "groups", message: "Missing group" });
    return runAction("groups", () => {
      imports().removeGroup(Number(params.id), groupId);
      return { action: "groups", success: "Group removed. Its lines are ungrouped." };
    });
  },

  commit: async ({ request, params }) => {
    const operationId = text(await request.formData(), "operation_id");
    if (!operationId)
      return fail(400, { action: "commit", message: "Missing operation ID; reload the page" });
    const result = runAction("commit", () => imports().commit(Number(params.id), operationId));
    if (!("repeated" in result)) return result;
    redirect(
      303,
      result.orderId !== null
        ? `/orders/${result.orderId}`
        : result.projectId !== null
          ? `/projects/${result.projectId}`
          : "/imports"
    );
  },

  discard: async ({ params }) => {
    const result = runAction("discard", () => {
      imports().discard(Number(params.id));
      return { action: "discard" };
    });
    if (!("action" in result)) return result;
    redirect(303, "/imports");
  },
};
