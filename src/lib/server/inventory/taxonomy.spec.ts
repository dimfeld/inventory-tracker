import { describe, expect, it } from "vitest";
import { InventoryError } from "./errors";
import { createTestInventory, partInput } from "./test-helpers";

function setup() {
  const ctx = createTestInventory();
  const hardware = ctx.catalog.createCategory("Workshop", null);
  const screws = ctx.catalog.createCategory("Bolts", hardware);
  const screw = ctx.catalog.createPart(
    partInput({
      name: "M3x8 screw",
      categoryId: screws,
      attributes: [{ key: "head", label: "Head", value: "Socket head" }],
    })
  );
  const other = ctx.catalog.createPart(
    partInput({
      name: "M3x10 screw",
      categoryId: screws,
      attributes: [{ key: "head", label: "Head", value: "socket-head" }],
    })
  );
  return { ...ctx, hardware, screws, screw, other };
}

const attribute = (ctx: ReturnType<typeof setup>, key: string) =>
  ctx.taxonomy.listAttributes().find((a) => a.key === key)!;

describe("taxonomy service", () => {
  it("creates an attribute, assigns it to a category, and sets part values", () => {
    const ctx = setup();
    ctx.taxonomy.createAttribute("shank", {
      label: "Shank diameter",
      valueType: "number",
      normalization: "length",
      canonicalUnit: "mm",
    });
    ctx.taxonomy.setApplicability("shank", ctx.hardware, true);
    ctx.taxonomy.setPartValue(ctx.screw, "shank", "1/8 in");
    ctx.taxonomy.setPartValue(ctx.other, "shank", "3.175mm");

    expect(attribute(ctx, "shank")).toMatchObject({
      partCount: 2,
      categories: [{ categoryId: ctx.hardware, path: "Workshop", required: true }],
    });
    expect(ctx.catalog.attributeOptions().applicable[ctx.screws]).toContain("shank");
    // "1/8 in" is not a number the length rule reads, so it keeps no typed value.
    expect(ctx.taxonomy.listValues("shank").map((v) => [v.rawValue, v.valueNumber])).toEqual([
      ["1/8 in", null],
      ["3.175mm", 3.175],
    ]);

    ctx.taxonomy.setApplicability("shank", ctx.hardware, null);
    expect(attribute(ctx, "shank").categories).toEqual([]);
    ctx.taxonomy.setPartValue(ctx.screw, "shank", null);
    expect(attribute(ctx, "shank").partCount).toBe(1);
  });

  it("rejects a bad key, a duplicate key, and an unknown rule", () => {
    const ctx = setup();
    const fields = {
      label: "X",
      valueType: "text" as const,
      normalization: null,
      canonicalUnit: null,
    };
    expect(() => ctx.taxonomy.createAttribute("Bad Key", fields)).toThrow(InventoryError);
    expect(() => ctx.taxonomy.createAttribute("head", fields)).toThrow("already exists");
    expect(() =>
      ctx.taxonomy.createAttribute("coating", { ...fields, normalization: "nonsense" })
    ).toThrow("Unknown normalization rule");
  });

  it("replaces one raw value on every part", () => {
    const ctx = setup();
    expect(ctx.taxonomy.replaceValue("head", "socket-head", "Socket head")).toBe(1);
    expect(ctx.taxonomy.listValues("head")).toEqual([
      expect.objectContaining({ rawValue: "Socket head", partCount: 2 }),
    ]);
  });

  it("types stored values again when the rule changes", () => {
    const ctx = setup();
    ctx.taxonomy.createAttribute("grip", {
      label: "Grip",
      valueType: "text",
      normalization: null,
      canonicalUnit: null,
    });
    ctx.taxonomy.setPartValue(ctx.screw, "grip", "12 mm");
    ctx.taxonomy.updateAttribute("grip", {
      label: "Grip length",
      valueType: "number",
      normalization: "length",
      canonicalUnit: "mm",
    });
    expect(ctx.taxonomy.listValues("grip")).toEqual([
      expect.objectContaining({ rawValue: "12 mm", valueText: null, valueNumber: 12 }),
    ]);
    // A plain number type without a rule rejects text that is not a number.
    expect(() =>
      ctx.taxonomy.updateAttribute("head", {
        label: "Head",
        valueType: "number",
        normalization: null,
        canonicalUnit: null,
      })
    ).toThrow("must be a number");
    expect(attribute(ctx, "head").valueType).toBe("text");
  });

  it("deletes only unused attributes and categories", () => {
    const ctx = setup();
    expect(() => ctx.taxonomy.deleteAttribute("head")).toThrow("used by 2 part(s)");
    ctx.taxonomy.createAttribute("finish", {
      label: "Finish",
      valueType: "text",
      normalization: "keyword",
      canonicalUnit: null,
    });
    ctx.taxonomy.deleteAttribute("finish");
    expect(attribute(ctx, "finish")).toBeUndefined();

    expect(() => ctx.taxonomy.deleteCategory(ctx.hardware)).toThrow("1 child categories");
    const empty = ctx.catalog.createCategory("Empty", null);
    ctx.taxonomy.deleteCategory(empty);
    expect(ctx.catalog.listCategories().some((c) => c.id === empty)).toBe(false);
  });

  it("renames and moves a category but never under itself", () => {
    const ctx = setup();
    const fasteners = ctx.catalog.createCategory("Holders", ctx.hardware);
    ctx.taxonomy.updateCategory(ctx.screws, { name: "Machine bolts", parentId: fasteners });
    expect(ctx.catalog.listCategories().find((c) => c.id === ctx.screws)).toMatchObject({
      name: "Machine bolts",
      parentId: fasteners,
    });
    expect(() =>
      ctx.taxonomy.updateCategory(ctx.hardware, { name: "Workshop", parentId: ctx.screws })
    ).toThrow("cannot move under itself");
  });
});
