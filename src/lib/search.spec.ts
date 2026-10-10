import { describe, expect, it } from "vitest";
import { matchesSearch, searchTerms } from "./search";

describe("searchTerms", () => {
  it("splits words and keeps quoted phrases together", () => {
    expect(searchTerms("  m5   8mm ")).toEqual(["m5", "8mm"]);
    expect(searchTerms('"m5 x  8" button')).toEqual(["m5 x 8", "button"]);
    expect(searchTerms('screw "socket head')).toEqual(["screw", "socket head"]);
    expect(searchTerms('"" ')).toEqual([]);
  });
});

describe("matchesSearch", () => {
  it("needs every term, in any order and case", () => {
    expect(matchesSearch("M5 x 8mm button head", "m5 8mm")).toBe(true);
    expect(matchesSearch("M5 x 8mm button head", "8MM m5")).toBe(true);
    expect(matchesSearch("M5 x 8mm button head", '"m5 8mm"')).toBe(false);
    expect(matchesSearch("M5 x 8mm button head", "")).toBe(true);
  });
});
