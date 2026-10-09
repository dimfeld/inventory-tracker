import * as z from "zod";
import { parseLengthMm } from "#lib/pieces.ts";
import { formId, formText, optionalFormText } from "./form";

/** The most equal pieces one row of the add form can make. */
const MAX_COUNT = 100;

const operation = {
  /** Unique ID for this submission. A repeated ID is rejected without writing. */
  operationId: z.string().min(1),
  occurredOn: formText.pipe(z.iso.date({ message: "Enter a date" })),
};

/** One row of the add form: a size, an optional label, and how many equal pieces to make. */
const pieceRow = z.object({
  length: formText,
  width: formText,
  label: optionalFormText,
  count: formText,
});

/**
 * New pieces of a part at a storage location. Lengths are entered like length attributes (a bare
 * number is mm; `in` and `"` are inches). Empty rows are ignored.
 */
export const addPiecesSchema = z
  .object({
    ...operation,
    partId: z.number().int(),
    locationId: formId("Choose a location").pipe(z.number({ message: "Choose a location" })),
    reason: optionalFormText,
    pieces: z.array(pieceRow).optional(),
  })
  .transform((input, ctx) => {
    const pieces: { lengthMm: number; widthMm: number | null; label: string | null }[] = [];
    for (const row of input.pieces ?? []) {
      if (!row.length && !row.width && !row.label) continue;
      const lengthMm = parseLengthMm(row.length);
      const widthMm = row.width ? parseLengthMm(row.width) : null;
      const count = row.count ? Number(row.count) : 1;
      if (lengthMm === null || (row.width && widthMm === null)) {
        ctx.addIssue({
          code: "custom",
          path: ["pieces"],
          message: "Enter each size as a length, such as 1220 or 48 in",
        });
        return z.NEVER;
      }
      if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT) {
        ctx.addIssue({
          code: "custom",
          path: ["pieces"],
          message: `The count must be a whole number from 1 to ${MAX_COUNT}`,
        });
        return z.NEVER;
      }
      for (let i = 0; i < count; i += 1) pieces.push({ lengthMm, widthMm, label: row.label });
    }
    return { ...input, pieces };
  });

export const movePieceSchema = z.object({
  ...operation,
  pieceId: z.number().int(),
  toLocationId: formId("Choose a location").pipe(z.number({ message: "Choose a location" })),
  reason: optionalFormText,
});

export const removePieceSchema = z.object({
  ...operation,
  pieceId: z.number().int(),
  reason: formText.pipe(z.string().min(1, "Enter a reason")),
});
