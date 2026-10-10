import { invalid } from "@sveltejs/kit";
import * as z from "zod";
import { form } from "$app/server";
import { parsePieceLength, PIECE_DISPLAY_UNITS } from "#lib/pieces.ts";
import { formId, formText, optionalFormText } from "#lib/schemas/form.ts";
import { operation } from "#lib/schemas/pieces.ts";
import { isUserError } from "#lib/server/inventory/index.ts";
import { pieceAllocations } from "#lib/server/projects/index.ts";

/** Run a service call. A rejected request becomes a form issue with the service's message. */
function attempt<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (!isUserError(error)) throw error;
    invalid(error.message);
  }
}

const id = z.number().int();

/** The part's display unit. A bare number in a size is in this unit. */
const unit = z.enum(PIECE_DISPLAY_UNITS);

/**
 * A cut size from optional length and width fields in `unit`. Null when the length is empty, so
 * the service uses its default size. Adds an issue for a value that is not a length.
 */
function sizeOf(
  input: { length: string; width: string; unit: (typeof PIECE_DISPLAY_UNITS)[number] },
  ctx: z.RefinementCtx
): { lengthMm: number; widthMm: number | null } | null | typeof z.NEVER {
  if (!input.length) return null;
  const lengthMm = parsePieceLength(input.length, input.unit);
  const widthMm = input.width ? parsePieceLength(input.width, input.unit) : null;
  if (lengthMm === null || lengthMm <= 0 || (input.width && (widthMm === null || widthMm <= 0))) {
    ctx.addIssue({ code: "custom", message: "Enter the size as a length, such as 415 or 16 in" });
    return z.NEVER;
  }
  return { lengthMm, widthMm };
}

const warningsText = (text: string, warnings: string[]) => ({ text, warnings });

/**
 * Pick piece reservations, in order. `reservationIds` is a comma-separated list. A form for a
 * 2D reservation smaller than its piece sets `measured` and sends the leftover sizes, in the
 * part's display unit; empty rows are ignored, so no rows keep no leftovers. Use one instance
 * per reservation or piece.
 */
export const pickPieces = form(
  z
    .object({
      ...operation,
      projectId: id,
      reservationIds: formText,
      unit: z.enum(PIECE_DISPLAY_UNITS),
      measured: formText,
      leftovers: z.array(z.object({ length: formText, width: formText })).optional(),
    })
    .transform((input, ctx) => {
      const reservationIds = input.reservationIds.split(",").map(Number);
      if (reservationIds.some((value) => !Number.isInteger(value) || value <= 0)) {
        ctx.addIssue({ code: "custom", message: "Choose a reservation to pick" });
        return z.NEVER;
      }
      let leftovers: { lengthMm: number; widthMm: number }[] | undefined;
      if (input.measured) {
        leftovers = [];
        for (const row of input.leftovers ?? []) {
          if (!row.length && !row.width) continue;
          const lengthMm = parsePieceLength(row.length, input.unit);
          const widthMm = parsePieceLength(row.width, input.unit);
          if (lengthMm === null || widthMm === null || lengthMm <= 0 || widthMm <= 0) {
            ctx.addIssue({ code: "custom", message: "Enter each leftover as length × width" });
            return z.NEVER;
          }
          leftovers.push({ lengthMm, widthMm });
        }
      }
      return {
        projectId: input.projectId,
        operationId: input.operationId,
        occurredOn: input.occurredOn,
        picks: reservationIds.map((reservationId) => ({ reservationId, leftovers })),
      };
    }),
  (input) => {
    const result = attempt(() => pieceAllocations().pickPieces(input));
    return {
      text: `Picked ${result.pieceIds.length} piece(s) to the project's holding location.`,
      warnings: result.warnings,
    };
  }
);

/** Release one piece reservation. Use one instance per reservation. */
export const releasePieceReservation = form(
  z.object({ projectId: id, reservationId: id }),
  (input) => {
    attempt(() => pieceAllocations().releasePieceReservation(input));
    return { text: "Reservation released." };
  }
);

/** Record use of a picked piece for its line. Use one instance per piece. */
export const usePiece = form(
  z.object({ ...operation, projectId: id, lineId: id, pieceId: id, reason: optionalFormText }),
  (input) => {
    attempt(() => pieceAllocations().usePiece(input));
    return { text: "Use recorded." };
  }
);

/** Return a picked piece to storage. Use one instance per piece. */
export const returnPiece = form(
  z.object({
    ...operation,
    projectId: id,
    lineId: id,
    pieceId: id,
    toLocationId: formId("Choose a location").pipe(z.number({ message: "Choose a location" })),
    reserveAgain: z.boolean().optional(),
  }),
  ({ reserveAgain, ...input }) => {
    attempt(() =>
      pieceAllocations().returnPiece({ ...input, reserveAgain: reserveAgain ?? false })
    );
    return { text: "Returned to storage." };
  }
);

/**
 * Reserve the suggested cuts for a line, all or none. `cuts` is the suggestion as JSON: a list
 * of piece IDs and sizes in mm.
 */
export const acceptSuggestion = form(
  z.object({
    projectId: id,
    lineId: id,
    cuts: formText.transform((value, ctx) => {
      const parsed = z
        .array(
          z.object({
            pieceId: id,
            lengthMm: z.number().positive(),
            widthMm: z.number().positive().nullable(),
          })
        )
        .safeParse(JSON.parse(value || "[]"));
      if (!parsed.success) {
        ctx.addIssue({ code: "custom", message: "The suggestion is not valid. Reload the page." });
        return z.NEVER;
      }
      return parsed.data;
    }),
  }),
  ({ projectId, lineId, cuts }) => {
    const result = attempt(() =>
      pieceAllocations().reservePieces({
        projectId,
        lineId,
        pieces: cuts.map(({ pieceId, ...size }) => ({ pieceId, size })),
      })
    );
    return warningsText(`Reserved ${result.reservationIds.length} cut piece(s).`, result.warnings);
  }
);

/**
 * Reserve one cut piece of a chosen piece for a line. An empty length reserves the line's cut
 * size, or the whole piece. `confirmFit` confirms that a 2D size fits in the piece. Use one
 * instance per piece.
 */
export const reservePiece = form(
  z
    .object({
      projectId: id,
      lineId: id,
      pieceId: id,
      unit,
      length: formText,
      width: formText,
      confirmFit: z.boolean().optional(),
    })
    .transform((input, ctx) => {
      const size = sizeOf(input, ctx);
      return { ...input, size };
    }),
  ({ projectId, lineId, pieceId, size, confirmFit }) => {
    const result = attempt(() =>
      pieceAllocations().reservePieces({
        projectId,
        lineId,
        pieces: [{ pieceId, size, confirmFit: confirmFit ?? false }],
      })
    );
    return warningsText("Reserved.", result.warnings);
  }
);

/** Change the size of a reservation. Use one instance per reservation. */
export const resizePieceReservation = form(
  z
    .object({
      projectId: id,
      reservationId: id,
      unit,
      length: formText,
      width: formText,
      confirmFit: z.boolean().optional(),
    })
    .transform((input, ctx) => {
      const size = sizeOf(input, ctx);
      if (size === null) {
        ctx.addIssue({ code: "custom", message: "Enter the new length" });
        return z.NEVER;
      }
      return { ...input, size };
    }),
  ({ projectId, reservationId, size, confirmFit }) => {
    const result = attempt(() =>
      pieceAllocations().resizePieceReservation({
        projectId,
        reservationId,
        size,
        confirmFit: confirmFit ?? false,
      })
    );
    return warningsText("Reserved size changed.", result.warnings);
  }
);
