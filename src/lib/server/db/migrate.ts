import type { Database } from "bun:sqlite";

export interface Migration {
  name: string;
  sql: string;
}

const files = import.meta.glob<string>("./migrations/*.sql", {
  query: "?raw",
  import: "default",
  eager: true,
});

/** Checked-in migrations, ordered by file name. */
export const migrations: Migration[] = Object.entries(files)
  .map(([path, sql]) => ({ name: path.slice(path.lastIndexOf("/") + 1), sql }))
  .sort((a, b) => a.name.localeCompare(b.name));

/** Apply migrations that are not yet recorded in `schema_migrations`. Returns the applied names. */
export function runMigrations(db: Database, list: Migration[] = migrations): string[] {
  db.run(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`);

  const applied = new Set(
    db
      .query<{ name: string }, []>("SELECT name FROM schema_migrations")
      .all()
      .map((row) => row.name)
  );

  const pending = list.filter((migration) => !applied.has(migration.name));
  const apply = db.transaction((migration: Migration) => {
    db.run(migration.sql);
    db.run("INSERT INTO schema_migrations (name) VALUES (?)", [migration.name]);
  });

  for (const migration of pending) {
    apply(migration);
  }
  return pending.map((migration) => migration.name);
}
