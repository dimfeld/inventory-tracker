import { invalid, redirect } from "@sveltejs/kit";
import * as z from "zod";
import { form } from "$app/server";
import { formId } from "#lib/schemas/form.ts";
import { inventory, isUserError } from "#lib/server/inventory/index.ts";

/** Merge a duplicate part into the part to keep, then open the part that was kept. */
export const mergePart = form(
  z.object({
    sourceId: z.number().int(),
    destinationId: formId("Choose the part to keep").pipe(
      z.number({ message: "Choose the part to keep" })
    ),
  }),
  ({ sourceId, destinationId }) => {
    try {
      inventory().catalog.mergePart(sourceId, destinationId);
    } catch (error) {
      if (!isUserError(error)) throw error;
      invalid(error.message);
    }
    redirect(303, `/parts/${destinationId}`);
  }
);
