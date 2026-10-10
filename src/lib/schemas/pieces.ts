import * as z from "zod";
import { parseLengthMm, parsePieceLength, PIECE_DISPLAY_UNITS } from "#lib/pieces.ts";
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

/** A whole piece out of inventory: scrapped, or used outside a project. */
export const retirePieceSchema = z.object({
  ...operation,
  pieceId: z.number().int(),
  kind: z.enum(["scrap", "use"]),
  reason: formText.pipe(z.string().min(1, "Enter a reason")),
});

/**
 * Where an output of a cut goes: `scrap`, `use` (outside a project), or the ID of a storage
 * location to keep it in.
 */
const destination = formText.transform((value, ctx) => {
  if (value === "scrap") return { kind: "scrap" as const };
  if (value === "use") return { kind: "use" as const };
  if (/^\d+$/.test(value)) return { kind: "keep" as const, locationId: Number(value) };
  ctx.addIssue({ code: "custom", message: "Choose where each piece goes" });
  return z.NEVER;
});

const cutBase = {
  ...operation,
  pieceId: z.number().int(),
  /** The part's display unit. A bare number in a size is in this unit. */
  unit: z.enum(PIECE_DISPLAY_UNITS),
  reason: optionalFormText,
};

/** A length in mm from a form field in the display unit, or an issue. */
function lengthField(
  raw: string,
  unit: (typeof PIECE_DISPLAY_UNITS)[number],
  ctx: z.RefinementCtx
) {
  const mm = parsePieceLength(raw, unit);
  if (mm === null || mm <= 0) {
    ctx.addIssue({
      code: "custom",
      message: `Enter each size as a length, such as 300 or 12 ${unit === "mm" ? "in" : "mm"}`,
    });
    return null;
  }
  return mm;
}

/** A 1D cut: the cut lengths, each with a destination, and the remainder's destination. */
export const cutPieceSchema = z
  .object({
    ...cutBase,
    cuts: z.array(z.object({ length: formText, label: optionalFormText, destination })).optional(),
    remainderDestination: destination,
    remainderLabel: optionalFormText,
  })
  .transform((input, ctx) => {
    const cuts = [];
    for (const row of input.cuts ?? []) {
      if (!row.length) continue;
      const lengthMm = lengthField(row.length, input.unit, ctx);
      if (lengthMm === null) return z.NEVER;
      cuts.push({ lengthMm, label: row.label, destination: row.destination });
    }
    return {
      ...input,
      cuts,
      remainder: { destination: input.remainderDestination, label: input.remainderLabel },
    };
  });

/** A 2D split: the used piece and the leftover pieces, each with a destination. */
export const splitPieceSchema = z
  .object({
    ...cutBase,
    outputs: z
      .array(z.object({ length: formText, width: formText, label: optionalFormText, destination }))
      .optional(),
  })
  .transform((input, ctx) => {
    const outputs = [];
    for (const row of input.outputs ?? []) {
      if (!row.length && !row.width) continue;
      const lengthMm = lengthField(row.length, input.unit, ctx);
      const widthMm = lengthField(row.width, input.unit, ctx);
      if (lengthMm === null || widthMm === null) return z.NEVER;
      outputs.push({ lengthMm, widthMm, label: row.label, destination: row.destination });
    }
    return { ...input, outputs };
  });
