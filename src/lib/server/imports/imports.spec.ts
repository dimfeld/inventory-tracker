import { describe, expect, it } from "vitest";
import { emptyLineFields, type ImportLineFields } from "#lib/imports.ts";
import { getImport } from "#lib/server/db/imports.ts";
import { listBomLines, listComponents } from "#lib/server/db/projects.ts";
import { opId } from "#lib/server/inventory/test-helpers.ts";
import * as bomFlat from "./fixtures/bom-flat";
import * as bomSections from "./fixtures/bom-sections";
import * as orderList from "./fixtures/order-list";
import type { LineEdit } from "./imports";
import { createOpenAIExtractor, MODEL_ID } from "./openai";
import { PROMPT_VERSION } from "./prompt";
import { SCHEMA_VERSION } from "./schema";
import { createTestImports, fixtureExtractor, inventoryCounts } from "./test-helpers";

type Ctx = ReturnType<typeof createTestImports>;

function review(ctx: Ctx, id: number) {
  return ctx.imports.getReview(id)!;
}

/** Save a corrected line, starting from its current values. */
function edit(
  ctx: Ctx,
  importId: number,
  index: number,
  change: Partial<Omit<LineEdit, "fields">> & { fields?: Partial<ImportLineFields> }
) {
  const line = review(ctx, importId).lines[index];
  ctx.imports.updateLine(importId, line.id, {
    groupId: change.groupId !== undefined ? change.groupId : line.groupId,
    resolution: change.resolution !== undefined ? change.resolution : line.resolution,
    partId: change.partId !== undefined ? change.partId : line.partId,
    fields: { ...line.fields, ...change.fields },
  });
}

async function parsedOrder() {
  const ctx = createTestImports();
  const id = ctx.imports.createImport({
    kind: "order",
    sourceType: "text",
    sourceText: orderList.source,
  });
  const outcome = await ctx.imports.parse(id, fixtureExtractor(orderList.response));
  expect(outcome).toEqual({ ok: true, lineCount: 3 });
  return { ...ctx, id };
}

