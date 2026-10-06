/**
 * Read and change the catalog taxonomy (categories, attributes, attribute values) of an
 * inventory database through the app's services.
 *
 *   bun .claude/skills/audit-catalog/catalog.ts report [--db PATH]
 *   bun .claude/skills/audit-catalog/catalog.ts values KEY [--db PATH]
 *   bun .claude/skills/audit-catalog/catalog.ts apply PLAN.json [--db PATH] [--dry-run]
 *
 * PATH defaults to the prod database. `apply` backs the database up (into a `backups` folder
 * next to it) before it writes, and runs
 * the whole plan in one transaction: one failed operation changes nothing. See SKILL.md for
 * the plan format.
 */
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { categoryOptions } from "#lib/categories.ts";
import { createCatalogService } from "#lib/server/inventory/catalog.ts";
import { createTaxonomyService, type AttributeFields } from "#lib/server/inventory/taxonomy.ts";

const PROD_DIR = join(homedir(), ".local/share/inventory-tracker");
const PROD_DB = join(PROD_DIR, "inventory.sqlite");

/** A category by ID or by full path, such as "Hardware / Fasteners / Nuts". */
type CategoryRef = number | string;

type Operation =
  | { op: "createCategory"; name: string; parent: CategoryRef | null }
  | { op: "updateCategory"; category: CategoryRef; name?: string; parent?: CategoryRef | null }
  | { op: "deleteCategory"; category: CategoryRef }
  | { op: "setPartCategory"; partIds: number[]; category: CategoryRef | null }
  | ({ op: "createAttribute"; key: string } & AttributeFields)
  | ({ op: "updateAttribute"; key: string } & Partial<AttributeFields>)
  | { op: "deleteAttribute"; key: string }
  | { op: "setApplicability"; key: string; category: CategoryRef; required: boolean | null }
  | { op: "replaceValue"; key: string; from: string; to: string }
  | { op: "setPartValues"; key: string; values: Record<string, string | null> };

function argValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
}

const [command, target] = process.argv.slice(2);
const dbPath = argValue("--db") ?? PROD_DB;
const dryRun = process.argv.includes("--dry-run");

const db = new Database(dbPath, { strict: true, readonly: command !== "apply" });
db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
const catalog = createCatalogService(db);
const taxonomy = createTaxonomyService(db);

function categoryId(ref: CategoryRef): number {
  if (typeof ref === "number") return ref;
  const match = categoryOptions(catalog.listCategories()).find((c) => c.path === ref);
  if (!match) throw new Error(`No category with the path "${ref}"`);
  return match.id;
}

function report() {
  const parts = db
    .query<{ id: number; name: string; categoryId: number | null; archived: number }, []>(
      `SELECT id, name, category_id AS categoryId, archived_at IS NOT NULL AS archived
       FROM parts ORDER BY id`
    )
    .all();
  const paths = new Map(categoryOptions(catalog.listCategories()).map((c) => [c.id, c.path]));
  const values = Map.groupBy(
    db
      .query<{ partId: number; key: string; rawValue: string }, []>(
        `SELECT a.part_id AS partId, d.key, a.raw_value AS rawValue
         FROM part_attributes a JOIN attribute_definitions d ON d.id = a.attribute_id`
      )
      .all(),
    (row) => row.partId
  );
  return {
    database: dbPath,
    categories: taxonomy.listCategories(),
    attributes: taxonomy.listAttributes().map(({ id: _id, ...attribute }) => ({
      ...attribute,
      values: taxonomy
        .listValues(attribute.key)
        .map((v) => ({ raw: v.rawValue, readsAs: v.display, parts: v.partCount })),
    })),
    parts: parts.map((part) => ({
      id: part.id,
      name: part.name,
      category: part.categoryId === null ? null : (paths.get(part.categoryId) ?? null),
      archived: part.archived === 1,
      attributes: Object.fromEntries((values.get(part.id) ?? []).map((v) => [v.key, v.rawValue])),
    })),
  };
}

