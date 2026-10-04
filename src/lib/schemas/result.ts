export type FieldErrors = Record<string, string>;

export type ParseResult<T> = { success: true; data: T } | { success: false; errors: FieldErrors };

export function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export function optionalText(form: FormData, name: string): string | null {
  return text(form, name) || null;
}

export function allText(form: FormData, name: string): string[] {
  return form.getAll(name).map((value) => (typeof value === "string" ? value.trim() : ""));
}

/** Parse a positive integer ID. Returns null for an empty value and NaN for an invalid one. */
export function parseId(value: string): number | null {
  if (value === "") return null;
  return /^\d+$/.test(value) && Number(value) > 0 ? Number(value) : NaN;
}