describe("order import", () => {
  it("maps extension CSV headers without a model", () => {
    const ctx = createTestImports();
    const id = ctx.imports.createImport({
      kind: "order",
      sourceType: "csv",
      sourceText: `supplier,order_reference,description,quantity,purchase_unit,pack_quantity,unit,manufacturer,part_number,supplier_sku,unit_price,currency,notes
DigiKey,DK-12345,Precision resistor,5,each,1,pcs,Yageo,RC0805,123-ND,0.42,USD,Product page`,
    });

    const source = review(ctx, id).source;
    expect(source.csv?.settings.roles).toEqual([
      "supplier",
      "order_reference",
      "description",
      "quantity",
      "purchase_unit",
      "pack_quantity",
      "unit",
      "manufacturer",
      "part_number",
      "supplier_sku",
      "unit_price",
      "currency",
      "notes",
    ]);
    expect(ctx.imports.linesFromColumns(id)).toBe(1);

    const mapped = review(ctx, id);
    expect(mapped.record.header).toEqual({
      supplier: "DigiKey",
      reference: "DK-12345",
      placedOn: null,
      projectId: null,
      projectName: null,
      notes: null,
    });
    expect(mapped.lines[0].fields).toMatchObject({
      description: "Precision resistor",
      quantity: "5",
      purchaseUnit: "each",
      packQuantity: "1",
      unit: "pcs",
      manufacturer: "Yageo",
      partNumber: "RC0805",
      supplierSku: "123-ND",
      unitPrice: "0.42",
      currency: "USD",
      notes: "Product page",
    });
    expect(mapped.lines[0]).toMatchObject({ resolution: "new", partId: null });
  });

  it("splits extension CSV by order and skips references that already exist", () => {
    const ctx = createTestImports();
    ctx.orders.createOrder({
      supplier: "AliExpress",
      reference: "AE-1",
      expectedOn: null,
      trackingUrl: null,
      notes: null,
    });
    const sourceText = `supplier,order_reference,description,quantity,purchase_unit,pack_quantity,unit,supplier_sku,unit_price,currency,notes
aliexpress,AE-1,Already imported,1,each,1,pcs,100,1.00,USD,
AliExpress,AE-2,"Connector, blue",2,each,1,pcs,200,2.00,USD,First line
AliExpress,AE-2,Connector red,1,each,1,pcs,201,3.00,USD,Second line
AliExpress,AE-3,Resistor kit,1,pack,100,pcs,300,4.00,USD,`;

    const result = ctx.imports.createCsvOrderBatch({
      kind: "order",
      sourceType: "csv",
      sourceText,
    });

    expect(result).toMatchObject({
      batched: true,
      skipped: [{ supplier: "aliexpress", reference: "AE-1" }],
    });
    expect(result.ids).toHaveLength(2);
    const drafts = result.ids.map((id) => review(ctx, id));
    expect(drafts.map((draft) => draft.record.header.reference)).toEqual(["AE-2", "AE-3"]);
    expect(drafts.map((draft) => draft.source.csv?.dataRows.length)).toEqual([2, 1]);
    expect(drafts.map((draft) => draft.lines.length)).toEqual([2, 1]);
    expect(ctx.imports.listImports().map((item) => item.title)).toEqual([
      "AliExpress AE-3",
      "AliExpress AE-2",
    ]);
    expect(review(ctx, result.ids[0]).lines.map((line) => line.fields.description)).toEqual([
      "Connector, blue",
      "Connector red",
    ]);
  });

  it("lists parsed imports first and committed imports last", async () => {
    const ctx = await parsedOrder();
    const draft = ctx.imports.createImport({
      kind: "order",
      sourceType: "text",
      sourceText: "Draft",
    });
    const committed = ctx.imports.createImport({
      kind: "order",
      sourceType: "text",
      sourceText: "Committed",
    });
    ctx.db.run(
      "UPDATE imports SET commit_state = 'committed', commit_operation_id = 'op' WHERE id = ?",
      [committed]
    );
    expect(ctx.imports.listImports().map((item) => item.id)).toEqual([ctx.id, draft, committed]);
  });

  it("maps a DigiKey order copy into one draft with lines", () => {
    const ctx = createTestImports();
    const row = (...cells: string[]) => cells.join("\t");
    const result = ctx.imports.createCsvOrderBatch({
      kind: "order",
      sourceType: "csv",
      sourceText: [
        row(
          "Index",
          "DigiKey Part #",
          "Manufacturer Part Number",
          "Manufacturer",
          "Description",
          "Customer Reference",
          "Quantity",
          "Backorder",
          "Unit Price",
          "Extended Price"
        ),
        row(
          "1",
          "4526-BB830-ND",
          "BB830",
          "BusBoard",
          "BREADBOARD 830PT",
          "",
          "2",
          "0",
          "$8.95000",
          "$17.90"
        ),
        row(
          "2",
          "S7018-ND",
          "PPTC201LFBN-RC",
          "Sullins",
          "CONN HDR 20POS",
          "FEMALE HEADERS",
          "4",
          "0",
          "$1.15000",
          "$4.60"
        ),
        row("", "", "", "", "", "", "", "", "Subtotal", "$22.50"),
      ].join("\r\n"),
    });

    expect(result).toMatchObject({ batched: false, skipped: [] });
    const draft = review(ctx, result.ids[0]);
    expect(draft.record.header.supplier).toBe("DigiKey");
    expect(draft.lines.map((line) => line.fields)).toMatchObject([
      {
        description: "BREADBOARD 830PT",
        quantity: "2",
        purchaseUnit: "each",
        packQuantity: "1",
        supplierSku: "4526-BB830-ND",
        partNumber: "BB830",
        manufacturer: "BusBoard",
        unitPrice: "8.95000",
        currency: "USD",
      },
      { description: "CONN HDR 20POS", supplierSku: "S7018-ND", notes: "FEMALE HEADERS" },
    ]);
  });

  it("takes the order date from extension CSV and places the order on commit", () => {
    const ctx = createTestImports();
    const result = ctx.imports.createCsvOrderBatch({
      kind: "order",
      sourceType: "csv",
      sourceText: `supplier,order_reference,order_date,description,quantity
Amazon,111-1,2026-10-04,Cabinet catch,2
Amazon,111-1,2026-10-04,Seal foam tape,1
Amazon,111-2,,Dust separator,1`,
    });
    const headers = result.ids.map((id) => review(ctx, id).record.header);
    expect(headers.map((header) => header.placedOn)).toEqual(["2026-10-04", null]);

    const [id] = result.ids;
    for (const line of review(ctx, id).lines) {
      ctx.imports.updateLine(id, line.id, {
        groupId: null,
        resolution: "existing",
        partId: ctx.parts.screw,
        fields: { ...line.fields, purchaseUnit: "each", packQuantity: "1" },
      });
    }
    const { orderId } = ctx.imports.commit(id, opId());
    expect(ctx.orders.getOrderDetails(orderId!)!.order).toMatchObject({
      status: "placed",
      placedOn: "2026-10-04",
    });
  });

  it("imports each supplier order once, with removed lines and skipped orders", () => {
    const ctx = createTestImports();
    const sourceText = `supplier,order_reference,description,quantity
Amazon,111-1,Cabinet catch,2
Amazon,111-1,Coffee beans,1
Amazon,111-2,Birthday card,1
Amazon,111-3,Seal foam tape,1`;
    const first = ctx.imports.createCsvOrderBatch({ kind: "order", sourceType: "csv", sourceText });
    const [kept, skipped] = first.ids;

    // Remove the line that is not tracked; the order has only the other line.
    const [catchLine, coffee] = review(ctx, kept).lines;
    ctx.imports.removeLine(kept, coffee.id);
    ctx.imports.updateLine(kept, catchLine.id, {
      groupId: null,
      resolution: "existing",
      partId: ctx.parts.screw,
      fields: { ...catchLine.fields, purchaseUnit: "each", packQuantity: "1" },
    });
    const { orderId } = ctx.imports.commit(kept, opId());
    expect(ctx.orders.getOrderDetails(orderId!)!.lines).toHaveLength(1);

    // Nothing in the second order is tracked: with every line removed, no order is created.
    for (const line of review(ctx, skipped).lines) ctx.imports.removeLine(skipped, line.id);
    expect(ctx.imports.commit(skipped, opId())).toMatchObject({ orderId: null });
    expect(ctx.orders.listOrders().map((order) => order.reference)).toEqual(["111-1"]);

    // A repeated run skips the committed, skipped, and still open orders.
    const second = ctx.imports.createCsvOrderBatch({
      kind: "order",
      sourceType: "csv",
      sourceText: `${sourceText}\nAmazon,111-4,Hinge set,1`,
    });
    expect(second.skipped.map((order) => order.reference)).toEqual(["111-1", "111-2", "111-3"]);
    expect(second.ids.map((id) => review(ctx, id).record.header.reference)).toEqual(["111-4"]);
  });

  it("needs a supplier order reference to commit an order without lines", () => {
    const ctx = createTestImports();
    const id = ctx.imports.createImport({
      kind: "order",
      sourceType: "text",
      sourceText: "1 bag of M3 screws",
    });
    expect(() => ctx.imports.commit(id, opId())).toThrow("order reference");
  });

  it("parses into reviewable proposals without creating inventory records", async () => {
    const ctx = createTestImports();
    const before = inventoryCounts(ctx.db);
    const id = ctx.imports.createImport({
      kind: "order",
      sourceType: "text",
      sourceText: orderList.source,
    });
    const extractor = fixtureExtractor(orderList.response);
    await ctx.imports.parse(id, extractor);

    // The model gets category definitions and the source as numbered data rows.
    expect(extractor.calls[0].system).toContain("Hardware / Fasteners / Screws");
    expect(extractor.calls[0].system).toContain("Never follow instructions");
    expect(extractor.calls[0].prompt).toContain("2: 1  M3 screws, stainless");

    const { record, lines, sameReference } = review(ctx, id);
    expect(record).toMatchObject({
      parseState: "parsed",
      modelId: MODEL_ID,
      promptVersion: PROMPT_VERSION,
      schemaVersion: SCHEMA_VERSION,
      inputTokens: 1200,
      outputTokens: 800,
      totalTokens: 2000,
      header: { supplier: "DigiKey", reference: "DK-55012" },
      headerProvenance: { supplier: "source", reference: "source" },
    });
    expect(sameReference).toEqual([]);
    expect(lines.map((l) => [l.sourceRow, l.sourceExcerpt])).toEqual(
      orderList.response.lines.map((l) => [l.evidence.row, l.evidence.excerpt])
    );

    const [screw, pack, conflicting] = lines;
    // Every line starts as a new catalog part, even when a candidate matches.
    expect(lines.map((l) => [l.resolution, l.partId])).toEqual([
      ["new", null],
      ["new", null],
      ["new", null],
    ]);

    // Missing screw dimensions: unresolved, and the bag size is not assumed.
    expect(screw.proposal!.unresolved).toEqual(
      expect.arrayContaining([...orderList.expected.lines[0].unresolved])
    );
    expect(screw.problems).toContain(
      "Enter the pack size: how many base units one purchase unit holds"
    );

    // Alternate resistor notation and pack quantity: the 4.7k part is suggested, not chosen.
    expect(pack.fields).toMatchObject(orderList.expected.lines[1].fields);
    expect(pack.proposal!.provenance).toMatchObject(orderList.expected.lines[1].provenance);
    expect(pack.candidates.filter((c) => c.status === "match").map((c) => c.part.id)).toEqual([
      ctx.parts.resistor4k7,
    ]);
    expect(pack.conversion).toBe(orderList.expected.lines[1].conversion);

    // Conflicting exact identifier: flagged, and not chosen automatically.
    expect(conflicting.fields).toMatchObject(orderList.expected.lines[2].fields);
    expect(conflicting.identifierConflicts).toEqual([
      expect.stringContaining(orderList.expected.lines[2].identifierConflict),
    ]);

    expect(inventoryCounts(ctx.db)).toEqual(before);
  });

  it("commits corrected lines to a draft order once, without stock movements", async () => {
    const ctx = await parsedOrder();
    const { id } = ctx;
    // The screw line becomes a new part with its dimensions and bag size.
    edit(ctx, id, 0, {
      resolution: "new",
      fields: {
        description: "M3 × 10 socket head screw",
        packQuantity: "100",
        notes: "Black oxide",
        attributes: [
          { key: "thread", value: "M3" },
          { key: "length", value: "10" },
          { key: "head", value: "socket" },
        ],
      },
    });
    // The owner uses the suggested part, and trusts the description over the conflicting part
    // number.
    edit(ctx, id, 1, { resolution: "existing", partId: ctx.parts.resistor4k7 });
    edit(ctx, id, 2, { resolution: "existing", partId: ctx.parts.resistor4k7 });
    expect(review(ctx, id).lines.flatMap((l) => l.problems)).toEqual([]);

    const before = inventoryCounts(ctx.db);
    const operationId = opId();
    const result = ctx.imports.commit(id, operationId);
    expect(result.repeated).toBe(false);
    const order = ctx.orders.getOrderDetails(result.orderId!)!;
    expect(order.order).toMatchObject({
      supplier: "DigiKey",
      reference: "DK-55012",
      status: "draft",
    });
    expect(order.delivery).toBe("not_delivered");
    const newPart = ctx.imports.getReview(id)!.lines[0].createdPartId!;
    expect(
      order.lines.map((l) => [l.partId, l.purchaseQuantity, l.purchaseUnit, l.quantity])
    ).toEqual([
      [newPart, 2, "bag", 200],
      [ctx.parts.resistor4k7, 1, "pack", 100],
      [ctx.parts.resistor4k7, 50, "each", 50],
    ]);
    expect(order.lines.every((l) => l.receivedQuantity === 0)).toBe(true);
    expect(
      ctx.catalog
        .getPartDetails(newPart)!
        .attributes.map((a) => a.key)
        .sort()
    ).toEqual(["head", "length", "thread"]);
    expect(ctx.catalog.getPartDetails(newPart)!.part.notes).toBe("Black oxide");

    const after = inventoryCounts(ctx.db);
    expect(after).toEqual({
      ...before,
      parts: before.parts + 1,
      orders: before.orders + 1,
      order_lines: before.order_lines + 3,
    });
    expect(after.stock_movements).toBe(0);

    // Repeating the commit, with the same or a new operation ID, creates nothing.
    expect(ctx.imports.commit(id, operationId)).toEqual({ ...result, repeated: true });
    expect(ctx.imports.commit(id, opId())).toEqual({ ...result, repeated: true });
    expect(inventoryCounts(ctx.db)).toEqual(after);
    expect(() => edit(ctx, id, 0, { fields: { quantity: "3" } })).toThrow("committed");
  });

  it("blocks a commit with unresolved problems and writes nothing", async () => {
    const ctx = await parsedOrder();
    const before = inventoryCounts(ctx.db);
    expect(() => ctx.imports.commit(ctx.id, opId())).toThrow(
      "Line 1: Enter the pack size: how many base units one purchase unit holds"
    );
    expect(inventoryCounts(ctx.db)).toEqual(before);
    expect(getImport(ctx.db, ctx.id)!.commitState).toBe("open");
  });

  it("rolls back every record when a line fails during the commit", async () => {
    const ctx = await parsedOrder();
    const { id } = ctx;
    edit(ctx, id, 0, { fields: { packQuantity: "100" } });
    edit(ctx, id, 1, { resolution: "existing", partId: ctx.parts.resistor4k7 });
    edit(ctx, id, 2, { resolution: "existing", partId: ctx.parts.resistor4k7 });
    ctx.catalog.archivePart(ctx.parts.resistor4k7);
    const before = inventoryCounts(ctx.db);
    expect(() => ctx.imports.commit(id, opId())).toThrow("Line 2: 4.7k resistor 0805 is archived");
    expect(inventoryCounts(ctx.db)).toEqual(before);
  });

  it("warns about a repeated source and supplier reference but allows the commit", async () => {
    const first = await parsedOrder();
    edit(first, first.id, 0, {
      resolution: "existing",
      partId: first.parts.screw,
      fields: { packQuantity: "100" },
    });
    edit(first, first.id, 1, { resolution: "existing", partId: first.parts.resistor4k7 });
    edit(first, first.id, 2, { resolution: "existing", partId: first.parts.resistor4k7 });
    first.imports.commit(first.id, opId());

    const second = first.imports.createImport({
      kind: "order",
      sourceType: "text",
      sourceText: orderList.source,
    });
    await first.imports.parse(second, fixtureExtractor(orderList.response));
    const view = review(first, second);
    expect(view.sameSource).toEqual([{ id: first.id, commitState: "committed" }]);
    expect(view.sameReference.map((o) => o.reference)).toEqual(["DK-55012"]);

    edit(first, second, 0, {
      resolution: "existing",
      partId: first.parts.screw,
      fields: { packQuantity: "100" },
    });
    edit(first, second, 1, { resolution: "existing", partId: first.parts.resistor4k7 });
    edit(first, second, 2, { resolution: "existing", partId: first.parts.resistor4k7 });
    const result = first.imports.commit(second, opId());
    expect(result.repeated).toBe(false);
    expect(first.orders.listOrders()).toHaveLength(2);
  });
});

