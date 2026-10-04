/**
 * Normalization rules for typed part attributes.
 *
 * `attribute_definitions.normalization` names one of these rules. Each rule turns the raw
 * text into a typed value used for comparison. The raw text is always kept as entered. Input
 * that a rule cannot read gets no typed value, so it never matches a filter by accident.
 *
 * Numeric values are computed from the decimal digits as written (for example `4k7` becomes
 * `Number("47e2")`), so there are no floating-point artifacts and no added precision.
 */

export const NORMALIZATION_RULES = [
  "thread",
  "length",
  "resistance",
  "capacitance",
  "voltage",
  "power",
  "percent",
  "count",
  "keyword",
  "code",
] as const;

export type NormalizationRule = (typeof NORMALIZATION_RULES)[number];

export type NormalizedValue =
  | { valueText: string; valueNumber: null }
  | { valueText: null; valueNumber: number };

export function isNormalizationRule(value: string | null): value is NormalizationRule {
  return (NORMALIZATION_RULES as readonly string[]).includes(value ?? "");
}

/** A decimal number as digits and a power of ten: value = digits × 10^exponent. */
interface Decimal {
  digits: string;
  exponent: number;
}

function toNumber({ digits, exponent }: Decimal): number {
  return Number(`${digits}e${exponent}`);
}

const SI_PREFIX: Record<string, number> = {
  p: -12,
  n: -9,
  u: -6,
  µ: -6,
  μ: -6,
  m: -3,
  "": 0,
  r: 0,
  R: 0,
  k: 3,
  K: 3,
  M: 6,
  G: 9,
};

/**
 * Read engineering notation: `4.7k`, `4k7`, `4R7`, `100n`, `2u2`, or a plain number.
 * Returns the value in base units (ohms, farads, ...) as a decimal.
 */
function parseEngineering(text: string, prefixes: string): Decimal | null {
  const p = `[${prefixes}]`;
  // A prefix letter in place of the decimal point: 4k7, 4R7, 2u2.
  const infix = new RegExp(`^(\\d+)(${p})(\\d+)$`).exec(text);
  const plain = new RegExp(`^(\\d*)(?:\\.(\\d+))?(${p}?)$`).exec(text);
  let whole: string, fraction: string, prefix: string;
  if (infix) {
    [, whole, prefix, fraction] = infix;
  } else if (plain && (plain[1] || plain[2])) {
    whole = plain[1];
    fraction = plain[2] ?? "";
    prefix = plain[3];
  } else {
    return null;
  }
  const digits = (whole + fraction).replace(/^0+(?=\d)/, "");
  return { digits, exponent: SI_PREFIX[prefix] - fraction.length };
}

function compact(raw: string): string {
  return raw.trim().replace(/\s+/g, "");
}

/** Remove a trailing unit symbol (case-insensitive). The symbol is optional. */
function stripUnit(text: string, units: string[]): string {
  const lower = text.toLowerCase();
  const unit = units.find((u) => lower.endsWith(u.toLowerCase()));
  return unit ? text.slice(0, text.length - unit.length) : text;
}

/** Parse a value with an SI prefix and an optional unit symbol, in units of 10^canonicalExponent. */
function parseScaled(
  raw: string,
  units: string[],
  prefixes: string,
  canonicalExponent: number
): number | null {
  const value = parseEngineering(stripUnit(compact(raw), units), prefixes);
  if (!value) return null;
  return toNumber({ digits: value.digits, exponent: value.exponent - canonicalExponent });
}

const LENGTH_UNITS: [string, Decimal][] = [
  ["mm", { digits: "1", exponent: 0 }],
  ["cm", { digits: "1", exponent: 1 }],
  ["in", { digits: "254", exponent: -1 }],
  ['"', { digits: "254", exponent: -1 }],
  ["m", { digits: "1", exponent: 3 }],
];

/** Length in millimetres: `8`, `8mm`, `2.54 mm`, `1.2cm`, `0.1"`. A bare number is mm. */
function parseLength(raw: string): number | null {
  let text = compact(raw).toLowerCase();
  let scale: Decimal = { digits: "1", exponent: 0 };
  for (const [unit, size] of LENGTH_UNITS) {
    if (text.endsWith(unit)) {
      text = text.slice(0, -unit.length);
      scale = size;
      break;
    }
  }
  const value = parseEngineering(text, "");
  if (!value) return null;
  const digits = (BigInt(value.digits) * BigInt(scale.digits)).toString();
  return toNumber({ digits, exponent: value.exponent + scale.exponent });
}

export interface ThreadDesignation {
  /** Normalized thread, such as `M3`. */
  thread: string;
  /** Length in mm when the designation includes one, such as `M3x8`. */
  lengthMm: number | null;
}

const METRIC_THREAD = /^m(\d+(?:\.\d+)?)((?:[x×*]\d+(?:\.\d+)?)*)(?:mm)?$/i;

/**
 * Read a metric thread designation: `M3`, `m 3`, `M3x0.5` (pitch), `M3x8` (length),
 * `M3x0.5x8`. With one number after the size, a value below half the diameter is a pitch
 * (M3 pitch is 0.5) and anything larger is a length.
 */
export function parseThreadDesignation(raw: string): ThreadDesignation | null {
  const match = METRIC_THREAD.exec(compact(raw));
  if (!match) return null;
  const size = match[1].replace(/\.0+$/, "");
  const rest = match[2]
    .split(/[x×*]/i)
    .filter(Boolean)
    .map((part) => toNumber(parseEngineering(part, "")!));
  let lengthMm: number | null = null;
  if (rest.length === 1) {
    lengthMm = rest[0] < Number(size) / 2 ? null : rest[0];
  } else if (rest.length === 2) {
    lengthMm = rest[1];
  } else if (rest.length > 2) {
    return null;
  }
  return { thread: `M${size}`, lengthMm };
}

