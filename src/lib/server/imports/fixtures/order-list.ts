/**
 * An order list with a screw that has no dimensions, a resistor in alternate notation sold in a
 * pack of 100, and a line whose manufacturer part number belongs to a different resistor than
 * its description says. `response` is a stored model answer; `expected` is the normalized result.
 */
import type { OrderOutput } from "../schema";

export const source = `DigiKey order DK-55012
1  M3 screws, stainless          2 bags
2  RES 4K7 OHM 1% 0805           1 pack of 100   SKU 311-4.70KCRCT-ND
3  RC0805FR-0710KL 4.7k 0805     50 pcs`;

export const response: OrderOutput = {
  supplier: { value: "DigiKey", provenance: "source" },
  reference: { value: "DK-55012", provenance: "source" },
  lines: [
    {
      description: "M3 screws, stainless",
      category: { value: "Hardware / Fasteners / Screws", provenance: "inferred" },
      manufacturer: null,
      partNumber: null,
      supplierSku: null,
      attributes: [
        { key: "thread", value: "M3", provenance: "source" },
        { key: "material", value: "stainless", provenance: "source" },
      ],
      evidence: { row: 2, excerpt: "M3 screws, stainless          2 bags" },
      unresolved: ["length", "head type", "bag size"],
      notes: null,
      purchaseQuantity: { value: 2, provenance: "source" },
      purchaseUnit: { value: "bag", provenance: "source" },
      packQuantity: null,
      baseUnit: { value: "pcs", provenance: "inferred" },
      unitPrice: null,
      currency: null,
    },
    {
      description: "RES 4K7 OHM 1% 0805",
      category: { value: "Electronics / Passives / Resistors", provenance: "inferred" },
      manufacturer: null,
      partNumber: null,
      supplierSku: { value: "311-4.70KCRCT-ND", provenance: "source" },
      attributes: [
        { key: "resistance", value: "4K7", provenance: "source" },
        { key: "tolerance", value: "1%", provenance: "source" },
        { key: "package", value: "0805", provenance: "source" },
      ],
      evidence: { row: 3, excerpt: "RES 4K7 OHM 1% 0805           1 pack of 100" },
      unresolved: [],
      notes: null,
      purchaseQuantity: { value: 1, provenance: "source" },
      purchaseUnit: { value: "pack", provenance: "source" },
      packQuantity: { value: 100, provenance: "normalized" },
      baseUnit: { value: "pcs", provenance: "inferred" },
      unitPrice: null,
      currency: null,
    },
    {
      description: "RC0805FR-0710KL 4.7k 0805",
      category: { value: "Electronics / Passives / Resistors", provenance: "inferred" },
      manufacturer: null,
      partNumber: { value: "RC0805FR-0710KL", provenance: "source" },
      supplierSku: null,
      attributes: [
        { key: "resistance", value: "4.7k", provenance: "source" },
        { key: "package", value: "0805", provenance: "source" },
      ],
      evidence: { row: 4, excerpt: "RC0805FR-0710KL 4.7k 0805     50 pcs" },
      unresolved: [],
      notes: null,
      purchaseQuantity: { value: 50, provenance: "source" },
      purchaseUnit: { value: "pcs", provenance: "source" },
      packQuantity: null,
      baseUnit: { value: "pcs", provenance: "source" },
      unitPrice: null,
      currency: null,
    },
  ],
};

/** The normalized proposals, line by line. */
export const expected = {
  header: { supplier: "DigiKey", reference: "DK-55012" },
  lines: [
    {
      // Missing screw dimensions stay unresolved; the bag size is never assumed.
      fields: { quantity: "2", purchaseUnit: "bag", packQuantity: null, unit: "pcs" },
      unresolved: ["Length is not specified", "Head is not specified", "Pack size is not stated"],
    },
    {
      // Alternate resistor notation reads as 4.7 kΩ; the pack holds 100 pieces.
      fields: { quantity: "1", purchaseUnit: "pack", packQuantity: "100", unit: "pcs" },
      provenance: { packQuantity: "normalized" },
      resistanceOhms: 4700,
      conversion: "1 pack × 100 pcs = 100 pcs",
    },
    {
      // "pcs" is sold each, one piece per purchase unit.
      fields: {
        quantity: "50",
        purchaseUnit: "each",
        packQuantity: "1",
        partNumber: "RC0805FR-0710KL",
      },
      provenance: { purchaseUnit: "normalized", packQuantity: "normalized" },
      // The part number names the catalog's 10k resistor, which conflicts with 4.7k.
      identifierConflict: "Resistance is 10 kΩ; requirement needs 4.7 kΩ",
    },
  ],
} as const;
