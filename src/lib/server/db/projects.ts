import type { Database } from "bun:sqlite";
import type { ConstraintComparison, ProjectStatus } from "#lib/projects.ts";

// Type aliases (not interfaces) so they can be passed as named SQL bindings.
export type ProjectFields = {
  name: string;
  status: ProjectStatus;
  notes: string | null;
  /** One URL per line, or null. */
  links: string | null;
};

export type Project = ProjectFields & {
  id: number;
  createdAt: string;
  updatedAt: string;
};

export interface ProjectSummary {
  id: number;
  name: string;
  status: ProjectStatus;
  lineCount: number;
}

export interface ProjectComponent {
  id: number;
  projectId: number;
  name: string;
  notes: string | null;
  displayOrder: number;
}

export type BomLineFields = {
  componentId: number | null;
  description: string;
  /** Integer amount of `unit`. */
  quantity: number;
  unit: string;
  partId: number | null;
  categoryId: number | null;
  manufacturer: string | null;
  partNumber: string | null;
  referenceDesignators: string | null;
  notes: string | null;
};

export type BomLine = BomLineFields & {
  id: number;
  projectId: number;
  partName: string | null;
  categoryName: string | null;
};

export interface BomConstraintValue {
  attributeId: number;
  comparison: ConstraintComparison;
  rawValue: string;
  valueText: string | null;
  valueNumber: number | null;
  valueBoolean: boolean | null;
  rawMaxValue: string | null;
  maxValueNumber: number | null;
}

export interface BomConstraint extends BomConstraintValue {
  bomLineId: number;
  key: string;
  label: string;
  normalization: string | null;
}

export interface BomPartChoice {
  id: number;
  bomLineId: number;
  partId: number;
  partName: string;
  baseUnit: string;
  substitute: boolean;
  note: string | null;
  approvedAt: string;
}

const PROJECT_COLUMNS = `id, name, status, notes, links, created_at AS createdAt,
  updated_at AS updatedAt`;

export function listProjects(db: Database): ProjectSummary[] {
  return db
    .query<ProjectSummary, []>(
      `SELECT p.id, p.name, p.status,
         (SELECT count(*) FROM bom_lines l WHERE l.project_id = p.id) AS lineCount
       FROM projects p
       ORDER BY p.name COLLATE NOCASE`
    )
    .all();
}

export function getProject(db: Database, id: number): Project | null {
  return db
    .query<Project, [number]>(`SELECT ${PROJECT_COLUMNS} FROM projects WHERE id = ?`)
    .get(id);
}

export function insertProject(db: Database, fields: ProjectFields): number {
  return db
    .query<{ id: number }, ProjectFields>(
      `INSERT INTO projects (name, status, notes, links) VALUES ($name, $status, $notes, $links)
       RETURNING id`
    )
    .get(fields)!.id;
}

export function updateProject(db: Database, id: number, fields: ProjectFields): void {
  db.query<unknown, ProjectFields & { id: number }>(
    `UPDATE projects SET name = $name, status = $status, notes = $notes, links = $links,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = $id`
  ).run({ ...fields, id });
}

const COMPONENT_COLUMNS = `id, project_id AS projectId, name, notes, display_order AS displayOrder`;

export function listComponents(db: Database, projectId: number): ProjectComponent[] {
  return db
    .query<ProjectComponent, [number]>(
      `SELECT ${COMPONENT_COLUMNS} FROM project_components
       WHERE project_id = ? ORDER BY display_order, id`
    )
    .all(projectId);
}

export function getComponent(db: Database, id: number): ProjectComponent | null {
  return db
    .query<ProjectComponent, [number]>(
      `SELECT ${COMPONENT_COLUMNS} FROM project_components WHERE id = ?`
    )
    .get(id);
}

export function insertComponent(
  db: Database,
  projectId: number,
  fields: { name: string; notes: string | null }
): number {
  return db
    .query<{ id: number }, [number, string, string | null]>(
      `INSERT INTO project_components (project_id, name, notes, display_order)
       VALUES (?1, ?2, ?3, (SELECT coalesce(max(display_order), 0) + 1
                            FROM project_components WHERE project_id = ?1))
       RETURNING id`
    )
    .get(projectId, fields.name, fields.notes)!.id;
}

export function updateComponent(
  db: Database,
  id: number,
  fields: { name: string; notes: string | null }
): void {
  db.run("UPDATE project_components SET name = ?, notes = ? WHERE id = ?", [
    fields.name,
    fields.notes,
    id,
  ]);
}

export function setComponentOrder(db: Database, id: number, displayOrder: number): void {
  db.run("UPDATE project_components SET display_order = ? WHERE id = ?", [displayOrder, id]);
}

export function deleteComponent(db: Database, id: number): void {
  db.run("DELETE FROM project_components WHERE id = ?", [id]);
}

/** Move every line of a component to the ungrouped section. Line IDs do not change. */
export function ungroupComponentLines(db: Database, componentId: number): void {
  db.run(
    `UPDATE bom_lines SET component_id = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE component_id = ?`,
    [componentId]
  );
}

const LINE_COLUMNS = `l.id, l.project_id AS projectId, l.component_id AS componentId, l.description,
  l.quantity, l.unit, l.part_id AS partId, p.name AS partName, l.category_id AS categoryId,
  c.name AS categoryName, l.manufacturer, l.part_number AS partNumber,
  l.reference_designators AS referenceDesignators, l.notes`;

