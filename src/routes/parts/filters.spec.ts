import { describe, expect, it } from "vitest";
import {
  parsePartFilters,
  partFiltersHref,
  removeFilter,
  selectedFilters,
  serializePartFilters,
} from "./filters";

describe("part filter state", () => {
  it("parses repeated attribute values and round-trips through the URL", () => {
    const params = new URLSearchParams(
      "q=shcs&category=3&attr.thread=M3&attr.thread=M4&attr.material=steel&tag=kit&archived=1"
    );
    const state = parsePartFilters(params);
    expect(state).toEqual({
      q: "shcs",
      category: 3,
      tags: ["kit"],
      attributes: { thread: ["M3", "M4"], material: ["steel"] },
      archived: true,
    });
    expect(parsePartFilters(serializePartFilters(state))).toEqual(state);
  });

  it("ignores empty and invalid values", () => {
    expect(parsePartFilters(new URLSearchParams("q=&category=abc&attr.thread=&tag="))).toEqual({
      q: "",
      category: null,
      tags: [],
      attributes: {},
      archived: false,
    });
    expect(partFiltersHref(parsePartFilters(new URLSearchParams()))).toBe("/parts");
  });

  it("removes one selected value and keeps the others", () => {
    const state = parsePartFilters(
      new URLSearchParams("category=3&attr.thread=M3&attr.thread=M4&attr.material=steel")
    );
    expect(selectedFilters(state)).toEqual([
      { kind: "category", value: 3 },
      { kind: "attribute", key: "thread", value: "M3" },
      { kind: "attribute", key: "thread", value: "M4" },
      { kind: "attribute", key: "material", value: "steel" },
    ]);
    expect(
      partFiltersHref(removeFilter(state, { kind: "attribute", key: "thread", value: "M3" }))
    ).toBe("/parts?category=3&attr.thread=M4&attr.material=steel");
    expect(
      removeFilter(state, { kind: "attribute", key: "material", value: "steel" }).attributes
    ).toEqual({ thread: ["M3", "M4"] });
    expect(removeFilter(state, { kind: "category", value: 3 }).category).toBeNull();
  });
});
