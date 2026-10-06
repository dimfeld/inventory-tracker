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

  it("moves the order delivery state to the order lines", () => {
    const db = new Database(":memory:", { strict: true });
    db.run("PRAGMA foreign_keys = ON");
    const index = migrations.findIndex((m) => m.name === "0008_line_delivery.sql");
    runMigrations(db, migrations.slice(0, index));

    db.run("INSERT INTO parts (id, name, base_unit) VALUES (1, 'Screw', 'pcs')");
    db.run(
      `INSERT INTO orders (id, supplier, status, delivery_state, delivered_on) VALUES
         (1, 'A', 'placed', 'not_delivered', NULL),
         (2, 'B', 'shipped', 'awaiting_review', '2026-09-10'),
         (3, 'C', 'placed', 'reviewed', '2026-09-01')`
    );
    // Line 2 is fully received and line 3 partly received.
    db.run(
      `INSERT INTO order_lines (id, order_id, part_id, purchase_quantity, purchase_unit,
         pack_quantity, received_quantity, cancelled_quantity) VALUES
         (1, 1, 1, 1, 'pack', 10, 0, 0),
         (2, 1, 1, 1, 'pack', 10, 10, 0),
         (3, 1, 1, 1, 'pack', 10, 4, 0),
         (4, 2, 1, 1, 'pack', 10, 0, 0),
         (5, 2, 1, 1, 'pack', 10, 10, 0),
         (6, 3, 1, 1, 'pack', 10, 0, 0)`
    );
    db.run(
      `INSERT INTO receipts (id, order_id, operation_id, received_on) VALUES
         (1, 1, 'r1', '2026-09-05'), (2, 1, 'r2', '2026-09-07'), (3, 2, 'r3', '2026-09-12')`
    );
    db.run(
      `INSERT INTO receipt_lines (receipt_id, order_line_id, accepted_quantity, damaged_quantity)
       VALUES (1, 2, 0, 10), (2, 3, 0, 4), (3, 5, 0, 10)`
    );

    expect(runMigrations(db)).toContain("0008_line_delivery.sql");
    expect(
      db.query("SELECT id, delivery_state, delivered_on FROM order_lines ORDER BY id").values()
    ).toEqual([
      [1, "not_delivered", null],
      [2, "reviewed", "2026-09-05"],
      [3, "not_delivered", "2026-09-07"],
      [4, "awaiting_review", "2026-09-10"],
      [5, "reviewed", "2026-09-10"],
      [6, "reviewed", "2026-09-01"],
    ]);
    const orderColumns = db
      .query<{ name: string }, []>("SELECT name FROM pragma_table_info('orders')")
      .all()
      .map((row) => row.name);
    expect(orderColumns).not.toContain("delivery_state");
    expect(orderColumns).not.toContain("delivered_on");
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("opens with foreign keys enabled", () => {
    const db = openDatabase(":memory:");
    expect(db.query("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
  });

  it("lets several parts share a supplier SKU and keeps the existing rows", () => {
    const db = new Database(":memory:", { strict: true });
    db.run("PRAGMA foreign_keys = ON");
    const index = migrations.findIndex((m) => m.name === "0009_shared_supplier_sku.sql");
    runMigrations(db, migrations.slice(0, index));
    db.run("INSERT INTO parts (id, name, base_unit) VALUES (1, 'Red', 'pcs'), (2, 'Blue', 'pcs')");
    db.run(
      `INSERT INTO supplier_parts (id, part_id, supplier, sku, url, purchase_unit, pack_quantity)
       VALUES (7, 1, 'AliExpress', '100', 'https://example.com', 'pack', 10)`
    );

    expect(runMigrations(db)).toContain("0009_shared_supplier_sku.sql");
    expect(db.query("SELECT * FROM supplier_parts").all()).toEqual([
      {
        id: 7,
        part_id: 1,
        supplier: "AliExpress",
        sku: "100",
        url: "https://example.com",
        purchase_unit: "pack",
        pack_quantity: 10,
      },
    ]);
    db.run("INSERT INTO supplier_parts (part_id, supplier, sku) VALUES (2, 'AliExpress', '100')");
    expect(() =>
      db.run("INSERT INTO supplier_parts (part_id, supplier, sku) VALUES (2, 'AliExpress', '100')")
    ).toThrow(/UNIQUE/);
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});
