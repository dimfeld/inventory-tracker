import { cutsFit, fitsWithin, freeLengthMm, type CutRequest } from "./pieces";

/**
 * Plans of the stock pieces to buy for cut pieces. 1D cuts are packed into stock lengths with
 * the part's kerf, by first-fit decreasing. 2D cuts get one stock sheet each, or a number of
 * cuts per sheet that the user gives, because the app does not calculate 2D layouts.
 */

/** A stock size that can be bought, such as the supplier SKU of a 1000 mm stick. */
export interface StockOption<S> {
  stock: S;
  lengthMm: number;
  /** Null for 1D stock. */
  widthMm: number | null;
  /** Price of one stock piece, or null when it is not known. It is only compared. */
  price: number | null;
}

/** One stock piece to buy, with the cuts to make from it. */
export interface PlannedPiece<S, K> {
  option: StockOption<S>;
  cuts: CutRequest<K>[];
  /** 1D: the length left after the cuts and their kerf. Null for 2D. */
  wasteMm: number | null;
}

export interface StockPlan<S, K> {
  pieces: PlannedPiece<S, K>[];
  /** Cuts that no stock size fits. */
  unplaced: CutRequest<K>[];
}

/**
 * True when stock is chosen by price: every option has a known price. Otherwise the plan with
 * the least waste wins.
 */
function choosesByPrice(options: StockOption<unknown>[]): boolean {
  return options.length > 0 && options.every((option) => option.price !== null);
}

/** The total price of a plan, or null when a piece has no known price. */
export function planCost(plan: StockPlan<unknown, unknown>): number | null {
  let total = 0;
  for (const piece of plan.pieces) {
    if (piece.option.price === null) return null;
    total += piece.option.price;
  }
  return total;
}

/**
 * Pack 1D cuts into sticks of one length by first-fit decreasing: longest cut first, on the
 * open stick with the least free length that it fits, else on a new stick.
 */
function packSticks<K>(lengthMm: number, kerfMm: number, cuts: CutRequest<K>[]) {
  const stick = { lengthMm };
  const bins: CutRequest<K>[][] = [];
  const lengths = (bin: CutRequest<K>[]) => bin.map((cut) => cut.lengthMm);
  for (const cut of cuts.toSorted((a, b) => b.lengthMm - a.lengthMm)) {
    let best: { bin: CutRequest<K>[]; free: number } | null = null;
    for (const bin of bins) {
      if (!cutsFit(stick, kerfMm, [...lengths(bin), cut.lengthMm])) continue;
      const free = freeLengthMm(stick, kerfMm, lengths(bin));
      if (best === null || free < best.free) best = { bin, free };
    }
    if (best) best.bin.push(cut);
    else bins.push([cut]);
  }
  return bins;
}

/**
 * The stock lengths to buy for 1D cuts. For each stock length that fits every cut, the cuts are
 * packed by first-fit decreasing, and then each stick is changed to the best stock size that
 * its cuts fit on: the cheapest when every price is known, else the shortest. So a plan can mix
 * stock lengths, such as a short stick for the last few cuts. Of these plans, the one with the
 * lowest total price wins when every price is known, else the one with the least stock length
 * (the least waste), then the one with fewer pieces. Cuts longer than every stock length are
 * `unplaced`.
 */
