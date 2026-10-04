export interface CategoryOption {
  id: number;
  /** Full path, such as "Hardware / Fasteners / Screws". */
  path: string;
}

/** Category options labelled with their full paths, sorted by path. */
export function categoryOptions(
  categories: { id: number; name: string; parentId: number | null }[]
): CategoryOption[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const pathOf = (id: number): string => {
    const names: string[] = [];
    for (let c = byId.get(id); c; c = c.parentId === null ? undefined : byId.get(c.parentId)) {
      names.unshift(c.name);
    }
    return names.join(" / ");
  };
  return categories
    .map((c) => ({ id: c.id, path: pathOf(c.id) }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Attribute keys that apply to each category: keys assigned to the category or any ancestor.
 * Keys keep the order of `assignments`.
 */
export function applicableAttributeKeys(
  categories: { id: number; parentId: number | null }[],
  assignments: { categoryId: number; key: string }[]
): Record<number, string[]> {
  const parentOf = new Map(categories.map((c) => [c.id, c.parentId]));
  const result: Record<number, string[]> = {};
  for (const category of categories) {
    const lineage = new Set<number>();
    for (let id: number | null | undefined = category.id; id != null; id = parentOf.get(id)) {
      lineage.add(id);
    }
    result[category.id] = [
      ...new Set(assignments.filter((a) => lineage.has(a.categoryId)).map((a) => a.key)),
    ];
  }
  return result;
}
