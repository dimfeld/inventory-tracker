import { describe, expect, it } from "vitest";
import { cutWeights, planCost, planStockLengths, planStockSheets } from "./stock-packing";

const stick = (lengthMm: number, price: number | null = null) => ({
  stock: `${lengthMm}`,
  lengthMm,
  widthMm: null,
  price,
});
const cut = (key: string, lengthMm: number) => ({ key, lengthMm });
const summary = (plan: ReturnType<typeof planStockLengths<string, string>>) =>
  plan.pieces.map((piece) => ({
    stock: piece.option.stock,
    cuts: piece.cuts.map((c) => `${c.key}:${c.lengthMm}`),
    wasteMm: piece.wasteMm,
  }));

describe("planStockLengths", () => {
  it("packs longest cuts first and moves a stick to a shorter length when its cuts fit", () => {
    const plan = planStockLengths([stick(1000), stick(2000)], 3, [
      cut("a", 1500),
      cut("b", 600),
      cut("c", 300),
      cut("c", 300),
    ]);
    expect(summary(plan)).toEqual([
      // 1500 + 3 + 300 + 3 = 1806
      { stock: "2000", cuts: ["a:1500", "c:300"], wasteMm: 194 },
      // 600 + 3 + 300 + 3 = 906
      { stock: "1000", cuts: ["b:600", "c:300"], wasteMm: 94 },
    ]);
    expect(plan.unplaced).toEqual([]);
    expect(planCost(plan)).toBeNull();
  });

  it("chooses the least stock length without prices, and the lowest cost with prices", () => {
    const cuts = [cut("a", 900), cut("a", 900)];
    // Without prices: two 1000 mm sticks (2000 mm) waste as much as one 2000 mm stick, and
    // one stick is fewer pieces.
    expect(summary(planStockLengths([stick(1000), stick(2000)], 3, cuts))).toEqual([
      { stock: "2000", cuts: ["a:900", "a:900"], wasteMm: 194 },
    ]);
    // Two 1000 mm sticks for 10 cost less than one 2000 mm stick for 12.
    const plan = planStockLengths([stick(1000, 5), stick(2000, 12)], 3, cuts);
    expect(summary(plan).map((p) => p.stock)).toEqual(["1000", "1000"]);
    expect(planCost(plan)).toBe(10);
  });

  it("uses a stick of exactly the cut length without kerf, and reports cuts that fit nothing", () => {
    const plan = planStockLengths([stick(1000)], 3, [cut("a", 1000), cut("b", 1200)]);
    expect(summary(plan)).toEqual([{ stock: "1000", cuts: ["a:1000"], wasteMm: 0 }]);
    expect(plan.unplaced).toEqual([cut("b", 1200)]);
    expect(planStockLengths([], 3, [cut("a", 10)]).unplaced).toHaveLength(1);
  });
});

describe("planStockSheets", () => {
  const sheet = (lengthMm: number, widthMm: number, price: number | null = null) => ({
    stock: `${lengthMm}x${widthMm}`,
    lengthMm,
    widthMm,
    price,
  });

  it("uses one sheet per cut, or the cuts per sheet the user gives, of the best fitting sheet", () => {
    const plan = planStockSheets(
      [sheet(300, 300), sheet(150, 150), sheet(600, 600)],
      [
        // 200 × 100 fits the 300 × 300 sheet only rotated or not; 150 × 150 is too small.
        { key: "a", lengthMm: 100, widthMm: 200, count: 2, perSheet: 1 },
        { key: "b", lengthMm: 140, widthMm: 140, count: 3, perSheet: 2 },
        { key: "c", lengthMm: 700, widthMm: 100, count: 1, perSheet: 1 },
      ]
    );
    expect(plan.pieces.map((p) => [p.option.stock, p.cuts.length])).toEqual([
      ["300x300", 1],
      ["300x300", 1],
      ["150x150", 2],
      ["150x150", 1],
    ]);
    expect(plan.unplaced).toEqual([{ key: "c", lengthMm: 700 }]);
  });

  it("chooses the cheapest sheet when every price is known", () => {
    const plan = planStockSheets(
      [sheet(300, 300, 4), sheet(600, 600, 3)],
      [{ key: "a", lengthMm: 100, widthMm: 100, count: 1, perSheet: 1 }]
    );
    expect(plan.pieces[0].option.stock).toBe("600x600");
  });
});

describe("cutWeights", () => {
  it("weights 1D cuts by length plus kerf and 2D cuts equally", () => {
    const piece = { option: stick(1000), cuts: [cut("a", 400), cut("b", 197)], wasteMm: 397 };
    expect(cutWeights(piece, 3)).toEqual([4_030_000, 2_000_000]);
    const sheetPiece = {
      option: { stock: "s", lengthMm: 100, widthMm: 100, price: null },
      cuts: [cut("a", 50), cut("a", 50)],
      wasteMm: null,
    };
    expect(cutWeights(sheetPiece, 3)).toEqual([1, 1]);
  });
});