function parseFraction(text: string): number | null {
  const match = /^(\d+)\/(\d+)$/.exec(text);
  if (!match || Number(match[2]) === 0) return null;
  return Number(match[1]) / Number(match[2]);
}

function textValue(value: string | null): NormalizedValue | null {
  return value ? { valueText: value, valueNumber: null } : null;
}

function numberValue(value: number | null): NormalizedValue | null {
  return value === null || !Number.isFinite(value) ? null : { valueText: null, valueNumber: value };
}

function collapseWhitespace(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

const NORMALIZERS: Record<NormalizationRule, (raw: string) => NormalizedValue | null> = {
  // Metric threads become `M3`; other thread systems (such as `#4-40`) compare as upper-case text.
  thread: (raw) =>
    textValue(parseThreadDesignation(raw)?.thread ?? collapseWhitespace(raw).toUpperCase()),
  // Also reads the length from a combined designation such as `M3x8`.
  length: (raw) => numberValue(parseLength(raw) ?? parseThreadDesignation(raw)?.lengthMm ?? null),
  resistance: (raw) => numberValue(parseScaled(raw, ["ohms", "ohm", "Ω", "Ω", "R"], "mkKMGRr", 0)),
  capacitance: (raw) => numberValue(parseScaled(raw, ["F"], "pnuµμm", -12)),
  voltage: (raw) => numberValue(parseScaled(raw, ["VDC", "V"], "mkK", 0)),
  power: (raw) => {
    const text = stripUnit(compact(raw), ["W"]);
    return numberValue(parseFraction(text) ?? parseScaled(text, [], "mk", 0));
  },
  percent: (raw) => numberValue(parseScaled(raw.replace(/^\s*(±|\+\/-)/, ""), ["%"], "", 0)),
  count: (raw) => {
    const match = /^(\d+)(?:-?(?:pins?|pos(?:itions?)?|ways?|p))?$/i.exec(compact(raw));
    return numberValue(match ? Number(match[1]) : null);
  },
  keyword: (raw) => textValue(collapseWhitespace(raw).toLowerCase()),
  code: (raw) => textValue(collapseWhitespace(raw).toUpperCase()),
};

/** The typed value for raw attribute text, or null when the rule cannot read it. */
export function normalizeAttributeValue(
  rule: NormalizationRule,
  raw: string
): NormalizedValue | null {
  return NORMALIZERS[rule](raw);
}

export interface AttributeEntry {
  key: string;
  label: string;
  value: string;
}

/**
 * Add attributes implied by others. A thread entered as `M3x8` with no separate length also
 * sets the length; both keep `M3x8` as their raw text.
 */
export function expandAttributes<T extends AttributeEntry>(attributes: T[]): T[] {
  const thread = attributes.find((a) => a.key === "thread");
  if (!thread || attributes.some((a) => a.key === "length")) return attributes;
  if (parseThreadDesignation(thread.value)?.lengthMm == null) return attributes;
  return [...attributes, { ...thread, key: "length", label: "Length" }];
}

// Prefix steps for display, smallest first. Values are written in the canonical unit.
const DISPLAY_SCALES: Partial<Record<NormalizationRule, [prefix: string, exponent: number][]>> = {
  resistance: [
    ["m", -3],
    ["", 0],
    ["k", 3],
    ["M", 6],
    ["G", 9],
  ],
  capacitance: [
    ["p", 0],
    ["n", 3],
    ["µ", 6],
    ["m", 9],
  ],
  voltage: [
    ["m", -3],
    ["", 0],
    ["k", 3],
  ],
  power: [
    ["m", -3],
    ["", 0],
  ],
};

const DISPLAY_UNITS: Partial<Record<NormalizationRule, string>> = {
  resistance: "Ω",
  capacitance: "F",
  voltage: "V",
  power: "W",
  length: "mm",
  percent: "%",
};

/** Multiply by 10^shift using the decimal representation, not the binary value, to avoid artifacts. */
function shiftDecimal(value: number, shift: number): number {
  const [mantissa, exponent = "0"] = String(value).split("e");
  return Number(`${mantissa}e${Number(exponent) + shift}`);
}

/** Readable form of a typed value, such as `4.7 kΩ`, `100 nF`, or `8 mm`. */
export function formatAttributeValue(
  rule: string | null,
  value: { valueText: string | null; valueNumber: number | null }
): string | null {
  if (value.valueText !== null) return value.valueText;
  if (value.valueNumber === null) return null;
  const number = value.valueNumber;
  if (!isNormalizationRule(rule)) return String(number);

  const unit = DISPLAY_UNITS[rule];
  const scales = DISPLAY_SCALES[rule];
  if (scales) {
    const magnitude = Math.abs(number);
    const [prefix, exponent] =
      scales.findLast(([, e]) => magnitude >= Number(`1e${e}`)) ?? scales[0];
    return `${shiftDecimal(number, -exponent)} ${prefix}${unit}`;
  }
  if (rule === "percent") return `${number}%`;
  return unit ? `${number} ${unit}` : String(number);
}

/** The text that identifies a typed value in a filter (URL parameter or form value). */
export function filterValueOf(value: {
  valueText: string | null;
  valueNumber: number | null;
}): string {
  return value.valueText ?? String(value.valueNumber);
}