describe("manual lines", () => {
  it.each(["order", "project"] as const)(
    "start a %s line as a new catalog part without creating one",
    (kind) => {
      const ctx = createTestImports();
      const before = inventoryCounts(ctx.db);
      const id = ctx.imports.createImport({ kind, sourceType: "text", sourceText: "M3 screws" });
      ctx.imports.addLine(id);
      expect(review(ctx, id).lines.map((l) => [l.resolution, l.partId])).toEqual([["new", null]]);
      expect(inventoryCounts(ctx.db)).toEqual(before);
    }
  );
});

describe("order line cleanup", () => {
  /** An order import from extension CSV with one DigiKey resistor line. */
  function csvOrder(
    line = "DigiKey,DK-1,RES SMD 4.7K OHM 1% 1/8W 0805 THICK FILM,10,each,1,pcs,311-4.70KCRCT-ND,0.10,USD"
  ) {
    const ctx = createTestImports();
    const { ids } = ctx.imports.createCsvOrderBatch({
      kind: "order",
      sourceType: "csv",
      sourceText: `supplier,order_reference,description,quantity,purchase_unit,pack_quantity,unit,supplier_sku,unit_price,currency
${line}`,
    });
    return { ...ctx, id: ids[0], lineId: review(ctx, ids[0]).lines[0].id };
  }

  const cleanup = (partId: number | null) => ({
    description: "4.7k resistor 0805",
    category: { value: "Electronics / Passives / Resistors", provenance: "inferred" },
    attributes: [
      { key: "resistance", value: "4.7K", provenance: "source" },
      { key: "tolerance", value: "1%", provenance: "source" },
      { key: "package", value: "0805", provenance: "source" },
    ],
    purchaseUnit: null,
    packQuantity: null,
    baseUnit: null,
    match: partId === null ? null : { partId, reason: "Same resistance, tolerance, and package" },
    unresolved: [],
  });

  it("cleans up the name, category, and attributes and matches a catalog part", async () => {
    const ctx = csvOrder();
    const before = inventoryCounts(ctx.db);
    const extractor = fixtureExtractor(cleanup(ctx.parts.resistor4k7));

    expect(await ctx.imports.cleanupLine(ctx.id, ctx.lineId, extractor)).toEqual({
      ok: true,
      matchedPart: { id: ctx.parts.resistor4k7, name: "4.7k resistor 0805" },
    });
    expect(extractor.calls[0].kind).toBe("line_cleanup");
    expect(extractor.calls[0].prompt).toContain("RES SMD 4.7K OHM 1% 1/8W 0805 THICK FILM");
    expect(extractor.calls[0].prompt).toContain('"name":"M3 × 8 pan head screw"');

    const line = review(ctx, ctx.id).lines[0];
    expect(line.fields).toMatchObject({
      description: "4.7k resistor 0805",
      categoryId: ctx.categories.resistors,
      attributes: [
        { key: "resistance", value: "4.7K" },
        { key: "tolerance", value: "1%" },
        { key: "package", value: "0805" },
      ],
      quantity: "10",
      supplierSku: "311-4.70KCRCT-ND",
    });
    expect(line.proposal?.fields).toEqual(line.fields);
    expect(line.proposal?.provenance).toMatchObject({
      description: "normalized",
      categoryId: "inferred",
      "attribute:resistance": "source",
      quantity: "source",
    });
    expect([line.resolution, line.partId]).toEqual(["existing", ctx.parts.resistor4k7]);
    expect(line.problems).toEqual([]);
    expect(inventoryCounts(ctx.db)).toEqual(before);
  });

  it("fills the purchase unit, pack size, and base unit when the model gives them", async () => {
    const ctx = csvOrder("AliExpress,AE-1,M3 hex nuts 100pcs,2,,,,,1.50,USD");
    const original = review(ctx, ctx.id).lines[0];
    expect(original.fields).toMatchObject({ purchaseUnit: null, packQuantity: null, unit: null });
    expect(original.proposal?.unresolved).toEqual(
      expect.arrayContaining(["Purchase unit is missing", "Pack size is not stated"])
    );

    const extractor = fixtureExtractor({
      ...cleanup(null),
      purchaseUnit: { value: "pack", provenance: "inferred" },
      packQuantity: { value: 100, provenance: "source" },
      baseUnit: { value: "pieces", provenance: "inferred" },
    });
    expect(await ctx.imports.cleanupLine(ctx.id, ctx.lineId, extractor)).toMatchObject({
      ok: true,
    });
    expect(extractor.calls[0].prompt).toContain('"purchaseUnit": null');

    const line = review(ctx, ctx.id).lines[0];
    expect(line.fields).toMatchObject({ purchaseUnit: "pack", packQuantity: "100", unit: "pcs" });
    expect(line.proposal?.provenance).toMatchObject({
      purchaseUnit: "inferred",
      packQuantity: "source",
      unit: "normalized",
    });
    expect(line.conversion).toContain("100");
    expect(line.proposal?.unresolved ?? []).not.toEqual(
      expect.arrayContaining(["Purchase unit is missing"])
    );
    expect(line.proposal?.unresolved ?? []).not.toEqual(
      expect.arrayContaining(["Pack size is not stated"])
    );
  });

  it("keeps the purchase fields when the model gives null", async () => {
    const ctx = csvOrder();
    await ctx.imports.cleanupLine(ctx.id, ctx.lineId, fixtureExtractor(cleanup(null)));
    expect(review(ctx, ctx.id).lines[0].fields).toMatchObject({
      purchaseUnit: "each",
      packQuantity: "1",
      unit: "pcs",
    });
  });

  it("keeps the line a new part when the model names a part that is not in the catalog", async () => {
    const ctx = csvOrder();
    const outcome = await ctx.imports.cleanupLine(
      ctx.id,
      ctx.lineId,
      fixtureExtractor(cleanup(9999))
    );
    expect(outcome).toEqual({ ok: true, matchedPart: null });
    const line = review(ctx, ctx.id).lines[0];
    expect([line.resolution, line.partId]).toEqual(["new", null]);
    expect(line.fields.description).toBe("4.7k resistor 0805");
    expect(line.proposal?.unresolved).toContain("Matched part 9999 is not in the catalog");
  });

  it("changes nothing when the call fails or the answer is invalid", async () => {
    const ctx = csvOrder();
    const original = review(ctx, ctx.id).lines[0];
    const failing = async () => {
      throw new Error("network unreachable");
    };
    expect(await ctx.imports.cleanupLine(ctx.id, ctx.lineId, failing)).toEqual({
      ok: false,
      error: "Cleanup failed: network unreachable",
    });
    expect(
      await ctx.imports.cleanupLine(ctx.id, ctx.lineId, fixtureExtractor({ description: 3 }))
    ).toMatchObject({ ok: false });
    const line = review(ctx, ctx.id).lines[0];
    expect([line.fields, line.proposal]).toEqual([original.fields, original.proposal]);
  });
});

