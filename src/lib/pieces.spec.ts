import { describe, expect, it } from "vitest";
import {
  calculateCut,
  checkSplit,
  formatArea,
  formatLength,
  formatSize,
  parsePieceLength,
} from "./pieces";

describe("parsePieceLength", () => {
  it("reads a bare number in the display unit, and a length with a unit as entered", () => {
    expect(parsePieceLength("300", "mm")).toBe(300);
    expect(parsePieceLength("12", "in")).toBe(304.8);
    expect(parsePieceLength("0.5", "in")).toBe(12.7);
    expect(parsePieceLength("300 mm", "in")).toBe(300);
    expect(parsePieceLength('2"', "mm")).toBe(50.8);
    expect(parsePieceLength("long", "in")).toBeNull();
  });
});

describe("formatLength and formatSize", () => {
  it("show mm or inches, with ≈ for inches that are not exact", () => {
    expect(formatLength(415.5, "mm")).toBe("415.5 mm");
    expect(formatLength(912.4000000001, "mm")).toBe("912.4 mm");
    expect(formatLength(304.8, "in")).toBe("12 in");
    expect(formatLength(100, "in")).toBe("≈3.937 in");
    expect(formatSize({ lengthMm: 152.4, widthMm: 101.6 }, "in")).toBe("6 × 4 in");
    expect(formatSize({ lengthMm: 150, widthMm: null }, "mm")).toBe("150 mm");
    expect(formatArea(177.8 * 152.4, "in")).toBe("42 in²");
  });
});

describe("calculateCut", () => {
  const settings = { kerfMm: 2, minOffcutMm: 50 };

  it("subtracts the cut lengths and the kerf of each cut", () => {
    expect(calculateCut({ lengthMm: 1220 }, settings, [415, 300])).toEqual({
      remainderMm: 501,
      fits: true,
      underMinimum: false,
    });
  });

  it("marks a remainder under the minimum offcut", () => {
    expect(calculateCut({ lengthMm: 400 }, settings, [368])).toMatchObject({
      remainderMm: 30,
      underMinimum: true,
    });
  });

  it("treats an exact fit in inches as zero, and refuses a cut that does not fit", () => {
    // 48 in − 2 × 23.9 in − 2 × 0.1 in kerf, with float noise.
    const exact = calculateCut(
      { lengthMm: 1219.2 },
      { kerfMm: 2.54, minOffcutMm: 0 },
      [607.06, 607.06]
    );
    expect(exact).toEqual({ remainderMm: 0, fits: true, underMinimum: false });
    expect(calculateCut({ lengthMm: 100 }, settings, [99])).toMatchObject({
      remainderMm: -1,
      fits: false,
    });
  });
});

describe("checkSplit", () => {
  const parent = { lengthMm: 177.8, widthMm: 152.4 };

  it("accepts outputs that fit, including rotated ones", () => {
    const check = checkSplit(parent, [
      { lengthMm: 101.6, widthMm: 152.4 },
      { lengthMm: 152.4, widthMm: 25.4 },
    ]);
    expect(check.areaFits).toBe(true);
    expect(check.oversized).toEqual([]);
  });

  it("finds too much area and outputs larger than the parent", () => {
    const check = checkSplit(parent, [
      { lengthMm: 200, widthMm: 10 },
      { lengthMm: 177.8, widthMm: 152.4 },
    ]);
    expect(check.areaFits).toBe(false);
    expect(check.oversized).toEqual([0]);
  });
});
