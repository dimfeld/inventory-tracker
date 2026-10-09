import { invalid } from "@sveltejs/kit";
import { form } from "$app/server";
import { addPiecesSchema, movePieceSchema, removePieceSchema } from "#lib/schemas/pieces.ts";
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

/** Add existing pieces of a part tracked as pieces to a storage location. */
export const addPieces = form(addPiecesSchema, (input) => {
  if (input.pieces.length === 0) invalid("Enter the size of at least one piece");
  const made = attempt(() => inventory().pieces.addPieces(input));
  return { text: `Added ${made.length} piece(s).` };
});

/** Move one piece to another storage location. */
export const movePiece = form(movePieceSchema, (input) => {
  attempt(() => inventory().pieces.movePiece(input));
  return { text: "Piece moved." };
});

/** Remove one lost, damaged, or discarded piece from inventory. */
export const removePiece = form(removePieceSchema, (input) => {
  attempt(() => inventory().pieces.removePiece(input));
  return { text: "Piece removed." };
});
