import type { Database } from "bun:sqlite";

export type LocationKind = "storage" | "project";

export interface Location {
  id: number;
  name: string;
  kind: LocationKind;
  notes: string | null;
}

export function listLocations(db: Database): Location[] {
  return db
    .query<Location, []>("SELECT id, name, kind, notes FROM locations ORDER BY name COLLATE NOCASE")
    .all();
}

export function getLocation(db: Database, id: number): Location | null {
  return db
    .query<Location, [number]>("SELECT id, name, kind, notes FROM locations WHERE id = ?")
    .get(id);
}

export function getLocationByName(db: Database, name: string): Location | null {
  return db
    .query<Location, [string]>("SELECT id, name, kind, notes FROM locations WHERE name = ?")
    .get(name);
}

export function insertLocation(
  db: Database,
  fields: { name: string; notes: string | null }
): number {
  const row = db
    .query<{ id: number }, [string, string | null]>(
      `INSERT INTO locations (name, kind, notes) VALUES (?, 'storage', ?) RETURNING id`
    )
    .get(fields.name, fields.notes);
  return row!.id;
}
