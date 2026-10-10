import { describe, expect, it } from "vitest";
import { parseOrderLineForm } from "./order";

function lineForm(fields: Record<string, string>) {
  const form = new FormData();
  const values = {
    part_id: "7",
    purchase_quantity: "2",
    purchase_unit: "each",
    pack_quantity: "1",
  };
  for (const [name, value] of Object.entries({ ...values, ...fields })) form.set(name, value);
  return form;
}

describe("order line form piece size", () => {
  it("is null when it is empty", () => {
    expect(parseOrderLineForm(lineForm({}))).toMatchObject({
      success: true,
      data: { pieceLengthMm: null, pieceWidthMm: null },
    });
  });

  it("reads a bare number in the piece unit, and text with a unit as entered", () => {
    expect(parseOrderLineForm(lineForm({ piece_length: "500" }))).toMatchObject({
      data: { pieceLengthMm: 500, pieceWidthMm: null },
    });
    expect(
      parseOrderLineForm(lineForm({ piece_unit: "in", piece_length: "12", piece_width: "100 mm" }))
    ).toMatchObject({ data: { pieceLengthMm: 304.8, pieceWidthMm: 100 } });
  });

  it("rejects a size that is not a length", () => {
    expect(parseOrderLineForm(lineForm({ piece_length: "long" }))).toMatchObject({
      success: false,
      errors: { piece_size: expect.stringMatching(/piece size/) },
    });
  });
});
