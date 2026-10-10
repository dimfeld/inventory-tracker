import type { Database } from "bun:sqlite";

/** Projects that hold incoming commitments of a part. */
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

/** Stock of a part picked for one BOM line, at its project's holding location. */
export interface PickedLineStock {
  partId: number;
  bomLineId: number;
  locationId: number;
  locationName: string;
  count: number;
}

/** Picked stock of the parts, by BOM line, that is not used or returned yet. */
export function listPickedLineStock(db: Database, partIds: number[]): PickedLineStock[] {
  return db
    .query<PickedLineStock, [string]>(
      `SELECT m.part_id AS partId, m.bom_line_id AS bomLineId, h.id AS locationId,
         h.name AS locationName,
         sum(CASE WHEN m.to_location_id = h.id THEN m.quantity
                  WHEN m.from_location_id = h.id THEN -m.quantity ELSE 0 END) AS count
       FROM stock_movements m
       JOIN bom_lines l ON l.id = m.bom_line_id
       JOIN locations h ON h.project_id = l.project_id
       WHERE m.part_id IN (SELECT value FROM json_each(?))
       GROUP BY m.part_id, m.bom_line_id
       HAVING count > 0
       ORDER BY m.bom_line_id`
    )
    .all(JSON.stringify(partIds));
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
