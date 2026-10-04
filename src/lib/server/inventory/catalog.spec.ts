import { describe, expect, it } from "vitest";
import { InventoryError } from "./errors";
import { createTestInventory, opId, partInput } from "./test-helpers";

describe("catalog service", () => {
  it("creates a part with category, attributes, aliases, supplier references, and notes", () => {
    const { catalog } = createTestInventory();
    const hardware = catalog.createCategory("Hardware", null);
    const screws = catalog.createCategory("Screws", hardware);

    const id = catalog.createPart(
      partInput({
        categoryId: screws,
        notes: "Black oxide",
        attributes: [
          { key: "thread", label: "Thread", value: "M3" },
          { key: "length", label: "Length", value: "8 mm" },
        ],
        aliases: ["M3x8 SHCS"],
        supplierParts: [
          {
            id: null,
            supplier: "McMaster",
            sku: "91290A113",
            url: null,
            purchaseUnit: "pack",
            packQuantity: 100,
          },
        ],
      })
    );

    const details = catalog.getPartDetails(id)!;
    expect(details.part).toMatchObject({ categoryName: "Screws", notes: "Black oxide" });
    expect(details.attributes.map((a) => [a.key, a.rawValue, a.valueText])).toEqual([
      ["length", "8 mm", "8 mm"],
      ["thread", "M3", "M3"],
    ]);
    expect(details.aliases).toEqual(["M3x8 SHCS"]);
    expect(details.supplierParts).toMatchObject([{ sku: "91290A113", packQuantity: 100 }]);
  });

  it("updates supplier references in place and removes dropped ones", () => {
    const { catalog } = createTestInventory();
    const id = catalog.createPart(
      partInput({
        supplierParts: [
          { id: null, supplier: "A", sku: "1", url: null, purchaseUnit: null, packQuantity: null },
          { id: null, supplier: "B", sku: "2", url: null, purchaseUnit: null, packQuantity: null },
        ],
      })
    );
    const [a] = catalog.getPartDetails(id)!.supplierParts;

    catalog.updatePart(
      id,
      partInput({
        supplierParts: [{ ...a, sku: "1-new", packQuantity: 50 }],
      })
    );
    expect(catalog.getPartDetails(id)!.supplierParts).toEqual([
      { ...a, sku: "1-new", packQuantity: 50 },
    ]);
  });

  it("rejects a supplier SKU that belongs to another part", () => {
    const { catalog } = createTestInventory();
    const ref = {
      id: null,
      supplier: "A",
      sku: "1",
      url: null,
      purchaseUnit: null,
      packQuantity: null,
    };
    catalog.createPart(partInput({ supplierParts: [ref] }));
    expect(() => catalog.createPart(partInput({ name: "Other", supplierParts: [ref] }))).toThrow(
      InventoryError
    );
    expect(catalog.getPartDetails(2)).toBeNull();
  });

  it("does not change the base unit after stock is recorded", () => {
    const { catalog, locations, stock } = createTestInventory();
    const id = catalog.createPart(partInput());
    const loc = locations.createLocation({ name: "Drawer", notes: null });
    catalog.updatePart(id, partInput({ baseUnit: "mm" }));
    catalog.updatePart(id, partInput({ baseUnit: "pcs" }));
    stock.recordOpeningStock({
      operationId: opId(),
      partId: id,
      locationId: loc,
      amount: "5",
      unit: "pcs",
      occurredOn: "2026-10-01",
    });

    expect(() => catalog.updatePart(id, partInput({ baseUnit: "mm" }))).toThrow(/base unit/);
    expect(catalog.getPartDetails(id)!.part.baseUnit).toBe("pcs");
  });
});
