import type { Database } from "bun:sqlite";

export type LocationKind = "storage" | "project";

export interface Location {
  id: number;
  name: string;
  kind: LocationKind;
  notes: string | null;
  /** The project of a holding location; null for storage. */
  projectId: number | null;
}

const COLUMNS = "id, name, kind, notes, project_id AS projectId";

export function listLocations(db: Database): Location[] {
  return db
    .query<Location, []>(`SELECT ${COLUMNS} FROM locations ORDER BY name COLLATE NOCASE`)
    .all();
}

export function getLocation(db: Database, id: number): Location | null {
  return db.query<Location, [number]>(`SELECT ${COLUMNS} FROM locations WHERE id = ?`).get(id);
}

export function listStorageLocations(db: Database): Location[] {
  return db
    .query<Location, []>(
      `SELECT ${COLUMNS} FROM locations WHERE kind = 'storage' ORDER BY name COLLATE NOCASE`
    )
    .all();
}

export function getHoldingLocation(db: Database, projectId: number): Location | null {
  return db
    .query<Location, [number]>(`SELECT ${COLUMNS} FROM locations WHERE project_id = ?`)
    .get(projectId);
}

export function insertHoldingLocation(db: Database, projectId: number, name: string): number {
  return db
    .query<{ id: number }, [string, number]>(
      `INSERT INTO locations (name, kind, project_id) VALUES (?, 'project', ?) RETURNING id`
    )
    .get(name, projectId)!.id;
}

/** The project's holding location, made when the project first needs it. */
export function ensureHoldingLocation(db: Database, projectId: number): Location {
  const existing = getHoldingLocation(db, projectId);
  if (existing) return existing;
  insertHoldingLocation(db, projectId, `Project #${projectId} holding`);
  return getHoldingLocation(db, projectId)!;
}

export function getLocationByName(db: Database, name: string): Location | null {
  return db.query<Location, [string]>(`SELECT ${COLUMNS} FROM locations WHERE name = ?`).get(name);
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
