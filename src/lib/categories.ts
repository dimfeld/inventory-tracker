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
