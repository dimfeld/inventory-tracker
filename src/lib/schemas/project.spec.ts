import { describe, expect, it } from "vitest";
import { formatLineQuantity } from "#lib/projects.ts";
import { parseBomLineForm } from "./project";

function lineForm(fields: Record<string, string>) {
  const form = new FormData();
  const values = { description: "2020 extrusion", amount: "2", unit: "pcs", ...fields };
  for (const [name, value] of Object.entries(values)) form.set(name, value);
  return form;
}

describe("BOM line form cut size", () => {
  it("reads a bare number in the exact part's display unit, and text with a unit as entered", () => {
    const inches = () => "in" as const;
    const parsed = parseBomLineForm(
      lineForm({ mode: "exact", part_id: "7", cut_length: "16", cut_width: "100 mm" }),
      inches
    );
    expect(parsed).toMatchObject({ success: true, data: { cutLengthMm: 406.4, cutWidthMm: 100 } });
  });

  it("reads mm by default and rejects a value that is not a length", () => {
    expect(parseBomLineForm(lineForm({ cut_length: "415" }))).toMatchObject({
      data: { cutLengthMm: 415, cutWidthMm: null },
    });
    expect(parseBomLineForm(lineForm({ cut_length: "long" }))).toMatchObject({
      success: false,
      errors: { cut_length: "Enter the cut length, such as 415 mm" },
    });
  });

  it("shows a row with a cut size as a count of cut pieces", () => {
    const line = { quantity: 2, unit: "pcs", cutWidthMm: null, pieceDisplayUnit: "mm" as const };
    expect(formatLineQuantity({ ...line, cutLengthMm: 415 })).toBe("2 × 415 mm");
    expect(formatLineQuantity({ ...line, cutLengthMm: null })).toBe("2 pcs");
  });
});