const LINE_FROM = `bom_lines l
  LEFT JOIN parts p ON p.id = l.part_id
  LEFT JOIN categories c ON c.id = l.category_id`;

export function listBomLines(db: Database, projectId: number): BomLine[] {
  return db
    .query<BomLine, [number]>(
      `SELECT ${LINE_COLUMNS} FROM ${LINE_FROM} WHERE l.project_id = ? ORDER BY l.id`
    )
    .all(projectId);
}

export function getBomLine(db: Database, id: number): BomLine | null {
  return db
    .query<BomLine, [number]>(`SELECT ${LINE_COLUMNS} FROM ${LINE_FROM} WHERE l.id = ?`)
    .get(id);
}

export function insertBomLine(db: Database, projectId: number, fields: BomLineFields): number {
  return db
    .query<{ id: number }, BomLineFields & { projectId: number }>(
      `INSERT INTO bom_lines (project_id, component_id, description, quantity, unit, part_id,
         category_id, manufacturer, part_number, reference_designators, notes)
       VALUES ($projectId, $componentId, $description, $quantity, $unit, $partId, $categoryId,
         $manufacturer, $partNumber, $referenceDesignators, $notes)
       RETURNING id`
    )
    .get({ ...fields, projectId })!.id;
}

export function updateBomLine(db: Database, id: number, fields: BomLineFields): void {
  db.query<unknown, BomLineFields & { id: number }>(
    `UPDATE bom_lines SET component_id = $componentId, description = $description,
       quantity = $quantity, unit = $unit, part_id = $partId, category_id = $categoryId,
       manufacturer = $manufacturer, part_number = $partNumber,
       reference_designators = $referenceDesignators, notes = $notes,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = $id`
  ).run({ ...fields, id });
}

export function setBomLineComponent(db: Database, id: number, componentId: number | null): void {
  db.run(
    `UPDATE bom_lines SET component_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ?`,
    [componentId, id]
  );
}

export function deleteBomLine(db: Database, id: number): void {
  db.run("DELETE FROM bom_lines WHERE id = ?", [id]);
}

/** Constraints of the given lines. */
export function listConstraints(db: Database, lineIds: number[]): BomConstraint[] {
  return db
    .query<Omit<BomConstraint, "valueBoolean"> & { valueBoolean: number | null }, [string]>(
      `SELECT k.bom_line_id AS bomLineId, k.attribute_id AS attributeId, d.key, d.label,
         d.normalization, k.comparison, k.raw_value AS rawValue, k.value_text AS valueText,
         k.value_number AS valueNumber, k.value_boolean AS valueBoolean,
         k.raw_max_value AS rawMaxValue, k.max_value_number AS maxValueNumber
       FROM bom_line_constraints k
       JOIN attribute_definitions d ON d.id = k.attribute_id
       WHERE k.bom_line_id IN (SELECT value FROM json_each(?))
       ORDER BY d.label`
    )
    .all(JSON.stringify(lineIds))
    .map((row) => ({
      ...row,
      valueBoolean: row.valueBoolean === null ? null : row.valueBoolean === 1,
    }));
}

export function replaceConstraints(
  db: Database,
  lineId: number,
  values: BomConstraintValue[]
): void {
  db.run("DELETE FROM bom_line_constraints WHERE bom_line_id = ?", [lineId]);
  const insert = db.query<
    unknown,
    [
      number,
      number,
      string,
      string,
      string | null,
      number | null,
      number | null,
      string | null,
      number | null,
    ]
  >(
    `INSERT INTO bom_line_constraints (bom_line_id, attribute_id, comparison, raw_value,
       value_text, value_number, value_boolean, raw_max_value, max_value_number)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const value of values) {
    insert.run(
      lineId,
      value.attributeId,
      value.comparison,
      value.rawValue,
      value.valueText,
      value.valueNumber,
      value.valueBoolean === null ? null : Number(value.valueBoolean),
      value.rawMaxValue,
      value.maxValueNumber
    );
  }
}

/** Approved choices of the given lines. */
export function listChoices(db: Database, lineIds: number[]): BomPartChoice[] {
  return db
    .query<Omit<BomPartChoice, "substitute"> & { substitute: number }, [string]>(
      `SELECT ch.id, ch.bom_line_id AS bomLineId, ch.part_id AS partId, p.name AS partName,
         p.base_unit AS baseUnit, ch.substitute, ch.note, ch.approved_at AS approvedAt
       FROM bom_part_choices ch
       JOIN parts p ON p.id = ch.part_id
       WHERE ch.bom_line_id IN (SELECT value FROM json_each(?))
       ORDER BY ch.substitute, ch.id`
    )
    .all(JSON.stringify(lineIds))
    .map((row) => ({ ...row, substitute: row.substitute === 1 }));
}

export function insertChoice(
  db: Database,
  fields: { bomLineId: number; partId: number; substitute: boolean; note: string | null }
): number {
  return db
    .query<{ id: number }, [number, number, number, string | null]>(
      `INSERT INTO bom_part_choices (bom_line_id, part_id, substitute, note)
       VALUES (?, ?, ?, ?) RETURNING id`
    )
    .get(fields.bomLineId, fields.partId, Number(fields.substitute), fields.note)!.id;
}

export function deleteChoice(db: Database, id: number): void {
  db.run("DELETE FROM bom_part_choices WHERE id = ?", [id]);
}
