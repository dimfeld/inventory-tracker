import { categoryOptions } from "#lib/categories.ts";
import type { PartInput } from "#lib/schemas/part.ts";
import type { CatalogService } from "./catalog";

/** The ID of a category by its full path, such as "Hardware / Fasteners / Screws". */
export function categoryIdByPath(catalog: CatalogService, path: string): number {
  const category = categoryOptions(catalog.listCategories()).find((c) => c.path === path);
  if (!category) throw new Error(`Category "${path}" does not exist`);
  return category.id;
}

function attrs(values: Record<string, string>): PartInput["attributes"] {
  return Object.entries(values).map(([key, value]) => ({ key, label: key, value }));
}

function part(overrides: Partial<PartInput> & Pick<PartInput, "name">): PartInput {
  return {
    categoryId: null,
    baseUnit: "pcs",
    manufacturer: null,
    partNumber: null,
    notes: null,
    attributes: [],
    aliases: [],
    tags: [],
    supplierParts: [],
    ...overrides,
  };
}

/**
 * Parts that tell apart the category and attribute combinations used by the inventory filters:
 * M3 parts in different categories, screws in a child category, other threads, equivalent
 * resistor notation, identifiers for text search, and a part with missing attributes.
 */
export function createFilterFixtures(catalog: CatalogService) {
  const screws = categoryIdByPath(catalog, "Hardware / Fasteners / Screws");
  const socketHead = catalog.createCategory("Socket head", screws);
  const inserts = categoryIdByPath(catalog, "Hardware / Inserts");
  const heatSet = categoryIdByPath(catalog, "Hardware / Inserts / Heat-set inserts");
  const resistors = categoryIdByPath(catalog, "Electronics / Passives / Resistors");
  const capacitors = categoryIdByPath(catalog, "Electronics / Passives / Capacitors");
  const connectors = categoryIdByPath(catalog, "Electronics / Connectors");

  const create = (input: Parameters<typeof part>[0]) => catalog.createPart(part(input));

  const ids = {
    m3x8PanScrew: create({
      name: "M3 × 8 pan head screw",
      categoryId: screws,
      // The length comes from the combined designation.
      attributes: attrs({
        thread: "M3x8",
        material: "Stainless steel",
        head: "Pan",
        drive: "Phillips",
      }),
    }),
    m3x12SocketScrew: create({
      name: "M3 × 12 socket head cap screw",
      categoryId: socketHead,
      attributes: attrs({
        thread: "M3",
        length: "12 mm",
        material: "Steel",
        head: "Socket",
        drive: "Hex",
      }),
      aliases: ["M3x12 SHCS"],
      supplierParts: [
        {
          id: null,
          supplier: "McMaster-Carr",
          sku: "91290A117",
          url: null,
          purchaseUnit: null,
          packQuantity: null,
        },
      ],
    }),
    m25ScrewSteel: create({
      name: "M2.5 × 6 pan head screw",
      categoryId: screws,
      attributes: attrs({ thread: "M2.5x6", material: "steel", head: "pan" }),
    }),
    unknownScrew: create({ name: "Unsorted screw", categoryId: screws }),
    m3HeatSetInsert: create({
      name: "M3 heat-set insert",
      categoryId: heatSet,
      attributes: attrs({ thread: "m3", outer_diameter: "4.2 mm", length: "5.7mm" }),
      manufacturer: "Ruthex",
      partNumber: "RX-M3x5.7",
      tags: ["3d printing"],
    }),
    m4HeatSetInsert: create({
      name: "M4 heat-set insert",
      categoryId: heatSet,
      attributes: attrs({ thread: "M4", outer_diameter: "5.6 mm", length: "8.1 mm" }),
      tags: ["3d printing"],
    }),
    m3PressInsert: create({
      name: "M3 press-fit insert",
      categoryId: inserts,
      attributes: attrs({ thread: "M 3" }),
    }),
    resistor4k7Smd: create({
      name: "4.7k resistor 0805",
      categoryId: resistors,
      attributes: attrs({ resistance: "4k7", tolerance: "1%", power: "0.125 W", package: "0805" }),
    }),
    resistor4k7Tht: create({
      name: "4.7k resistor axial",
      categoryId: resistors,
      attributes: attrs({ resistance: "4.7 kΩ", tolerance: "±5 %", power: "1/4W" }),
    }),
    resistor10k: create({
      name: "10k resistor 0805",
      categoryId: resistors,
      attributes: attrs({ resistance: "10k", tolerance: "1%", package: "0805" }),
    }),
    capacitor100n: create({
      name: "100nF ceramic capacitor",
      categoryId: capacitors,
      attributes: attrs({ capacitance: "100nF", voltage: "50V", package: "0805" }),
    }),
    jstXhHeader: create({
      name: "JST XH 4-pin header",
      categoryId: connectors,
      attributes: attrs({
        pitch: "2.5 mm",
        pin_count: "4",
        gender: "Male",
        mounting: "Through-hole",
      }),
      tags: ["wiring"],
    }),
  };
  return {
    categories: { screws, socketHead, inserts, heatSet, resistors, capacitors, connectors },
    ids,
  };
}
