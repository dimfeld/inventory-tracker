import type { Database } from "bun:sqlite";
import type { Money } from "#lib/money.ts";
import {
  fitsWithin,
  suggestCuts,
  takeCut,
  type PieceDisplayUnit,
  type PieceSpace,
} from "#lib/pieces.ts";
import type { Part } from "#lib/server/db/catalog.ts";
import {
  listIncomingPieceLines,
  listOrderLinePieceCommitments,
} from "#lib/server/db/piece-commitments.ts";
import type { BomLine } from "#lib/server/db/projects.ts";
import { listStoragePieces } from "#lib/server/inventory/pieces.ts";
import {
  planStockLengths,
  planStockSheets,
  type StockOption,
  type StockPlan,
} from "#lib/stock-packing.ts";
import { incomingSticks } from "./incoming-pieces";
import { listStockOptions, type StockSku } from "./stock-options";

/** One cut piece that a requirement needs, in mm. A whole piece has the stock size. */
export interface ShoppingCut {
  lineId: number;
  lineDescription: string;
  lengthMm: number;
  widthMm: number | null;
}

/** One stock piece to buy, with the cuts to make from it. */
export interface ShoppingStockPiece {
  supplier: string;
  sku: string;
  lengthMm: number;
  widthMm: number | null;
  /** Price of the piece from the latest priced purchase of the SKU, or null. */
  price: Money | null;
  cuts: ShoppingCut[];
  /** 1D: the length left after the cuts and their kerf. Null for 2D. */
  wasteMm: number | null;
}

/** The stock pieces to buy for the cut pieces that no stock or order covers. */
export interface ShoppingCutPlan {
  displayUnit: PieceDisplayUnit;
  kerfMm: number;
  pieces: ShoppingStockPiece[];
  /** Cuts that no known stock size fits, such as when the part has no SKU with a stock size. */
  unplaced: ShoppingCut[];
  /**
   * Whole pieces to buy when the part has no SKU with a stock size. They need no planning, so
   * they are not `unplaced`. Their size is 0.
   */
  unsizedWhole: ShoppingCut[];
}

/** Cut pieces of one requirement that its reservations and commitments do not cover. */
export interface PieceNeed {
  line: BomLine;
  count: number;
}

/** How a pieces item's cut pieces are covered, in pieces, and the stock to buy for the rest. */
export interface PieceShopping {
  /** Cuts that fit on free storage pieces. */
  freeStock: number;
  /** Cuts that fit on the free space of incoming stock pieces. */
  freeOrdered: number;
  plan: ShoppingCutPlan;
}

/** A piece of free stock or incoming stock that cuts can use. */
interface SupplyPiece {
  space: PieceSpace;
  widthMm: number | null;
}

/** A cut piece to cover. `whole` is a requirement without a cut size. */
interface Cut {
  line: BomLine;
  lengthMm: number;
  widthMm: number | null;
  whole: boolean;
}

const toShoppingCut = (
  cut: Cut,
  size: { lengthMm: number; widthMm: number | null } = cut
): ShoppingCut => ({
  lineId: cut.line.id,
  lineDescription: cut.line.description,
  lengthMm: size.lengthMm,
  widthMm: size.widthMm,
});

/**
 * Cover cuts with pieces of a pool, and return the cuts that do not fit. 1D cuts share pieces
 * by first-fit decreasing; a 2D cut takes the smallest unused sheet it fits; a whole piece takes
 * the longest unused piece. The pool records what the cuts use.
 */
function coverFromPool(pool: SupplyPiece[], cuts: Cut[]): Cut[] {
  const linear = pool.filter((p) => p.widthMm === null);
  const byId = new Map(linear.map((p) => [p.space.id, p.space]));
  const result = suggestCuts(
    linear.map((p) => p.space),
    cuts
      .filter((c) => !c.whole && c.widthMm === null)
      .map((c) => ({ key: c, lengthMm: c.lengthMm }))
  );
  for (const assignment of result.assignments) {
    takeCut(byId.get(assignment.pieceId)!, assignment.lengthMm);
  }
  const remaining = result.unplaced.map((u) => u.key);

  const use = (piece: SupplyPiece) => {
    piece.space.unreserved = false;
    piece.space.freeLengthMm = 0;
  };
  const area = (p: SupplyPiece) => p.space.lengthMm * (p.widthMm ?? 1);
  for (const cut of cuts.filter((c) => !c.whole && c.widthMm !== null)) {
    const size = { lengthMm: cut.lengthMm, widthMm: cut.widthMm! };
    const sheet = pool
      .filter(
        (p) =>
          p.widthMm !== null &&
          p.space.unreserved &&
          fitsWithin(size, { lengthMm: p.space.lengthMm, widthMm: p.widthMm })
      )
      .toSorted((a, b) => area(a) - area(b))[0];
    if (sheet) use(sheet);
    else remaining.push(cut);
  }
  for (const cut of cuts.filter((c) => c.whole)) {
    const piece = pool.filter((p) => p.space.unreserved).toSorted((a, b) => area(b) - area(a))[0];
    if (piece) use(piece);
    else remaining.push(cut);
  }
  return remaining;
}