export function planStockLengths<S, K>(
  options: StockOption<S>[],
  kerfMm: number,
  cuts: CutRequest<K>[]
): StockPlan<S, K> {
  const linear = options.filter((option) => option.widthMm === null);
  const fitsOn = (option: StockOption<S>, lengthsMm: number[]) =>
    cutsFit(option, kerfMm, lengthsMm);
  const placeable = cuts.filter((cut) => linear.some((o) => fitsOn(o, [cut.lengthMm])));
  const unplaced = cuts.filter((cut) => !placeable.includes(cut));
  if (placeable.length === 0) return { pieces: [], unplaced };

  const byPrice = choosesByPrice(linear);
  const preferred = (a: StockOption<S>, b: StockOption<S>) =>
    (byPrice ? a.price! - b.price! : 0) || a.lengthMm - b.lengthMm;
  const score = (plan: StockPlan<S, K>) =>
    byPrice ? planCost(plan)! : plan.pieces.reduce((sum, p) => sum + p.option.lengthMm, 0);

  let best: StockPlan<S, K> | null = null;
  const stockLengths = new Set(linear.map((option) => option.lengthMm));
  for (const lengthMm of stockLengths) {
    if (!placeable.every((cut) => cutsFit({ lengthMm }, kerfMm, [cut.lengthMm]))) continue;
    const pieces = packSticks(lengthMm, kerfMm, placeable).map((bin) => {
      const lengths = bin.map((cut) => cut.lengthMm);
      const option = linear.filter((o) => fitsOn(o, lengths)).toSorted(preferred)[0];
      return { option, cuts: bin, wasteMm: freeLengthMm(option, kerfMm, lengths) };
    });
    const plan = { pieces, unplaced };
    if (
      best === null ||
      score(plan) < score(best) ||
      (score(plan) === score(best) && plan.pieces.length < best.pieces.length)
    ) {
      best = plan;
    }
  }
  return best!;
}

/** The 2D cuts of one requirement: `count` cuts of one size, `perSheet` of them on one sheet. */
export interface SheetCutGroup<K> {
  key: K;
  lengthMm: number;
  widthMm: number;
  count: number;
  /** How many cuts the user says fit on one sheet. One when not given. */
  perSheet: number;
}

/**
 * The stock sheets to buy for 2D cuts. Each sheet takes `perSheet` cuts of one requirement, as
 * the user says they fit; the app checks only that one cut fits the sheet, either way round. The
 * sheet is the cheapest that fits when every price is known, else the smallest. Cuts that fit
 * no sheet are `unplaced`.
 */
export function planStockSheets<S, K>(
  options: StockOption<S>[],
  groups: SheetCutGroup<K>[]
): StockPlan<S, K> {
  const sheets = options.filter((option) => option.widthMm !== null);
  const byPrice = choosesByPrice(sheets);
  const area = (option: StockOption<S>) => option.lengthMm * option.widthMm!;
  const preferred = (a: StockOption<S>, b: StockOption<S>) =>
    (byPrice ? a.price! - b.price! : 0) || area(a) - area(b);
  const plan: StockPlan<S, K> = { pieces: [], unplaced: [] };
  for (const group of groups) {
    const size = { lengthMm: group.lengthMm, widthMm: group.widthMm };
    const cut = { key: group.key, lengthMm: group.lengthMm };
    const option = sheets
      .filter((o) => fitsWithin(size, { lengthMm: o.lengthMm, widthMm: o.widthMm! }))
      .toSorted(preferred)[0];
    if (!option) {
      for (let i = 0; i < group.count; i++) plan.unplaced.push(cut);
      continue;
    }
    const perSheet = Math.max(Math.floor(group.perSheet), 1);
    for (let placed = 0; placed < group.count; placed += perSheet) {
      const count = Math.min(perSheet, group.count - placed);
      plan.pieces.push({ option, cuts: Array.from({ length: count }, () => cut), wasteMm: null });
    }
  }
  return plan;
}

/**
 * Integer weights of the cuts of one stock piece, for the share of its price that each cut
 * pays. A 1D cut pays in proportion to the length it uses with its kerf, so the shares of the
 * cuts add up to the whole price, waste included. 2D cuts pay equal shares.
 */
export function cutWeights(piece: PlannedPiece<unknown, unknown>, kerfMm: number): number[] {
  if (piece.option.widthMm !== null) return piece.cuts.map(() => 1);
  return piece.cuts.map((cut) => Math.round((cut.lengthMm + kerfMm) * 10_000));
}
