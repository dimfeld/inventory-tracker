import { invalid } from "@sveltejs/kit";
import { form } from "$app/server";
import { lineFormSchema } from "#lib/schemas/import.ts";
import { classifier, extractor, imports } from "#lib/server/imports/index.ts";
import { isUserError } from "#lib/server/inventory/index.ts";

/**
 * The review form of one import line: save it, remove it, save it as a new part copied from an
 * existing part, or save it and let the model clean
 * up its name, category, and attributes and match it to a catalog part, or split it into the
 * different items it holds. Use one instance per
 * line with `editLine.for(lineId)`; each instance submits on its own, so several lines can be
 * cleaned up at once. A rejected change is a form issue with the service's message.
 */
export const editLine = form(
  lineFormSchema,
  async ({ lineId, importId, intent, splitNotes, copyFrom, edit }) => {
    try {
      if (intent === "remove") {
        imports().removeLine(importId, lineId);
        return { text: "Line removed." };
      }
      imports().updateLine(importId, lineId, edit);
      if (copyFrom !== null) {
        const name = imports().copyPartToLine(importId, lineId, copyFrom);
        return { text: `Copied from ${name}. Change the attributes that are different.` };
      }
      if (intent === "save") return { text: "Line saved." };

      if (intent === "split") {
        const outcome = await imports().splitLine(importId, lineId, extractor(), splitNotes);
        if (!outcome.ok) invalid(outcome.error);
        return { text: `Split into ${outcome.lineCount} lines. Check each line.` };
      }

      const jev = classifier();
      const outcome = await imports().cleanupLine(importId, lineId, extractor(), jev);
      if (!outcome.ok) invalid(outcome.error);
      return {
        text: outcome.matchedPart
          ? `Cleaned up and matched to ${outcome.matchedPart.name}. Check the line.`
          : jev
            ? "Cleaned up. No catalog part is the same item. Check the line."
            : "Cleaned up. Set TYPESAFE_API_KEY to match catalog parts. Check the line.",
      };
    } catch (error) {
      if (!isUserError(error)) throw error;
      invalid(error.message);
    }
  }
);
