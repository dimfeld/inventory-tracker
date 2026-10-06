import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";

describe("parseCsv", () => {
  it("keeps quoted commas in comma-separated text", () => {
    expect(parseCsv('a,b\n"1, 2",3')).toEqual([
      { row: 1, cells: ["a", "b"] },
      { row: 2, cells: ["1, 2", "3"] },
    ]);
  });

  it("reads tab-separated text when the first line has a tab", () => {
    expect(parseCsv("Part\tDescription\r\nS7018-ND\tCONN HDR 20POS 0.1, TIN\r\n")).toEqual([
      { row: 1, cells: ["Part", "Description"] },
      { row: 2, cells: ["S7018-ND", "CONN HDR 20POS 0.1, TIN"] },
    ]);
  });
});
