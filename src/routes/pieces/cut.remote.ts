import { invalid } from "@sveltejs/kit";
import { form } from "$app/server";
import { cutPieceSchema, retirePieceSchema, splitPieceSchema } from "#lib/schemas/pieces.ts";
import { inventory, isUserError } from "#lib/server/inventory/index.ts";

/** Run a service call. A rejected request becomes a form issue with the service's message. */
function attempt<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (!isUserError(error)) throw error;
    invalid(error.message);
  }
}

/** Cut a 1D piece to lengths. The remainder is calculated. */
export const cutPiece = form(cutPieceSchema, (input) => {
  if (input.cuts.length === 0) invalid("Enter at least one cut length");
  const result = attempt(() => inventory().pieces.cutPiece(input));
  return { text: `Cut into ${result.pieces.length} piece(s).`, warnings: result.warnings };
});

/** Split a 2D piece into the measured pieces. */
export const splitPiece = form(splitPieceSchema, (input) => {
  if (input.outputs.length === 0) invalid("Enter the size of at least one piece");
  const result = attempt(() => inventory().pieces.splitPiece(input));
  return { text: `Split into ${result.pieces.length} piece(s).`, warnings: result.warnings };
});

/** Scrap a whole piece, or use it outside a project. */
export const retirePiece = form(retirePieceSchema, (input) => {
  attempt(() => inventory().pieces.removePiece(input));
  return { text: input.kind === "scrap" ? "Piece scrapped." : "Piece used.", warnings: [] };
});
