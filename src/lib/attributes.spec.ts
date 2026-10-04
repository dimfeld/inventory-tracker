import { describe, expect, it } from "vitest";
import {
  expandAttributes,
  formatAttributeValue,
  normalizeAttributeValue,
  parseThreadDesignation,
  type NormalizationRule,
} from "./attributes";

const number = (rule: NormalizationRule, raw: string) =>
  normalizeAttributeValue(rule, raw)?.valueNumber ?? null;
const text = (rule: NormalizationRule, raw: string) =>
  normalizeAttributeValue(rule, raw)?.valueText ?? null;

describe("attribute normalization", () => {
  it("reads equivalent resistance notations as the same number of ohms", () => {
    for (const raw of ["4k7", "4.7k", "4.7 kΩ", "4.7kohm", "4700", "4700 ohm", "4K7"]) {
      expect(number("resistance", raw), raw).toBe(4700);
    }
    expect(number("resistance", "4R7")).toBe(4.7);
    expect(number("resistance", "470R")).toBe(470);
    expect(number("resistance", "2M2")).toBe(2_200_000);
    expect(number("resistance", "0.1")).toBe(0.1);
  });

  it("reads capacitance in exact picofarads", () => {
    expect(number("capacitance", "100nF")).toBe(100_000);
    expect(number("capacitance", "0.1 uF")).toBe(100_000);
    expect(number("capacitance", "4.7µF")).toBe(4_700_000);
    expect(number("capacitance", "4n7")).toBe(4700);
    expect(number("capacitance", "22pF")).toBe(22);
  });

  it("reads voltage, power, tolerance, and pin count", () => {
    expect(number("voltage", "6.3 V")).toBe(6.3);
    expect(number("voltage", "50VDC")).toBe(50);
    expect(number("power", "1/4W")).toBe(0.25);
    expect(number("power", "0.25 W")).toBe(0.25);
    expect(number("power", "250mW")).toBe(0.25);
    expect(number("percent", "1%")).toBe(1);
    expect(number("percent", "±0.1 %")).toBe(0.1);
    expect(number("count", "4")).toBe(4);
    expect(number("count", "4-pin")).toBe(4);
  });

  it("reads lengths in millimetres, including from a thread designation", () => {
    expect(number("length", "8mm")).toBe(8);
    expect(number("length", "2.54 mm")).toBe(2.54);
    expect(number("length", '0.1"')).toBe(2.54);
    expect(number("length", "1.2 cm")).toBe(12);
    expect(number("length", "M3x8")).toBe(8);
  });

  it("normalizes metric threads and splits combined designations", () => {
    for (const raw of ["M3", "m3", "M 3", "M3x0.5", "M3x8", "M3 x 8 mm", "M3x0.5x8"]) {
      expect(text("thread", raw), raw).toBe("M3");
    }
    expect(parseThreadDesignation("M3x8")).toEqual({ thread: "M3", lengthMm: 8 });
    expect(parseThreadDesignation("M3x0.5")).toEqual({ thread: "M3", lengthMm: null });
    expect(parseThreadDesignation("M2.5x6")).toEqual({ thread: "M2.5", lengthMm: 6 });
    expect(text("thread", "#4-40 unc")).toBe("#4-40 UNC");
  });

  it("normalizes text case and spacing", () => {
    expect(text("keyword", "  Stainless   Steel ")).toBe("stainless steel");
    expect(text("code", "sot-23")).toBe("SOT-23");
  });

  it("gives no typed value for text it cannot read", () => {
    expect(normalizeAttributeValue("resistance", "about 5k")).toBeNull();
    expect(normalizeAttributeValue("length", "long")).toBeNull();
    expect(normalizeAttributeValue("capacitance", "")).toBeNull();
  });

  it("formats typed values with readable prefixes", () => {
    const format = (rule: string, valueNumber: number) =>
      formatAttributeValue(rule, { valueText: null, valueNumber });
    expect(format("resistance", 4700)).toBe("4.7 kΩ");
    expect(format("resistance", 4.7)).toBe("4.7 Ω");
    expect(format("capacitance", 100_000)).toBe("100 nF");
    expect(format("capacitance", 4_700_000)).toBe("4.7 µF");
    expect(format("power", 0.25)).toBe("250 mW");
    expect(format("length", 2.54)).toBe("2.54 mm");
    expect(format("percent", 1)).toBe("1%");
    expect(formatAttributeValue("thread", { valueText: "M3", valueNumber: null })).toBe("M3");
  });

  it("adds the length implied by a combined thread designation", () => {
    const thread = { key: "thread", label: "Thread", value: "M3x8" };
    expect(expandAttributes([thread])).toEqual([
      thread,
      { key: "length", label: "Length", value: "M3x8" },
    ]);
    const length = { key: "length", label: "Length", value: "10 mm" };
    expect(expandAttributes([thread, length])).toEqual([thread, length]);
    expect(expandAttributes([{ ...thread, value: "M3" }])).toHaveLength(1);
  });
});
