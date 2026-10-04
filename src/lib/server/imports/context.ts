import type { Database } from "bun:sqlite";
import { applicableAttributeKeys, categoryOptions } from "#lib/categories.ts";
import {
  listAttributeApplicability,
  listAttributeDefinitions,
  listCategories,
  type AttributeDefinition,
} from "#lib/server/db/catalog.ts";
import { listRequiredApplicability } from "#lib/server/db/candidates.ts";

export interface CategoryDefinition {
  id: number;
  /** Full path, such as "Hardware / Fasteners / Screws". */
  path: string;
  /** Attribute keys that apply, including inherited ones. */
  attributeKeys: string[];
  /** Keys a generic item of the category must specify. */
  requiredKeys: string[];
}

/** The catalog definitions that extraction and normalization use. */
export interface CatalogContext {
  categories: CategoryDefinition[];
  definitions: AttributeDefinition[];
}

export function loadCatalogContext(db: Database): CatalogContext {
  const categories = listCategories(db);
  const applicable = applicableAttributeKeys(categories, listAttributeApplicability(db));
  const required = applicableAttributeKeys(categories, listRequiredApplicability(db));
  return {
    categories: categoryOptions(categories).map(({ id, path }) => ({
      id,
      path,
      attributeKeys: applicable[id] ?? [],
      requiredKeys: required[id] ?? [],
    })),
    definitions: listAttributeDefinitions(db),
  };
}
