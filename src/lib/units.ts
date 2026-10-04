/**
 * Units and exact conversions for stock quantities.
 *
 * Each part has one base unit. Quantities are stored as integer amounts of that base unit.
 * An amount entered in another unit converts only when the units measure the same dimension
 * and the result is a whole number of base units. Nothing is rounded.
 */

export type UnitDimension = "count" | "length" | "mass" | "volume";

interface UnitDefinition {
  label: string;
  dimension: UnitDimension;
  /** Size relative to the smallest unit of the same dimension. */
  size: number;
}

export const UNITS = {
  pcs: { label: "pieces", dimension: "count", size: 1 },
  mm: { label: "millimetres", dimension: "length", size: 1 },
  cm: { label: "centimetres", dimension: "length", size: 10 },
  m: { label: "metres", dimension: "length", size: 1000 },
  g: { label: "grams", dimension: "mass", size: 1 },
  kg: { label: "kilograms", dimension: "mass", size: 1000 },
  mL: { label: "millilitres", dimension: "volume", size: 1 },
  L: { label: "litres", dimension: "volume", size: 1000 },
} as const satisfies Record<string, UnitDefinition>;

export type Unit = keyof typeof UNITS;

export const UNIT_CODES = Object.keys(UNITS) as Unit[];

export class UnitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnitError";
  }
}

export function isUnit(value: string): value is Unit {
  return Object.hasOwn(UNITS, value);
}

export function assertUnit(value: string): Unit {
  if (!isUnit(value)) {
    throw new UnitError(`Unknown unit "${value}"`);
  }
  return value;
}

/** Units that can be converted to and from the given base unit. */
export function compatibleUnits(baseUnit: Unit): Unit[] {
  const dimension = UNITS[baseUnit].dimension;
  return UNIT_CODES.filter((unit) => UNITS[unit].dimension === dimension);
}

const DECIMAL = /^(\d+)(?:\.(\d+))?$/;

/**
 * Convert a decimal amount in `unit` to an exact integer number of `baseUnit`.
 * Throws a UnitError for incompatible units or amounts that are not whole base units.
 */
export function toBaseQuantity(amount: string, unit: Unit, baseUnit: Unit): number {
  const from = UNITS[unit];
  const to = UNITS[baseUnit];
  if (from.dimension !== to.dimension) {
    throw new UnitError(
      `Cannot convert ${unit} (${from.dimension}) to ${baseUnit} (${to.dimension})`
    );
  }

  const match = DECIMAL.exec(amount.trim());
  if (!match) {
    throw new UnitError(`"${amount}" is not a valid non-negative amount`);
  }

  // amount = digits / 10^decimals, exactly
  const fraction = match[2] ?? "";
  const digits = BigInt(match[1] + fraction);
  const denominator = 10n ** BigInt(fraction.length) * BigInt(to.size);
  const numerator = digits * BigInt(from.size);

  if (numerator % denominator !== 0n) {
    throw new UnitError(`${amount} ${unit} is not a whole number of ${baseUnit}`);
  }

  const result = numerator / denominator;
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new UnitError(`${amount} ${unit} is too large`);
  }
  return Number(result);
}

export function formatQuantity(quantity: number, baseUnit: string): string {
  return `${quantity.toLocaleString("en-US")} ${baseUnit}`;
}
