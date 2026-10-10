import { fitsWithin, freeLengthMm, suggestCuts, type PieceSpace } from "#lib/pieces.ts";
import type { IncomingPieceLine, PieceCommitmentDetail } from "#lib/server/db/piece-commitments.ts";
import type { BomLine } from "#lib/server/db/projects.ts";

/** The size of a cut piece in mm. Width is null for 1D pieces. */
export interface CutSize {
  lengthMm: number;
  widthMm: number | null;
}

/**
 * The incoming stock pieces of an order line, one per outstanding unit, as piece spaces with
 * the length that the commitments leave free. `id` is the stick index. A 2D piece with a
 * commitment has nothing free. Empty when the order line has no stock size.
 */
export function incomingSticks(
  line: IncomingPieceLine,
  commitments: PieceCommitmentDetail[]
): PieceSpace[] {
  if (line.stockLengthMm === null) return [];
  const stock = { lengthMm: line.stockLengthMm };
  const byStick = Map.groupBy(
    commitments.filter((c) => c.orderLineId === line.orderLineId),
    (c) => c.stickIndex
  );
  return Array.from({ length: line.outstanding }, (_, index) => {
    const lengths = (byStick.get(index) ?? []).map((c) => c.lengthMm);
    const free =
      line.stockWidthMm === null
        ? freeLengthMm(stock, line.kerfMm, lengths)
        : lengths.length > 0
          ? 0
          : stock.lengthMm;
    return {
      id: index,
      lengthMm: stock.lengthMm,
      freeLengthMm: free,
      unreserved: lengths.length === 0,
      kerfMm: line.kerfMm,
    };
  });
}

/**
 * The size of each cut piece that a BOM line takes from an incoming stock piece: its cut size,
 * or the whole stock piece for a line without one. Null when the order line has no stock size,
 * or when its stock pieces and the cut do not have the same dimensions.
 */
export function incomingCutSize(bomLine: BomLine, line: IncomingPieceLine): CutSize | null {
  if (line.stockLengthMm === null) return null;
  if (bomLine.cutLengthMm === null) {
    return { lengthMm: line.stockLengthMm, widthMm: line.stockWidthMm };
  }
  if ((bomLine.cutWidthMm === null) !== (line.stockWidthMm === null)) return null;
  return { lengthMm: bomLine.cutLengthMm, widthMm: bomLine.cutWidthMm };
}

/**
 * The stick index for each of `count` cut pieces of `size` on the order line's incoming stock
 * pieces, as far as they fit. 1D cuts share sticks by first-fit decreasing, with the same kerf
 * rule as piece reservations. A 2D cut takes an incoming sheet with no commitment that it fits.
 */
export function placeIncomingCuts(
  line: IncomingPieceLine,
  commitments: PieceCommitmentDetail[],
  size: CutSize,
  count: number
): number[] {
  const sticks = incomingSticks(line, commitments);
  if (size.widthMm === null) {
    const cuts = Array.from({ length: count }, (_, key) => ({ key, lengthMm: size.lengthMm }));
    return suggestCuts(sticks, cuts).assignments.map((a) => a.pieceId);
  }
  const sheet = { lengthMm: line.stockLengthMm!, widthMm: line.stockWidthMm! };
  if (!fitsWithin({ lengthMm: size.lengthMm, widthMm: size.widthMm }, sheet)) return [];
  return sticks
    .filter((stick) => stick.unreserved)
    .slice(0, count)
    .map((stick) => stick.id);
}
