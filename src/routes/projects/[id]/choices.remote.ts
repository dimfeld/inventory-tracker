import { invalid } from "@sveltejs/kit";
import * as z from "zod";
import { form } from "$app/server";
import { isUserError } from "#lib/server/inventory/index.ts";
import { projects } from "#lib/server/projects/index.ts";

/**
 * Approve a part for a BOM requirement from the project table, as a confirmed match (not a
 * substitute). Use one instance per line with `approvePart.for(lineId)`. A rejected approval is
 * a form issue with the service's message.
 */
export const approvePart = form(
  z.object({
    projectId: z.number().int(),
    lineId: z.number().int(),
    partId: z.number().int(),
  }),
  ({ projectId, lineId, partId }) => {
    try {
      projects().approveChoice(projectId, lineId, { partId, substitute: false, note: null });
    } catch (error) {
      if (!isUserError(error)) throw error;
      invalid(error.message);
    }
  }
);
