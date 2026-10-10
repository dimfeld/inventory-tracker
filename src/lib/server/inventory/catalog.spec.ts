import { describe, expect, it } from "vitest";
import { InventoryError } from "./errors";
import { createTestInventory, opId, partInput } from "./test-helpers";

describe("catalog service", () => {
  it("creates a part with category, attributes, aliases, supplier references, and notes", () => {
    const { catalog } = createTestInventory();
    const workshop = catalog.createCategory("Workshop", null);
    const screws = catalog.createCategory("Screws", workshop);

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
    expect(details.attributes.map((a) => [a.key, a.rawValue, a.valueText, a.valueNumber])).toEqual([
      ["length", "8 mm", null, 8],
      ["thread", "M3", "M3", null],
    ]);
    expect(details.aliases).toEqual(["M3x8 SHCS"]);
    expect(details.supplierParts).toMatchObject([{ sku: "91290A113", packQuantity: 100 }]);
  });

  it("copies a part without its part number, aliases, and supplier references", () => {
    const { catalog } = createTestInventory();
    const screws = catalog.createCategory("Screws", null);
    const id = catalog.createPart(
      partInput({
        name: "M5 × 12 socket-head screw",
        categoryId: screws,
        manufacturer: "Bossard",
        partNumber: "BN610-M5x12",
        notes: "Black oxide",
        attributes: [
          { key: "thread", label: "Thread", value: "M5" },
          { key: "length", label: "Length", value: "12 mm" },
        ],
        aliases: ["M5x12 SHCS"],
        tags: ["metric"],
        supplierParts: [
          {
            id: null,
            supplier: "McMaster",
            sku: "91290A228",
            url: null,
            purchaseUnit: null,
            packQuantity: null,
          },
        ],
      })
    );

    expect(catalog.copyPartInput(id)).toEqual({
      name: "M5 × 12 socket-head screw",
      categoryId: screws,
      baseUnit: "pcs",
      manufacturer: "Bossard",
      partNumber: null,
      notes: "Black oxide",
      attributes: [
        { key: "length", label: "Length", value: "12 mm" },
        { key: "thread", label: "Thread", value: "M5" },
      ],
      aliases: [],
      tags: ["metric"],
      supplierParts: [],
      tracking: {
        mode: "bulk",
        lengthKey: null,
        widthKey: null,
        kerfMm: 0,
        minOffcutMm: 0,
        displayUnit: "mm",
        standardLengthMm: null,
        standardWidthMm: null,
      },
    });
    expect(catalog.copyPartInput(id + 1000)).toBeNull();
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

  it("allows several parts to share a supplier SKU but not one part to list it twice", () => {
    const { catalog } = createTestInventory();
    const ref = {
      id: null,
      supplier: "A",
      sku: "1",
      url: null,
      purchaseUnit: null,
      packQuantity: null,
    };
    const first = catalog.createPart(partInput({ supplierParts: [ref] }));
    const second = catalog.createPart(partInput({ name: "Other", supplierParts: [ref] }));
    expect(catalog.getPartDetails(second)!.supplierParts).toMatchObject([{ sku: "1" }]);

    expect(() => catalog.updatePart(first, partInput({ supplierParts: [ref, ref] }))).toThrow(
      InventoryError
    );
    expect(catalog.getPartDetails(first)!.supplierParts).toHaveLength(1);
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
