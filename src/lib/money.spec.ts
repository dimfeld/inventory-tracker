import { describe, expect, it } from "vitest";
import { formatMoney, money, multiply, parseCurrency, totalByCurrency } from "./money";

describe("money", () => {
  it("turns a pack price into an exact unit price with its currency", () => {
    expect(formatMoney(multiply(money("5.00", "USD"), 1, 100))).toBe("0.05 USD");
    expect(formatMoney(multiply(money("0.42", "EUR"), 1, 100))).toBe("0.0042 EUR");
    expect(formatMoney(multiply(money("5.00", "USD"), 3))).toBe("15.00 USD");
  });

  it("rounds a non-terminating amount to the source scale and marks it approximate", () => {
    expect(formatMoney(multiply(money("10.00", "USD"), 1, 3))).toBe("≈3.33 USD");
    expect(formatMoney(multiply(money("10.00", "USD"), 2, 3))).toBe("≈6.67 USD");
    expect(formatMoney(multiply(money("5", "GBP"), 1, 3))).toBe("≈2 GBP");
  });

  it("keeps an exact sum of rounded parts exact", () => {
    const third = multiply(money("10.00", "USD"), 1, 3);
    const { totals } = totalByCurrency([third, third, third]);
    expect(totals.map(formatMoney)).toEqual(["10.00 USD"]);
  });

  it("sums each currency separately and counts unknown amounts", () => {
    const result = totalByCurrency([
      money("1.50", "USD"),
      null,
      money("2.25", "EUR"),
      money("0.5", "USD"),
      null,
    ]);
    expect(result.totals.map(formatMoney)).toEqual(["2.00 USD", "2.25 EUR"]);
    expect(result.unknownCount).toBe(2);
  });

  it("accepts only three-letter currency codes, in uppercase", () => {
    expect(parseCurrency(" usd ")).toBe("USD");
    expect(parseCurrency("US$")).toBeNull();
    expect(parseCurrency("dollars")).toBeNull();
    expect(parseCurrency(null)).toBeNull();
  });
});
