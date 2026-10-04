/**
 * Parts list filter state, kept in URL search parameters:
 *
 * - `q`: text search
 * - `category`: category ID (includes descendants)
 * - `tag`: repeated, any tag matches
 * - `attr.<key>`: repeated, any value matches; different keys must all match
 * - `archived=1`: include archived parts
 */

export const ATTRIBUTE_PREFIX = "attr.";

export interface PartFilterState {
  q: string;
  category: number | null;
  tags: string[];
  /** Selected normalized values by attribute key, in URL order. */
  attributes: Record<string, string[]>;
  archived: boolean;
}

/** One selected filter value, for the selected-filter list. */
export type SelectedFilter =
  | { kind: "q"; value: string }
  | { kind: "category"; value: number }
  | { kind: "tag"; value: string }
  | { kind: "attribute"; key: string; value: string };

function unique(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}

export function parsePartFilters(params: URLSearchParams): PartFilterState {
  const attributes: Record<string, string[]> = {};
  for (const name of new Set(params.keys())) {
    if (!name.startsWith(ATTRIBUTE_PREFIX)) continue;
    const key = name.slice(ATTRIBUTE_PREFIX.length);
    const values = unique(params.getAll(name));
    if (key && values.length > 0) attributes[key] = values;
  }
  const category = Number(params.get("category"));
  return {
    q: params.get("q")?.trim() ?? "",
    category: Number.isInteger(category) && category > 0 ? category : null,
    tags: unique(params.getAll("tag")),
    attributes,
    archived: params.get("archived") === "1",
  };
}

export function serializePartFilters(state: PartFilterState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.q) params.set("q", state.q);
  if (state.category !== null) params.set("category", String(state.category));
  for (const tag of state.tags) params.append("tag", tag);
  for (const [key, values] of Object.entries(state.attributes)) {
    for (const value of values) params.append(`${ATTRIBUTE_PREFIX}${key}`, value);
  }
  if (state.archived) params.set("archived", "1");
  return params;
}

/** A `/parts` link for the filter state. */
export function partFiltersHref(state: PartFilterState): string {
  const query = serializePartFilters(state).toString();
  return query ? `/parts?${query}` : "/parts";
}

export function selectedFilters(state: PartFilterState): SelectedFilter[] {
  const selected: SelectedFilter[] = [];
  if (state.q) selected.push({ kind: "q", value: state.q });
  if (state.category !== null) selected.push({ kind: "category", value: state.category });
  for (const [key, values] of Object.entries(state.attributes)) {
    for (const value of values) selected.push({ kind: "attribute", key, value });
  }
  for (const tag of state.tags) selected.push({ kind: "tag", value: tag });
  return selected;
}

/** The state with one selected filter value removed. */
export function removeFilter(state: PartFilterState, filter: SelectedFilter): PartFilterState {
  switch (filter.kind) {
    case "q":
      return { ...state, q: "" };
    case "category":
      return { ...state, category: null };
    case "tag":
      return { ...state, tags: state.tags.filter((t) => t !== filter.value) };
    case "attribute": {
      const attributes = { ...state.attributes };
      const remaining = (attributes[filter.key] ?? []).filter((v) => v !== filter.value);
      if (remaining.length > 0) attributes[filter.key] = remaining;
      else delete attributes[filter.key];
      return { ...state, attributes };
    }
  }
}

export function isSelected(state: PartFilterState, key: string, value: string): boolean {
  return state.attributes[key]?.includes(value) ?? false;
}