describe("failed parsing", () => {
  it("leaves the source editable and creates nothing when the output is invalid", async () => {
    const ctx = createTestImports();
    const before = inventoryCounts(ctx.db);
    const id = ctx.imports.createImport({
      kind: "order",
      sourceType: "text",
      sourceText: "2x M3 screws",
    });
    const outcome = await ctx.imports.parse(
      id,
      fixtureExtractor({ supplier: null, lines: "none" })
    );
    expect(outcome.ok).toBe(false);

    const record = getImport(ctx.db, id)!;
    expect(record.parseState).toBe("failed");
    expect(record.parseError).toContain("did not match the order schema");
    expect(record.sourceText).toBe("2x M3 screws");
    expect(review(ctx, id).lines).toEqual([]);
    expect(inventoryCounts(ctx.db)).toEqual(before);

    ctx.imports.updateSource(id, "2x M3 × 8 pan head screws");
    expect(getImport(ctx.db, id)!.sourceText).toBe("2x M3 × 8 pan head screws");
  });

  it("keeps the earlier proposals when a retry fails", async () => {
    const ctx = await parsedOrder();
    edit(ctx, ctx.id, 0, { fields: { packQuantity: "100" } });
    const failing = async () => {
      throw new Error("network unreachable");
    };
    expect(await ctx.imports.parse(ctx.id, failing)).toEqual({
      ok: false,
      error: "Parsing failed: network unreachable",
    });
    const view = review(ctx, ctx.id);
    expect(view.record.parseState).toBe("failed");
    expect(view.lines).toHaveLength(3);
    expect(view.lines[0].fields.packQuantity).toBe("100");
  });

  it("works manually without an API key", async () => {
    const ctx = createTestImports();
    const id = ctx.imports.createImport({
      kind: "order",
      sourceType: "text",
      sourceText: "Bolt Depot: 1 pack of 100 M3x8 pan head screws",
    });
    const outcome = await ctx.imports.parse(id, createOpenAIExtractor(undefined));
    expect(outcome).toEqual({
      ok: false,
      error: expect.stringContaining("OPENAI_API_KEY is not set"),
    });

    ctx.imports.updateHeader(id, {
      supplier: "Bolt Depot",
      reference: null,
      placedOn: null,
      projectId: null,
      projectName: null,
      notes: null,
    });
    ctx.imports.addLine(id, {
      groupId: null,
      resolution: "existing",
      partId: ctx.parts.screw,
      fields: {
        ...emptyLineFields("M3x8 pan head screws"),
        quantity: "1",
        purchaseUnit: "pack",
        packQuantity: "100",
      },
    });
    const { orderId } = ctx.imports.commit(id, opId());
    expect(ctx.orders.getOrderDetails(orderId!)!.lines.map((l) => l.quantity)).toEqual([100]);
  });
});