/** The stock to buy for one whole piece: the cheapest SKU when all prices are known, else the largest. */
function wholePieceOption(options: StockOption<StockSku>[]): StockOption<StockSku> | null {
  const byPrice = options.length > 0 && options.every((o) => o.price !== null);
  const area = (o: StockOption<StockSku>) => o.lengthMm * (o.widthMm ?? 1);
  return (
    options.toSorted((a, b) => (byPrice ? a.price! - b.price! : 0) || area(b) - area(a))[0] ?? null
  );
}

/**
 * Free storage pieces and free space on incoming stock pieces for shopping, shared by the items
 * of one shopping list so that each piece counts once.
 */
export function createPieceSupply(db: Database) {
  const storage = new Map<number, SupplyPiece[]>();
  const incoming = new Map<number, SupplyPiece[]>();
  let nextIncomingId = 1;

  function storagePool(partId: number): SupplyPiece[] {
    let pool = storage.get(partId);
    if (!pool) {
      pool = listStoragePieces(db, [partId]).map((piece) => ({
        space: {
          id: piece.id,
          lengthMm: piece.lengthMm,
          freeLengthMm: piece.freeLengthMm,
          unreserved: piece.reservations.length === 0,
          kerfMm: piece.kerfMm,
        },
        widthMm: piece.widthMm,
      }));
      storage.set(partId, pool);
    }
    return pool;
  }

  function incomingPool(partId: number): SupplyPiece[] {
    let pool = incoming.get(partId);
    if (!pool) {
      const lines = listIncomingPieceLines(db, [partId]);
      const commitments = listOrderLinePieceCommitments(
        db,
        lines.map((l) => l.orderLineId)
      );
      pool = lines.flatMap((line) =>
        incomingSticks(line, commitments).map((space) => ({
          space: { ...space, id: nextIncomingId++ },
          widthMm: line.stockWidthMm,
        }))
      );
      incoming.set(partId, pool);
    }
    return pool;
  }

  return {
    /**
     * Cover the cut pieces of `needs` with free storage pieces of `partIds` first, then with
     * free space on their incoming stock pieces, and plan the stock pieces of `part` to buy
     * for the rest.
     */
    cover(part: Part, partIds: number[], needs: PieceNeed[]): PieceShopping {
      const cuts = needs.flatMap(({ line, count }) =>
        Array.from({ length: count }, () => ({
          line,
          lengthMm: line.cutLengthMm ?? 0,
          widthMm: line.cutWidthMm,
          whole: line.cutLengthMm === null,
        }))
      );
      const afterStock = coverFromPool(partIds.flatMap(storagePool), cuts);
      const afterOrders = coverFromPool(partIds.flatMap(incomingPool), afterStock);

      const options = listStockOptions(db, part.id);
      const plan: ShoppingCutPlan = {
        displayUnit: part.pieceDisplayUnit,
        kerfMm: part.kerfMm,
        pieces: [],
        unplaced: [],
        unsizedWhole: [],
      };
      const addPieces = (planned: StockPlan<StockSku, Cut>) => {
        for (const piece of planned.pieces) {
          plan.pieces.push({
            supplier: piece.option.stock.supplier,
            sku: piece.option.stock.sku,
            lengthMm: piece.option.lengthMm,
            widthMm: piece.option.widthMm,
            price: piece.option.stock.price,
            cuts: piece.cuts.map((c) => toShoppingCut(c.key)),
            wasteMm: piece.wasteMm,
          });
        }
        plan.unplaced.push(...planned.unplaced.map((c) => toShoppingCut(c.key)));
      };

      const linear = afterOrders.filter((c) => !c.whole && c.widthMm === null);
      addPieces(
        planStockLengths(
          options,
          part.kerfMm,
          linear.map((cut) => ({ key: cut, lengthMm: cut.lengthMm }))
        )
      );

      const sheets = Map.groupBy(
        afterOrders.filter((c) => !c.whole && c.widthMm !== null),
        (c) => c.line
      );
      addPieces(
        planStockSheets(
          options,
          [...sheets].map(([line, lineCuts]) => ({
            key: lineCuts[0],
            lengthMm: line.cutLengthMm!,
            widthMm: line.cutWidthMm!,
            count: lineCuts.length,
            perSheet: line.cutsPerSheet ?? 1,
          }))
        )
      );

      const whole = wholePieceOption(options);
      for (const cut of afterOrders.filter((c) => c.whole)) {
        if (!whole) {
          plan.unsizedWhole.push(toShoppingCut(cut));
          continue;
        }
        const size = { lengthMm: whole.lengthMm, widthMm: whole.widthMm };
        plan.pieces.push({
          supplier: whole.stock.supplier,
          sku: whole.stock.sku,
          ...size,
          price: whole.stock.price,
          cuts: [toShoppingCut(cut, size)],
          wasteMm: whole.widthMm === null ? 0 : null,
        });
      }

      return {
        freeStock: cuts.length - afterStock.length,
        freeOrdered: afterStock.length - afterOrders.length,
        plan,
      };
    },
  };
}
