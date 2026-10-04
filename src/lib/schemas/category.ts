import { parseId, text, type ParseResult } from "./result";

export function parseCategoryForm(
  form: FormData
): ParseResult<{ name: string; parentId: number | null }> {
  const name = text(form, "name");
  const parentId = parseId(text(form, "parent_id"));
  if (!name) return { success: false, errors: { name: "Name is required" } };
  if (Number.isNaN(parentId)) return { success: false, errors: { parent_id: "Invalid parent" } };
  return { success: true, data: { name, parentId } };
}
