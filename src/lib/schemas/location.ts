import { optionalText, text, type ParseResult } from "./result";

export function parseLocationForm(
  form: FormData
): ParseResult<{ name: string; notes: string | null }> {
  const name = text(form, "name");
  if (!name) return { success: false, errors: { name: "Name is required" } };
  return { success: true, data: { name, notes: optionalText(form, "notes") } };
}