function run(operation: Operation): string {
  switch (operation.op) {
    case "createCategory": {
      const parent = operation.parent === null ? null : categoryId(operation.parent);
      catalog.createCategory(operation.name, parent);
      return `created category ${operation.name}`;
    }
    case "updateCategory": {
      const id = categoryId(operation.category);
      const current = catalog.listCategories().find((c) => c.id === id)!;
      taxonomy.updateCategory(id, {
        name: operation.name ?? current.name,
        parentId:
          operation.parent === undefined
            ? current.parentId
            : operation.parent === null
              ? null
              : categoryId(operation.parent),
      });
      return `updated category ${current.name}`;
    }
    case "deleteCategory":
      taxonomy.deleteCategory(categoryId(operation.category));
      return `deleted category ${operation.category}`;
    case "setPartCategory": {
      const id = operation.category === null ? null : categoryId(operation.category);
      for (const partId of operation.partIds) taxonomy.setPartCategory(partId, id);
      return `moved ${operation.partIds.length} part(s) to ${operation.category}`;
    }
    case "createAttribute": {
      const { op: _op, key, ...fields } = operation;
      taxonomy.createAttribute(key, fields);
      return `created attribute ${key}`;
    }
    case "updateAttribute": {
      const { op: _op, key, ...changes } = operation;
      const current = taxonomy.listAttributes().find((a) => a.key === key);
      if (!current) throw new Error(`No attribute "${key}"`);
      const { label, valueType, normalization, canonicalUnit } = current;
      taxonomy.updateAttribute(key, { label, valueType, normalization, canonicalUnit, ...changes });
      return `updated attribute ${key}`;
    }
    case "deleteAttribute":
      taxonomy.deleteAttribute(operation.key);
      return `deleted attribute ${operation.key}`;
    case "setApplicability":
      taxonomy.setApplicability(operation.key, categoryId(operation.category), operation.required);
      return `set ${operation.key} on ${operation.category}: ${operation.required ?? "removed"}`;
    case "replaceValue": {
      const count = taxonomy.replaceValue(operation.key, operation.from, operation.to);
      return `${operation.key}: "${operation.from}" -> "${operation.to}" on ${count} part(s)`;
    }
    case "setPartValues": {
      const entries = Object.entries(operation.values);
      for (const [partId, value] of entries) {
        taxonomy.setPartValue(Number(partId), operation.key, value);
      }
      return `set ${operation.key} on ${entries.length} part(s)`;
    }
  }
}

async function apply(planPath: string) {
  const plan: Operation[] = await Bun.file(planPath).json();
  if (!dryRun) {
    const backups = join(dirname(dbPath), "backups");
    mkdirSync(backups, { recursive: true });
    const backup = join(
      backups,
      `inventory-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`
    );
    db.exec(`VACUUM INTO '${backup.replaceAll("'", "''")}'`);
    console.log(`backup: ${backup}`);
  }
  const log: string[] = [];
  try {
    db.transaction(() => {
      plan.forEach((operation, index) => {
        try {
          log.push(run(operation));
        } catch (error) {
          throw new Error(`operation ${index + 1} (${operation.op}): ${(error as Error).message}`);
        }
      });
      if (dryRun) throw new DryRun();
    })();
  } catch (error) {
    if (!(error instanceof DryRun)) throw error;
  }
  for (const line of log) console.log(line);
  console.log(dryRun ? "dry run: nothing was saved" : `applied ${log.length} operation(s)`);
}

class DryRun extends Error {}

switch (command) {
  case "report":
    console.log(JSON.stringify(report(), null, 2));
    break;
  case "values":
    console.log(JSON.stringify(taxonomy.listValues(target), null, 2));
    break;
  case "apply":
    await apply(target);
    break;
  default:
    console.error(
      "Usage: catalog.ts report | values KEY | apply PLAN.json [--db PATH] [--dry-run]"
    );
    process.exit(1);
}
