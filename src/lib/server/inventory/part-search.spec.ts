import { describe, expect, it } from "vitest";
import type { PartFilter } from "./catalog";
import { createFilterFixtures } from "./fixtures";
import { createTestInventory, partInput } from "./test-helpers";

function setup() {
  const inv = createTestInventory();
  const fixtures = createFilterFixtures(inv.catalog);
  const search = (filter: Partial<PartFilter>) =>
    inv.catalog
      .searchParts({
        text: null,
        categoryId: null,
        attributes: [],
        tags: [],
        includeArchived: false,
        ...filter,
      })
      .map((part) => part.id)
      .sort((a, b) => a - b);
  const ids = (...parts: (keyof typeof fixtures.ids)[]) =>
    parts.map((name) => fixtures.ids[name]).sort((a, b) => a - b);
  return { ...inv, ...fixtures, search, ids };
}

describe("part search", () => {
  it("finds M3 items across categories, and M3 screws only within screws", () => {
    const { search, ids, categories } = setup();
    const m3 = [{ key: "thread", values: ["M3"] }];

    expect(search({ attributes: m3 })).toEqual(
      ids("m3x8PanScrew", "m3x12SocketScrew", "m3HeatSetInsert", "m3PressInsert")
    );
    expect(search({ categoryId: categories.screws, attributes: m3 })).toEqual(
      ids("m3x8PanScrew", "m3x12SocketScrew")
    );
  });

  it("includes descendant categories, and heat-set inserts return only heat-set inserts", () => {
    const { search, ids, categories } = setup();
    expect(search({ categoryId: categories.screws })).toEqual(
      ids("m3x8PanScrew", "m3x12SocketScrew", "m25ScrewSteel", "unknownScrew")
    );
    expect(search({ categoryId: categories.heatSet })).toEqual(
      ids("m3HeatSetInsert", "m4HeatSetInsert")
    );
    expect(search({ categoryId: categories.inserts })).toEqual(
      ids("m3HeatSetInsert", "m4HeatSetInsert", "m3PressInsert")
    );
  });

  it("combines different attributes with AND and values of one attribute with OR", () => {
    const { search, ids } = setup();
    expect(search({ attributes: [{ key: "thread", values: ["M3", "M4"] }] })).toEqual(
      ids("m3x8PanScrew", "m3x12SocketScrew", "m3HeatSetInsert", "m4HeatSetInsert", "m3PressInsert")
    );
    expect(
      search({
        attributes: [
          { key: "thread", values: ["M3", "M2.5"] },
          { key: "material", values: ["steel"] },
        ],
      })
    ).toEqual(ids("m3x12SocketScrew", "m25ScrewSteel"));
    expect(
      search({
        attributes: [
          { key: "thread", values: ["M3"] },
          { key: "length", values: ["8"] },
        ],
      })
    ).toEqual(ids("m3x8PanScrew"));
  });

  it("normalizes filter values with the attribute's rule", () => {
    const { search, ids } = setup();
    expect(search({ attributes: [{ key: "thread", values: ["m3x0.5"] }] })).toHaveLength(4);
    expect(search({ attributes: [{ key: "resistance", values: ["4700"] }] })).toEqual(
      ids("resistor4k7Smd", "resistor4k7Tht")
    );
    expect(search({ attributes: [{ key: "power", values: ["250mW"] }] })).toEqual(
      ids("resistor4k7Tht")
    );
    expect(search({ attributes: [{ key: "no_such_attribute", values: ["x"] }] })).toEqual([]);
  });

  it("stores equivalent resistor notation as equal values and keeps the original text", () => {
    const { catalog, ids } = setup();
    const resistance = (id: number) =>
      catalog.getPartDetails(id)!.attributes.find((a) => a.key === "resistance")!;
    const [smd, tht] = ids("resistor4k7Smd", "resistor4k7Tht");

    expect(resistance(smd)).toMatchObject({ rawValue: "4k7", valueNumber: 4700 });
    expect(resistance(tht)).toMatchObject({ rawValue: "4.7 kΩ", valueNumber: 4700 });

    const results = catalog.searchParts({
      text: "4.7k resistor 0805",
      categoryId: null,
      attributes: [],
      tags: [],
      includeArchived: false,
    });
    expect(results[0].attributes.find((a) => a.key === "resistance")).toEqual({
      key: "resistance",
      label: "Resistance",
      rawValue: "4k7",
      display: "4.7 kΩ",
    });
  });

  it("splits a combined thread designation into thread and length", () => {
    const { catalog, ids } = setup();
    const attributes = catalog.getPartDetails(ids("m3x8PanScrew")[0])!.attributes;
    expect(attributes.filter((a) => a.key === "thread" || a.key === "length")).toMatchObject([
      { key: "length", rawValue: "M3x8", valueNumber: 8 },
      { key: "thread", rawValue: "M3x8", valueText: "M3" },
    ]);
  });

  it("finds a part through its alias, manufacturer part number, and supplier SKU", () => {
    const { search, ids } = setup();
    expect(search({ text: "SHCS" })).toEqual(ids("m3x12SocketScrew"));
    expect(search({ text: "91290A117" })).toEqual(ids("m3x12SocketScrew"));
    expect(search({ text: "rx-m3x5.7" })).toEqual(ids("m3HeatSetInsert"));
    expect(search({ text: "100%" })).toEqual([]);
  });

  it("matches each word on its own, and a quoted phrase as one piece of text", () => {
    const { search, ids } = setup();
    expect(search({ text: "screw m3 pan" })).toEqual(ids("m3x8PanScrew"));
    expect(search({ text: "socket 91290A117" })).toEqual(ids("m3x12SocketScrew"));
    expect(search({ text: '"pan head" m2.5' })).toEqual(ids("m25ScrewSteel"));
    expect(search({ text: '"head pan"' })).toEqual([]);
  });

  it("keeps missing and unreadable attributes unknown", () => {
    const { catalog, search, ids, categories } = setup();
    const unknown = ids("unknownScrew")[0];
    expect(catalog.getPartDetails(unknown)!.attributes).toEqual([]);

    const unreadable = catalog.createPart(
      partInput({
        name: "Odd resistor",
        categoryId: categories.resistors,
        attributes: [{ key: "resistance", label: "Resistance", value: "about 5k" }],
      })
    );
    expect(catalog.getPartDetails(unreadable)!.attributes).toMatchObject([
      { rawValue: "about 5k", valueNumber: null, valueText: null },
    ]);

    // Neither part matches any value filter, and neither adds a facet value.
    const screwThreads = catalog
      .partFacets(categories.screws, false)
      .find((f) => f.key === "thread")!;
    expect(screwThreads.values.map((v) => v.value)).toEqual(["M2.5", "M3"]);
    expect(search({ attributes: [{ key: "thread", values: ["M2.5", "M3"] }] })).not.toContain(
      unknown
    );
    const resistances = catalog
      .partFacets(categories.resistors, false)
      .find((f) => f.key === "resistance")!;
    expect(resistances.values).toEqual([
      { value: "4700", label: "4.7 kΩ", partCount: 2 },
      { value: "10000", label: "10 kΩ", partCount: 1 },
    ]);
  });

  it("filters by optional tags with OR", () => {
    const { search, ids } = setup();
    expect(search({ tags: ["3d printing"] })).toEqual(ids("m3HeatSetInsert", "m4HeatSetInsert"));
    expect(search({ tags: ["3d printing", "wiring"] })).toEqual(
      ids("m3HeatSetInsert", "m4HeatSetInsert", "jstXhHeader")
    );
  });

  it("offers the attributes applicable to the category scope", () => {
    const { catalog, categories } = setup();
    const keys = (categoryId: number | null) =>
      catalog.partFacets(categoryId, false).map((f) => f.key);

    expect(keys(categories.socketHead)).toEqual(["drive", "head", "length", "material", "thread"]);
    expect(keys(categories.heatSet)).toEqual(["length", "outer_diameter", "thread"]);
    expect(keys(categories.connectors)).toEqual(["gender", "mounting", "pin_count", "pitch"]);
    // With no category, every attribute that has a value.
    expect(keys(null)).toContain("capacitance");
    expect(keys(null)).toContain("resistance");
  });

  it("hides archived parts unless asked", () => {
    const { catalog, search, ids, categories } = setup();
    const [m4] = ids("m4HeatSetInsert");
    catalog.archivePart(m4);
    expect(search({ categoryId: categories.heatSet })).toEqual(ids("m3HeatSetInsert"));
    expect(search({ categoryId: categories.heatSet, includeArchived: true })).toEqual(
      ids("m3HeatSetInsert", "m4HeatSetInsert")
    );
  });
});
