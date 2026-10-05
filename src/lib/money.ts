/**
 * Exact money amounts.
 *
 * Prices are stored as exact decimal strings in one currency. Arithmetic uses BigInt fractions,
 * never floating point, and amounts in different currencies are never added or converted.
 * Recorded prices are goods prices only: they exclude shipping and tax.
 */

/** A non-negative exact fraction. `den` is always positive. */
export interface Fraction {
  num: bigint;
  den: bigint;
}

export interface Money {
  amount: Fraction;
  /** Three-letter uppercase currency code. */
  currency: string;
  /** Largest number of decimal places among the source prices of the amount. */
  scale: number;
}

/** Per-currency sums of known amounts, and how many amounts are unknown. */
export interface MoneyTotals {
  /** One total per currency, in order of first appearance. */
  totals: Money[];
  /** Amounts that are not known. They are not counted as zero, so the totals are incomplete. */
  unknownCount: number;
}

const DECIMAL = /^(\d+)(?:\.(\d+))?$/;
const CURRENCY = /^[A-Z]{3}$/;

/**
 * The uppercase three-letter currency code in `value`, or null if it is not one. The same
 * spelling for each currency makes sure that "usd" and "USD" amounts add together.
 */
export function parseCurrency(value: string | null): string | null {
  const code = value?.trim().toUpperCase() ?? "";
  return CURRENCY.test(code) ? code : null;
}

function gcd(a: bigint, b: bigint): bigint {
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

function reduce(num: bigint, den: bigint): Fraction {
  const divisor = gcd(num, den) || 1n;
  return { num: num / divisor, den: den / divisor };
}

/** An exact price such as "12.50" in `currency`. Throws for text that is not a decimal. */
export function money(price: string, currency: string): Money {
  const match = DECIMAL.exec(price.trim());
  if (!match) throw new Error(`"${price}" is not a decimal amount`);
  const fraction = match[2] ?? "";
  return {
    amount: reduce(BigInt(match[1] + fraction), 10n ** BigInt(fraction.length)),
    currency,
    scale: fraction.length,
  };
}

/** `value` × num / den, exactly. */
export function multiply(value: Money, num: number | bigint, den: number | bigint = 1): Money {
  const n = BigInt(num);
  const d = BigInt(den);
  if (n < 0n || d <= 0n) throw new Error("Money can only be scaled by a non-negative fraction");
  return { ...value, amount: reduce(value.amount.num * n, value.amount.den * d) };
}

/** Sum the known amounts per currency. Null amounts are unknown, not zero. */
export function totalByCurrency(amounts: (Money | null)[]): MoneyTotals {
  const totals = new Map<string, Money>();
  let unknownCount = 0;
  for (const amount of amounts) {
    if (!amount) {
      unknownCount += 1;
      continue;
    }
    const total = totals.get(amount.currency);
    if (!total) {
      totals.set(amount.currency, amount);
      continue;
    }
    const { num: a, den: b } = total.amount;
    const { num: c, den: d } = amount.amount;
    totals.set(amount.currency, {
      amount: reduce(a * d + c * b, b * d),
      currency: amount.currency,
      scale: Math.max(total.scale, amount.scale),
    });
  }
  return { totals: [...totals.values()], unknownCount };
}

/** Decimal places that show `fraction` exactly, or null if its decimal does not terminate. */
function exactPlaces({ den }: Fraction): number | null {
  let twos = 0;
  let fives = 0;
  while (den % 2n === 0n) [den, twos] = [den / 2n, twos + 1];
  while (den % 5n === 0n) [den, fives] = [den / 5n, fives + 1];
  return den === 1n ? Math.max(twos, fives) : null;
}

function decimalText(scaled: bigint, places: number): string {
  if (places === 0) return scaled.toString();
  const digits = scaled.toString().padStart(places + 1, "0");
  return `${digits.slice(0, -places)}.${digits.slice(-places)}`;
}

/**
 * The amount with its currency, such as "0.05 USD". A terminating decimal shows exactly, with
 * at least the scale of its source prices. Otherwise, the amount is rounded half up to that
 * scale and starts with "≈", so no unsupported precision shows.
 */
export function formatMoney(value: Money): string {
  const { num, den } = value.amount;
  const exact = exactPlaces(value.amount);
  if (exact !== null) {
    const places = Math.max(exact, value.scale);
    return `${decimalText((num * 10n ** BigInt(places)) / den, places)} ${value.currency}`;
  }
  const scaled = num * 10n ** BigInt(value.scale);
  const rounded = (scaled * 2n + den) / (den * 2n);
  return `≈${decimalText(rounded, value.scale)} ${value.currency}`;
}