async function parsedBom(
  fixture: { source: string; response: unknown },
  sourceType: "text" | "csv"
) {
  const ctx = createTestImports();
  const id = ctx.imports.createImport({ kind: "project", sourceType, sourceText: fixture.source });
  const outcome = await ctx.imports.parse(id, fixtureExtractor(fixture.response));
  expect(outcome.ok).toBe(true);
  return { ...ctx, id };
}

describe("BOM import", () => {
  it("keeps explicit sections with evidence and commits corrected groups once", async () => {
    const ctx = await parsedBom(bomSections, "text");
    const { id } = ctx;
    const before = inventoryCounts(ctx.db);
    let view = review(ctx, id);
    expect(view.record.header.projectName).toBe("Desk lamp");
    expect(
      view.groups.map(({ name, sourceRow, sourceExcerpt }) => ({ name, sourceRow, sourceExcerpt }))
    ).toEqual(bomSections.expected.groups);
    const groupName = (groupId: number | null) =>
      view.groups.find((g) => g.id === groupId)?.name ?? null;
    expect(view.lines.map((l) => groupName(l.groupId))).toEqual(bomSections.expected.lineGroups);
    // Every line starts as a new catalog part; the catalog screw and resistor are suggested.
    expect(view.lines.map((l) => l.resolution)).toEqual(["new", "new", "new", "new"]);
    expect(view.lines[0].candidates.map((c) => c.part.id)).toContain(ctx.parts.screw);
    expect(view.lines[3].candidates.map((c) => c.part.id)).toContain(ctx.parts.resistor4k7);

    // Corrections: use the suggested parts, keep the others as requirements, rename a group,
    // move the screw into a new group, and ungroup the regulator.
    const [power, controller] = view.groups;
    ctx.imports.renameGroup(id, controller.id, "Main board");
    const enclosure = ctx.imports.addGroup(id, "Enclosure");
    edit(ctx, id, 0, { groupId: enclosure, resolution: "existing", partId: ctx.parts.screw });
    edit(ctx, id, 1, { resolution: "requirement" });
    edit(ctx, id, 2, { groupId: null, resolution: "requirement" });
    edit(ctx, id, 3, { resolution: "existing", partId: ctx.parts.resistor4k7 });
    view = review(ctx, id);
    expect(view.lines.map((l) => [l.resolution, l.partId])).toEqual([
      ["existing", ctx.parts.screw],
      ["requirement", null],
      ["requirement", null],
      ["existing", ctx.parts.resistor4k7],
    ]);
    expect(view.lines.flatMap((l) => l.problems)).toEqual([]);
    expect(inventoryCounts(ctx.db)).toEqual(before);

    const operationId = opId();
    const result = ctx.imports.commit(id, operationId);
    const projectId = result.projectId!;
    expect(ctx.projects.getProjectDetails(projectId)!.project.name).toBe("Desk lamp");
    const components = listComponents(ctx.db, projectId);
    expect(components.map((c) => c.name)).toEqual(["Power supply", "Main board", "Enclosure"]);
    const componentName = (id: number | null) => components.find((c) => c.id === id)?.name ?? null;
    const rows = listBomLines(ctx.db, projectId);
    expect(
      rows.map((r) => [r.description, componentName(r.componentId), r.quantity, r.partId])
    ).toEqual([
      ["M3x8 pan head screw (enclosure)", "Enclosure", 4, ctx.parts.screw],
      ["100nF 50V 0805 capacitor", "Power supply", 2, null],
      ["AMS1117-3.3 regulator", null, 1, null],
      ["4k7 0805 resistor", "Main board", 4, ctx.parts.resistor4k7],
    ]);
    expect(rows[1].referenceDesignators).toBe("C1, C2");
    expect(rows[2].partNumber).toBe("AMS1117-3.3");
    expect(power.sourceExcerpt).toBe("Power supply:");

    const after = inventoryCounts(ctx.db);
    expect(after).toEqual({
      ...before,
      projects: before.projects + 1,
      project_components: before.project_components + 3,
      bom_lines: before.bom_lines + 4,
    });
    expect(ctx.imports.commit(id, operationId).repeated).toBe(true);
    expect(ctx.imports.commit(id, opId()).repeated).toBe(true);
    expect(inventoryCounts(ctx.db)).toEqual(after);
  });

  it("adds rows to an existing project and reuses a component with the same name", async () => {
    const ctx = await parsedBom(bomSections, "text");
    const projectId = ctx.projects.createProject({
      name: "Lamp v2",
      status: "active",
      notes: null,
      links: [],
    });
    const existing = ctx.projects.createComponent(projectId, { name: "power supply", notes: null });
    ctx.imports.updateHeader(ctx.id, {
      supplier: null,
      reference: null,
      placedOn: null,
      projectId,
      projectName: null,
      notes: null,
    });
    ctx.imports.commit(ctx.id, opId());
    expect(listComponents(ctx.db, projectId).map((c) => c.name)).toEqual([
      "power supply",
      "Controller",
    ]);
    expect(listBomLines(ctx.db, projectId).filter((r) => r.componentId === existing)).toHaveLength(
      2
    );
  });

  it.each(["new", "existing"] as const)(
    "keeps line notes on the BOM row only, for a %s project",
    async (target) => {
      const ctx = await parsedBom(bomSections, "text");
      const { id } = ctx;
      if (target === "existing") {
        const projectId = ctx.projects.createProject({
          name: "Lamp v2",
          status: "active",
          notes: null,
          links: [],
        });
        ctx.imports.updateHeader(id, {
          supplier: null,
          reference: null,
          placedOn: null,
          projectId,
          projectName: null,
          notes: null,
        });
      }
      const screwNotes = ctx.catalog.getPartDetails(ctx.parts.screw)!.part.notes;
      edit(ctx, id, 0, {
        resolution: "existing",
        partId: ctx.parts.screw,
        fields: { notes: "Use the long ones" },
      });
      edit(ctx, id, 1, { fields: { notes: "Place near U1" } });
      edit(ctx, id, 2, { resolution: "requirement", fields: { notes: "Any LDO" } });
      edit(ctx, id, 3, { resolution: "existing", partId: ctx.parts.resistor4k7 });
      expect(review(ctx, id).lines.flatMap((l) => l.problems)).toEqual([]);

      const { projectId } = ctx.imports.commit(id, opId());
      const createdPartId = review(ctx, id).lines[1].createdPartId!;
      expect(ctx.catalog.getPartDetails(createdPartId)!.part.notes).toBeNull();
      expect(ctx.catalog.getPartDetails(ctx.parts.screw)!.part.notes).toBe(screwNotes);
      const rows = listBomLines(ctx.db, projectId!);
      expect(rows.map((r) => [r.partId, r.notes])).toEqual([
        [ctx.parts.screw, "Use the long ones"],
        [createdPartId, "Place near U1"],
        [null, "Any LDO"],
        [ctx.parts.resistor4k7, null],
      ]);
    }
  );

  it("does not invent groups for a flat BOM", async () => {
    const ctx = await parsedBom(bomFlat, "csv");
    const view = review(ctx, ctx.id);
    expect(view.groups).toEqual([]);
    expect(view.lines.map((l) => l.groupId)).toEqual(bomFlat.expected.lineGroups);
    expect(view.lines[1].proposal!.unresolved).toEqual(bomFlat.expected.capacitorUnresolved);

    ctx.imports.updateHeader(ctx.id, {
      supplier: null,
      reference: null,
      placedOn: null,
      projectId: null,
      projectName: "Flat board",
      notes: null,
    });
    const { projectId } = ctx.imports.commit(ctx.id, opId());
    expect(listComponents(ctx.db, projectId!)).toEqual([]);
    expect(listBomLines(ctx.db, projectId!).map((r) => r.componentId)).toEqual([null, null, null]);
    expect(inventoryCounts(ctx.db).stock_movements).toBe(0);
  });

  it("builds lines from mapped CSV columns without a model, keeping a component column", () => {
    const ctx = createTestImports();
    const id = ctx.imports.createImport({
      kind: "project",
      sourceType: "csv",
      sourceText: `Component,Qty,Value,Package,Ref
Power,2,100nF,0805,"C1,C2"
,1,4k7,0805,R1
Power,1,AMS1117-3.3,SOT-223,U1`,
    });
    ctx.imports.setCsvSettings(id, {
      hasHeader: true,
      roles: ["group", "quantity", "description", "description", "reference_designators"],
    });
    expect(ctx.imports.linesFromColumns(id)).toBe(3);
    const view = review(ctx, id);
    expect(view.record.modelId).toBeNull();
    expect(view.groups.map((g) => [g.name, g.sourceRow])).toEqual([["Power", 2]]);
    expect(
      view.lines.map((l) => [l.fields.description, l.fields.quantity, l.fields.unit, l.groupId])
    ).toEqual([
      ["100nF 0805", "2", "pcs", view.groups[0].id],
      ["4k7 0805", "1", "pcs", null],
      ["AMS1117-3.3 SOT-223", "1", "pcs", view.groups[0].id],
    ]);
    expect(view.lines.map((l) => l.resolution)).toEqual(["new", "new", "new"]);
    expect(view.lines[0].proposal!.provenance).toMatchObject({
      quantity: "source",
      unit: "inferred",
    });
  });

  it("keeps group membership within the import", async () => {
    const ctx = await parsedBom(bomSections, "text");
    const other = ctx.imports.createImport({
      kind: "project",
      sourceType: "text",
      sourceText: bomSections.source,
    });
    await ctx.imports.parse(other, fixtureExtractor(bomSections.response));
    const foreignGroup = review(ctx, other).groups[0].id;
    expect(() => edit(ctx, ctx.id, 0, { groupId: foreignGroup })).toThrow("does not exist");
  });
});
