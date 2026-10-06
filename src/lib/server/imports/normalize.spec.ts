import { describe, expect, it } from "vitest";
import { normalizeAttributeValue } from "#lib/attributes.ts";
import { parseCsv } from "#lib/csv.ts";
import { openDatabase } from "#lib/server/db/connection.ts";
import { loadCatalogContext } from "./context";
import * as orderList from "./fixtures/order-list";
import { normalizeOrder, normalizeUnit } from "./normalize";
import type { OrderLineOutput } from "./schema";

const context = loadCatalogContext(openDatabase(":memory:"));

function orderLine(overrides: Partial<OrderLineOutput>): OrderLineOutput {
  return { ...orderList.response.lines[1], supplierSku: null, ...overrides };
}

describe("import normalization", () => {
  it("reads alternate resistor notation as the same typed value", () => {
    const [, pack, conflicting] = normalizeOrder(context, orderList.response).lines;
    const resistance = (attributes: { key: string; value: string }[]) =>
      normalizeAttributeValue("resistance", attributes.find((a) => a.key === "resistance")!.value);
    expect(resistance(pack.proposal.fields.attributes)?.valueNumber).toBe(
      orderList.expected.lines[1].resistanceOhms
    );
    expect(resistance(conflicting.proposal.fields.attributes)?.valueNumber).toBe(4700);
  });

  it("reads unit words into unit codes and rejects unknown units", () => {
    expect(["pcs", "Each", "pieces", "M", "ml", "kg"].map(normalizeUnit)).toEqual([
      "pcs",
      "pcs",
      "pcs",
      "m",
      "mL",
      "kg",
    ]);
    expect(normalizeUnit("bags")).toBeNull();
  });

  it("converts a measured purchase unit and never assumes a pack size", () => {
    const [reel, bag] = normalizeOrder(context, {
      supplier: null,
      reference: null,
      placedOn: null,
      lines: [
        orderLine({
          purchaseUnit: { value: "m", provenance: "source" },
          packQuantity: null,
          baseUnit: { value: "mm", provenance: "source" },
        }),
        orderLine({ purchaseUnit: { value: "bag", provenance: "source" }, packQuantity: null }),
      ],
    }).lines;
    expect(reel.proposal.fields.packQuantity).toBe("1000");
    expect(reel.proposal.provenance.packQuantity).toBe("normalized");
    expect(bag.proposal.fields.packQuantity).toBeNull();
    expect(bag.proposal.unresolved).toContain("Pack size is not stated");
  });

  it("marks an unknown category or unreadable attribute as unresolved", () => {
    const [line] = normalizeOrder(context, {
      supplier: null,
      reference: null,
      placedOn: null,
      lines: [
        orderLine({
          category: { value: "Widgets", provenance: "inferred" },
          attributes: [{ key: "resistance", value: "lots", provenance: "source" }],
        }),
      ],
    }).lines;
    expect(line.proposal.fields.categoryId).toBeNull();
    expect(line.proposal.unresolved).toEqual(
      expect.arrayContaining([
        'Category "Widgets" is not defined',
        'Resistance "lots" is not recognized',
      ])
    );
  });
});

describe("CSV parsing", () => {
  it("keeps quoted commas, doubled quotes, and line numbers", () => {
    expect(parseCsv('Qty,Ref\n2,"R5,R6"\n\n1,"8"" rod"\r\n')).toEqual([
      { row: 1, cells: ["Qty", "Ref"] },
      { row: 2, cells: ["2", "R5,R6"] },
      { row: 4, cells: ["1", '8" rod'] },
    ]);
  });
});
