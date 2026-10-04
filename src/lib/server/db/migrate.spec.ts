import { Database } from "bun:sqlite";
import { describe, expect, it } from "vitest";
import { openDatabase } from "./connection";
import { migrations, runMigrations } from "./migrate";

describe("migrations", () => {
  it("apply to a fresh database once", () => {
    const db = new Database(":memory:", { strict: true });
    expect(runMigrations(db)).toEqual(migrations.map((m) => m.name));
    expect(runMigrations(db)).toEqual([]);

    const tables = db
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => row.name);
    expect(tables).toEqual(
      expect.arrayContaining([
        "parts",
        "categories",
        "attribute_definitions",
        "part_attributes",
        "part_aliases",
        "supplier_parts",
        "locations",
        "stock_movements",
      ])
    );
  });

  it("opens with foreign keys enabled", () => {
    const db = openDatabase(":memory:");
    expect(db.query("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
  });
});
