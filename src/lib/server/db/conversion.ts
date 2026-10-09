import type { Database } from "bun:sqlite";

/** Projects that hold reservations or incoming commitments of a part. */
export interface PartProjectHolders {
  partId: number;
  projectNames: string[];
}

function holders(db: Database, sql: string, partIds: number[]): PartProjectHolders[] {
  return db
    .query<{ partId: number; projectNames: string }, [string]>(sql)
    .all(JSON.stringify(partIds))
    .map((row) => ({ partId: row.partId, projectNames: JSON.parse(row.projectNames) }));
}

/** Parts in `partIds` with active storage reservations, and the projects that hold them. */
export function listReservationHolders(db: Database, partIds: number[]): PartProjectHolders[] {
  return holders(
    db,
    `SELECT r.part_id AS partId, json_group_array(DISTINCT p.name) AS projectNames
     FROM reservations r
     JOIN bom_lines bl ON bl.id = r.bom_line_id
     JOIN projects p ON p.id = bl.project_id
     WHERE r.part_id IN (SELECT value FROM json_each(?))
     GROUP BY r.part_id`,
    partIds
  );
}

/** Parts in `partIds` with incoming order supply committed to projects. */
export function listCommitmentHolders(db: Database, partIds: number[]): PartProjectHolders[] {
  return holders(
    db,
    `SELECT ol.part_id AS partId, json_group_array(DISTINCT p.name) AS projectNames
     FROM incoming_commitments c
     JOIN order_lines ol ON ol.id = c.order_line_id
     JOIN bom_lines bl ON bl.id = c.bom_line_id
     JOIN projects p ON p.id = bl.project_id
     WHERE ol.part_id IN (SELECT value FROM json_each(?))
     GROUP BY ol.part_id`,
    partIds
  );
}

/** Number of BOM lines whose exact part is one of `partIds`. */
export function countBomLinesOfParts(db: Database, partIds: number[]): number {
  return db
    .query<{ count: number }, [string]>(
      "SELECT count(*) AS count FROM bom_lines WHERE part_id IN (SELECT value FROM json_each(?))"
    )
    .get(JSON.stringify(partIds))!.count;
}
