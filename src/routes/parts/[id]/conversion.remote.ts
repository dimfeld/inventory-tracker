import { error, invalid, redirect } from "@sveltejs/kit";
import * as z from "zod";
import { command, form, query } from "$app/server";
import { formText, optionalFormText } from "#lib/schemas/form.ts";
import { parseLengthMm } from "#lib/pieces.ts";
import { inventory, isUserError } from "#lib/server/inventory/index.ts";

const id = z.number().int();

const conversionSchema = z.object({
  destinationId: id,
  sourceIds: z.array(id),
  lengthKey: z.string(),
  widthKey: z.string().nullable(),
});

/**
 * What converting the parts to one pieces part would do, and what blocks it. A rejected
 * request (such as a part that no longer exists) is returned as a message.
 */
export const conversionPreview = query(conversionSchema, (input) => {
  try {
    return { ok: true as const, preview: inventory().conversion.previewConversion(input) };
  } catch (e) {
    if (!isUserError(e)) throw e;
    return { ok: false as const, message: e.message };
  }
});

/** Set one attribute value on several parts, so they are equal before a conversion. */
export const setAttributeForParts = command(
  z.object({ partIds: z.array(id), key: z.string(), value: z.string() }),
  ({ partIds, key, value }) => {
    try {
      inventory().taxonomy.setPartsValue(partIds, key, value);
    } catch (e) {
      if (!isUserError(e)) throw e;
      error(400, e.message);
    }
  }
);

/** A length in mm from a form field (mm or inches); empty is zero. */
const formLength = (label: string) =>
  formText.transform((value, ctx) => {
    if (value === "") return 0;
    const mm = parseLengthMm(value);
    if (mm !== null) return mm;
    ctx.addIssue({
      code: "custom",
      message: `Enter the ${label} as a length, such as 2 or 0.1 in`,
    });
    return z.NEVER;
  });

/** Convert the parts, then open the converted part. */
export const convertParts = form(
  z.object({
    operationId: z.string().min(1),
    occurredOn: formText.pipe(z.iso.date({ message: "Enter a date" })),
    destinationId: id,
    sourceIds: z.array(id).optional(),
    lengthKey: formText.pipe(z.string().min(1, "Choose the length attribute")),
    widthKey: optionalFormText,
    kerf: formLength("kerf"),
    minOffcut: formLength("minimum offcut"),
    name: optionalFormText,
  }),
  ({ kerf, minOffcut, sourceIds, ...input }) => {
    try {
      inventory().conversion.convertToPieces({
        ...input,
        sourceIds: sourceIds ?? [],
        kerfMm: kerf,
        minOffcutMm: minOffcut,
      });
    } catch (e) {
      if (!isUserError(e)) throw e;
      invalid(e.message);
    }
    redirect(303, `/parts/${input.destinationId}`);
  }
);
