import { describe, expect, it } from "vitest";
import {
  calculateCut,
  checkSplit,
  cutsFit,
  findLengthInText,
  formatArea,
  formatLength,
  formatSize,
  freeLengthMm,
  lengthInputValue,
  parseCutSize,
  parsePieceLength,
  suggestCuts,
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

describe("cutsFit and freeLengthMm", () => {
  const stick = { lengthMm: 1000 };

  it("needs the length and a kerf for each cut", () => {
    expect(cutsFit(stick, 3, [600, 390])).toBe(true);
    expect(freeLengthMm(stick, 3, [600, 390])).toBe(4);
    // Without the kerf these would fill the stick exactly.
    expect(cutsFit(stick, 3, [600, 390, 10])).toBe(false);
    expect(cutsFit(stick, 3, [600, 390, 1])).toBe(true);
  });

  it("takes the whole piece without a cut or a kerf", () => {
    expect(cutsFit(stick, 3, [1000])).toBe(true);
    expect(freeLengthMm(stick, 3, [1000])).toBe(0);
    expect(cutsFit(stick, 3, [1000, 1])).toBe(false);
    expect(freeLengthMm(stick, 3, [])).toBe(1000);
  });
});

describe("suggestCuts", () => {
  const space = (id: number, lengthMm: number, freeLengthMm = lengthMm) => ({
    id,
    lengthMm,
    freeLengthMm,
    unreserved: freeLengthMm === lengthMm,
    kerfMm: 3,
  });

  it("places the longest cuts first, each on the smallest piece that fits", () => {
    const pieces = [space(1, 1220), space(2, 450), space(3, 300), space(4, 1000, 420)];
    const result = suggestCuts(pieces, [
      { key: "a", lengthMm: 400 },
      { key: "b", lengthMm: 400 },
      { key: "c", lengthMm: 415 },
      { key: "d", lengthMm: 250 },
    ]);
    expect(result.assignments).toEqual([
      // 415 + kerf fits in the 420 mm left on piece 4 exactly.
      { key: "c", lengthMm: 415, pieceId: 4 },
      { key: "a", lengthMm: 400, pieceId: 2 },
      { key: "b", lengthMm: 400, pieceId: 1 },
      { key: "d", lengthMm: 250, pieceId: 3 },
    ]);
    expect(result.unplaced).toEqual([]);
    // The input pieces do not change.
    expect(pieces[0].freeLengthMm).toBe(1220);
  });

  it("uses a piece of exactly the cut length, and reports cuts that do not fit", () => {
    const result = suggestCuts(
      [space(1, 415), space(2, 1000)],
      [
        { key: 1, lengthMm: 415 },
        { key: 2, lengthMm: 600 },
        { key: 3, lengthMm: 600 },
      ]
    );
    expect(result.assignments).toEqual([
      { key: 2, lengthMm: 600, pieceId: 2 },
      { key: 1, lengthMm: 415, pieceId: 1 },
    ]);
    expect(result.unplaced).toEqual([{ key: 3, lengthMm: 600 }]);
  });
});

describe("cut size text", () => {
  it("reads a length, or a length and width with one unit", () => {
    expect(parseCutSize("415")).toEqual({ lengthMm: 415, widthMm: null });
    expect(parseCutSize("415 mm")).toEqual({ lengthMm: 415, widthMm: null });
    expect(parseCutSize("150 × 75 mm")).toEqual({ lengthMm: 150, widthMm: 75 });
    expect(parseCutSize('6 x 4"')).toEqual({ lengthMm: 152.4, widthMm: 101.6 });
    expect(parseCutSize("M3x8")).toBeNull();
  });

  it("finds a length in a row description", () => {
    expect(findLengthInText("2020 aluminium extrusion, 6 mm T-slot (B-type), 415 mm")).toBe(415);
    expect(findLengthInText("2020 extrusion, cut to 16 in")).toBe(406.4);
    expect(findLengthInText("2020 extrusion")).toBeNull();
  });

  it("writes a length as input text that reads back to the same length", () => {
    expect(lengthInputValue(415, "mm")).toBe("415");
    expect(lengthInputValue(406.4, "in")).toBe("16");
    expect(lengthInputValue(415, "in")).toBe("415 mm");
    expect(parsePieceLength(lengthInputValue(415, "in"), "in")).toBe(415);
  });
});
