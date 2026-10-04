import { describe, expect, it } from "vitest";
import { compatibleUnits, toBaseQuantity, UnitError } from "./units";

describe("toBaseQuantity", () => {
  it("converts exactly between compatible units", () => {
    expect(toBaseQuantity("12", "pcs", "pcs")).toBe(12);
    expect(toBaseQuantity("1.5", "m", "mm")).toBe(1500);
    expect(toBaseQuantity("2.5", "m", "cm")).toBe(250);
    expect(toBaseQuantity("0.25", "kg", "g")).toBe(250);
  });

  it("rejects incompatible units", () => {
    expect(() => toBaseQuantity("1", "m", "pcs")).toThrow(UnitError);
    expect(() => toBaseQuantity("1", "g", "mL")).toThrow(/Cannot convert/);
  });

  it("rejects amounts that are not whole base units", () => {
    expect(() => toBaseQuantity("1.5", "pcs", "pcs")).toThrow(/whole number/);
    expect(() => toBaseQuantity("5", "mm", "cm")).toThrow(/whole number/);
  });

  it("rejects invalid amounts", () => {
    expect(() => toBaseQuantity("-1", "pcs", "pcs")).toThrow(UnitError);
    expect(() => toBaseQuantity("abc", "pcs", "pcs")).toThrow(UnitError);
  });

  it("lists compatible units", () => {
    expect(compatibleUnits("mm")).toEqual(["mm", "cm", "m"]);
    expect(compatibleUnits("pcs")).toEqual(["pcs"]);
  });
});
