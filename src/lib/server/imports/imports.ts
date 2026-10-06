import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { expandAttributes, formatAttributeValue } from "#lib/attributes.ts";
import { categoryOptions } from "#lib/categories.ts";
import {
  EMPTY_HEADER,
  emptyLineFields,
  type CsvSettings,
  type ImportHeader,
  type ImportKind,
  type ImportLineFields,
  type Resolution,
  type SourceType,
} from "#lib/imports.ts";
import { parseCurrency } from "#lib/money.ts";
import { describePackConversion } from "#lib/orders.ts";
import { normalizeAttributeKey, type PartInput } from "#lib/schemas/part.ts";
import type { BomLineInput } from "#lib/schemas/project.ts";
import {
  getAttributeDefinition,
  getCategory,
  getPart,
  listCategories,
  type Part,
} from "#lib/server/db/catalog.ts";
import {
  clearProposals,
  deleteGroup,
  deleteImport,
  deleteLine,
  makeRoomAfter,
  listOrderImportsWithReference,
  getImport,
  getLine,
  insertGroup,
  insertImport,
  insertLine,
  listGroups,
  listImports,
  listImportsWithSource,
  listLines,
  recordCommit,
  recordLineCommit,
  recordParse,
  renameGroup,
  setParseState,
  updateHeader,
  updateLine,
  updateLineProposal,
  updateSource,
  type ImportGroup,
  type ImportLine,
  type ImportRecord,
} from "#lib/server/db/imports.ts";
import { listOrdersWithReference } from "#lib/server/db/orders.ts";
import { listAttributesOfParts, searchParts } from "#lib/server/db/part-search.ts";
import { getProject, listComponents, listProjects } from "#lib/server/db/projects.ts";
import { createCatalogService, typedAttributeValue } from "#lib/server/inventory/catalog.ts";
import { InventoryError, isUserError, NotFoundError } from "#lib/server/inventory/errors.ts";
import { createOrderService } from "#lib/server/inventory/orders.ts";
import {
  matchRequirement,
  requirementOf,
  SOURCE_LABELS,
  type RequirementConstraint,
} from "#lib/server/projects/matching.ts";
import { createProjectService } from "#lib/server/projects/projects.ts";
import { assertUnit, isUnit, toBaseQuantity, UNITS, type Unit } from "#lib/units.ts";
import { outputFromColumns } from "./columns";
import { loadCatalogContext, type CatalogContext } from "./context";
import {
  ExtractionError,
  type ExtractionRequest,
  type ExtractionUsage,
  type Extractor,
} from "./extractor";
import type { ClassificationRequest, Classifier, LineClassification } from "./jev";
import { cleanupLine, normalizeOutput, splitLine, type NormalizedImport } from "./normalize";
import {
  cleanupPrompt,
  cleanupSystemPrompt,
  splitPrompt,
  splitSystemPrompt,
  PROMPT_VERSION,
  sourcePrompt,
  systemPrompt,
  type CleanupLine,
  type PromptPart,
} from "./prompt";
import {
  lineCleanupSchema,
  lineSplitSchema,
  OUTPUT_SCHEMAS,
  SCHEMA_VERSION,
  type LineCleanupOutput,
} from "./schema";
import { csvTable, defaultCsvSettings, formatCsv, sourceRows } from "./source";

export type ImportService = ReturnType<typeof createImportService>;

/** The owner's edit of one line. */
export interface LineEdit {
  fields: ImportLineFields;
  groupId: number | null;
  resolution: Resolution | null;
  partId: number | null;
}

export type ParseOutcome = { ok: true; lineCount: number } | { ok: false; error: string };

export type CleanupOutcome =
  | { ok: true; matchedPart: { id: number; name: string } | null }
  | { ok: false; error: string };

export type SplitOutcome = { ok: true; lineCount: number } | { ok: false; error: string };

export interface NewImport {
  kind: ImportKind;
  sourceType: SourceType;
  sourceText: string;
}

export interface CsvOrderBatchResult {
  ids: number[];
  skipped: { supplier: string; reference: string }[];
  /** False when the CSV does not have usable supplier and order-reference columns. */
  batched: boolean;
}

export interface CommitResult {
  orderId: number | null;
  projectId: number | null;
  /** True when the import was already committed and nothing new was created. */
  repeated: boolean;
}

const WHOLE = /^\d+$/;
const DECIMAL = /^\d+(\.\d+)?$/;
const IDENTIFIER_SOURCES = new Set(["part_number", "alias", "supplier_sku"]);

export function sourceHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Line problems that block the commit. Other uncertainty is shown as a warning. */
export function lineProblems(kind: ImportKind, line: LineEdit, part: Part | null): string[] {
  const f = line.fields;
  const problems: string[] = [];
  if (!f.description.trim()) problems.push("Description is required");

  if (line.resolution === null || (kind === "order" && line.resolution === "requirement")) {
    problems.push(
      kind === "order"
        ? "Choose an existing part or create a new part"
        : "Choose an existing part, a new part, or a requirement"
    );
  }
  if (line.resolution === "existing") {
    if (!part) problems.push("Choose the existing part");
    else if (part.archivedAt) problems.push(`${part.name} is archived`);
  }
  if (line.resolution === "new" && !(f.unit && isUnit(f.unit))) {
    problems.push("Choose the base unit of the new part");
  }

  if (kind === "order") {
    if (!f.quantity || !WHOLE.test(f.quantity) || Number(f.quantity) === 0) {
      problems.push("Quantity ordered must be a whole number greater than zero");
    }
    if (!f.purchaseUnit) problems.push("Enter the purchase unit, such as pack or each");
    if (!f.packQuantity || !WHOLE.test(f.packQuantity) || Number(f.packQuantity) === 0) {
      problems.push("Enter the pack size: how many base units one purchase unit holds");
    }
    if (f.unitPrice !== null && !DECIMAL.test(f.unitPrice)) problems.push("Price must be a number");
    if (f.unitPrice !== null && !parseCurrency(f.currency)) {
      problems.push("Enter the currency of the price as a three-letter code, such as USD");
    }
    return problems;
  }

  if (!f.quantity || !DECIMAL.test(f.quantity) || Number(f.quantity) === 0) {
    problems.push("Quantity must be a number greater than zero");
  }
  if (!f.unit || !isUnit(f.unit)) {
    problems.push("Choose a unit");
  } else if (line.resolution === "existing" && part && f.quantity && DECIMAL.test(f.quantity)) {
    try {
      toBaseQuantity(f.quantity, f.unit, assertUnit(part.baseUnit));
    } catch (error) {
      if (!isUserError(error)) throw error;
      problems.push(error.message);
    }
  }
  return problems;
}

/** Reads the source rows as text: a CSV table with column names, or numbered lines. */
function sourceView(record: ImportRecord) {
  const rows = sourceRows(record.sourceType, record.sourceText);
  if (record.sourceType !== "csv") return { rows, csv: null };
  const settings = record.csvSettings ?? defaultCsvSettings(rows);
  return { rows, csv: { settings, ...csvTable(rows, settings) } };
}

/**
 * Imports of order lists and project BOMs: drafts, extraction into proposals, owner review, and
 * the commit. Only the commit creates catalog parts, orders, projects, or BOM rows, in one
 * transaction. No import operation changes stock: an imported order is a draft order that has
 * received nothing.
 */
/**
 * Run a one-line extraction. A failed call becomes an error for the owner, prefixed with the
 * operation unless it is an ExtractionError, whose message is already for the owner.
 */
async function extractLine(
  extractor: Extractor,
  request: ExtractionRequest,
  operation: string
): Promise<{ ok: true; output: unknown } | { ok: false; error: string }> {
  try {
    return { ok: true, output: (await extractor(request)).output };
  } catch (error) {
    if (error instanceof ExtractionError) return { ok: false, error: error.message };
    return {
      ok: false,
      error: `${operation} failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/** Classify a line, or give no classification when no classifier is configured. */
async function classifyLine(
  classifier: Classifier | null,
  request: ClassificationRequest
): Promise<{ ok: true; classification: LineClassification } | { ok: false; error: string }> {
  if (!classifier) return { ok: true, classification: {} };
  try {
    return { ok: true, classification: await classifier(request) };
  } catch (error) {
    return {
      ok: false,
      error: `Classification failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/** The cleanup answer with the classifier's category and match in place of the extractor's. */
function withClassification(
  output: LineCleanupOutput,
  classification: LineClassification
): LineCleanupOutput {
  const result = { ...output };
  if (classification.category !== undefined) {
    result.category =
      classification.category === null
        ? null
        : { value: classification.category, provenance: "inferred" };
  }
  if (classification.partId !== undefined) {
    result.match =
      classification.partId === null
        ? null
        : { partId: classification.partId, reason: "Chosen by Jev" };
  }
  return result;
}

export function createImportService(db: Database) {
  const catalog = createCatalogService(db);
  const orders = createOrderService(db);
  const projects = createProjectService(db);

  function inTransaction<T>(fn: () => T): T {
    return db.transaction(fn).immediate();
  }

  function requireImport(id: number): ImportRecord {
    const record = getImport(db, id);
    if (!record) throw new NotFoundError(`Import ${id} does not exist`);
    return record;
  }

  /** An import that can still change. */
  function requireOpen(id: number): ImportRecord {
    const record = requireImport(id);
    if (record.commitState === "committed") {
      throw new InventoryError("This import is committed and can no longer change");
    }
    return record;
  }

  function requireLine(importId: number, lineId: number): ImportLine {
    const line = getLine(db, lineId);
    if (!line || line.importId !== importId) {
      throw new NotFoundError(`Line ${lineId} does not exist in this import`);
    }
    return line;
  }

  function requireGroup(importId: number, groupId: number): ImportGroup {
    const group = listGroups(db, importId).find((g) => g.id === groupId);
    if (!group) throw new NotFoundError(`Group ${groupId} does not exist in this import`);
    return group;
  }

  /** Typed constraints of the line's attributes that have a definition and a readable value. */
  function lineConstraints(fields: ImportLineFields): RequirementConstraint[] {
    const attributes = expandAttributes(fields.attributes.map((a) => ({ ...a, label: a.key })));
    return attributes.flatMap((attribute) => {
      const definition = getAttributeDefinition(db, attribute.key);
      if (!definition) return [];
      let value;
      try {
        value = typedAttributeValue(definition, attribute);
      } catch (error) {
        if (error instanceof InventoryError) return [];
        throw error;
      }
      if (value.valueText === null && value.valueNumber === null && value.valueBoolean === null) {
        return [];
      }
      return [
        {
          ...value,
          comparison: "equal" as const,
          rawMaxValue: null,
          maxValueNumber: null,
          key: definition.key,
          label: definition.label,
          normalization: definition.normalization,
        },
      ];
    });
  }

  /** Deterministic catalog candidates for a line's current fields. */
  function lineCandidates(fields: ImportLineFields) {
    const category = fields.categoryId === null ? null : getCategory(db, fields.categoryId);
    const requirement = requirementOf(
      db,
      {
        unit: fields.unit && isUnit(fields.unit) ? fields.unit : null,
        partId: null,
        categoryId: category?.id ?? null,
        categoryName: category?.name ?? null,
        manufacturer: fields.manufacturer,
        partNumber: fields.partNumber,
      },
      lineConstraints(fields)
    );
    const candidates = matchRequirement(db, requirement, { supplierSku: fields.supplierSku });
    return { requirement, candidates };
  }

  /** The catalog parts that a line can match, as the cleanup prompt lists them. */
  function promptParts(context: CatalogContext): PromptPart[] {
    const paths = new Map(context.categories.map((c) => [c.id, c.path]));
    const parts = searchParts(db, {
      text: null,
      categoryId: null,
      attributes: [],
      tags: [],
      includeArchived: false,
    });
    const attributes = Map.groupBy(
      listAttributesOfParts(
        db,
        parts.map((p) => p.id)
      ),
      (a) => a.partId
    );
    return parts.map((part) => ({
      id: part.id,
      name: part.name,
      category: part.categoryId === null ? null : (paths.get(part.categoryId) ?? null),
      manufacturer: part.manufacturer,
      partNumber: part.partNumber,
      baseUnit: part.baseUnit,
      attributes: (attributes.get(part.id) ?? []).map((a) => `${a.key}=${a.rawValue}`),
    }));
  }

  /** Replace the lines and groups with new proposals. Each line starts as a new catalog part. */
  function saveProposals(
    record: ImportRecord,
    normalized: NormalizedImport,
    meta: { modelId: string | null; usage: ExtractionUsage | null; versioned: boolean }
  ) {
    inTransaction(() => {
      requireOpen(record.id);
      clearProposals(db, record.id);
      const groupIds = new Map<string, number>();
      for (const group of normalized.groups) {
        groupIds.set(group.name.toLowerCase(), insertGroup(db, record.id, group));
      }
      for (const line of normalized.lines) {
        const { proposal } = line;
        insertLine(db, record.id, {
          groupId:
            proposal.groupName === null
              ? null
              : (groupIds.get(proposal.groupName.toLowerCase()) ?? null),
          sourceRow: line.sourceRow,
          sourceExcerpt: line.sourceExcerpt,
          proposal,
          fields: proposal.fields,
          resolution: "new",
          partId: null,
        });
      }
      const extracted = Object.fromEntries(
        Object.entries(normalized.header).filter(([, value]) => value !== null)
      );
      recordParse(db, record.id, {
        modelId: meta.modelId,
        promptVersion: meta.versioned ? PROMPT_VERSION : null,
        schemaVersion: meta.versioned ? SCHEMA_VERSION : null,
        inputTokens: meta.usage?.inputTokens ?? null,
        outputTokens: meta.usage?.outputTokens ?? null,
        totalTokens: meta.usage?.totalTokens ?? null,
        header: { ...record.header, ...extracted },
        headerProvenance: normalized.headerProvenance,
      });
    });
  }

  function checkEdit(record: ImportRecord, edit: LineEdit) {
    if (edit.groupId !== null) {
      if (record.kind !== "project") throw new InventoryError("Only BOM lines have groups");
      requireGroup(record.id, edit.groupId);
    }
    if (edit.resolution === "requirement" && record.kind === "order") {
      throw new InventoryError("An order line needs an existing or a new part");
    }
    if (edit.resolution === "existing") {
      if (edit.partId === null) throw new InventoryError("Choose the existing part");
      if (!getPart(db, edit.partId)) throw new NotFoundError(`Part ${edit.partId} does not exist`);
    }
  }

  function storedEdit(edit: LineEdit) {
    return { ...edit, partId: edit.resolution === "existing" ? edit.partId : null };
  }

  function newPartInput(record: ImportRecord, fields: ImportLineFields): PartInput {
    const supplier = record.header.supplier;
    return {
      name: fields.description,
      categoryId: fields.categoryId,
      baseUnit: fields.unit as Unit,
      manufacturer: fields.manufacturer,
      partNumber: fields.partNumber,
      // BOM line notes describe the project use, so they stay on the BOM row only.
      notes: record.kind === "order" ? fields.notes : null,
      attributes: fields.attributes.map((a) => ({
        key: normalizeAttributeKey(a.key),
        label: a.key,
        value: a.value,
      })),
      aliases: [],
      tags: [],
      supplierParts:
        record.kind === "order" && supplier && fields.supplierSku
          ? [
              {
                id: null,
                supplier,
                sku: fields.supplierSku,
                url: null,
                purchaseUnit: fields.purchaseUnit,
                packQuantity: Number(fields.packQuantity),
              },
            ]
          : [],
    };
  }

  function bomLineInput(
    line: ImportLine,
    partId: number | null,
    componentId: number | null
  ): BomLineInput {
    const f = line.fields;
    const requirement = line.resolution === "requirement";
    return {
      description: f.description,
      amount: f.quantity!,
      unit: f.unit as Unit,
      componentId,
      referenceDesignators: f.referenceDesignators,
      notes: f.notes,
      partId,
      categoryId: requirement ? f.categoryId : null,
      manufacturer: requirement ? f.manufacturer : null,
      partNumber: requirement ? (f.partNumber ?? f.supplierSku) : null,
      constraints: requirement
        ? f.attributes.map((a) => ({
            key: a.key,
            comparison: "equal" as const,
            value: a.value,
            maxValue: null,
          }))
        : [],
    };
  }

  function headerProblems(record: ImportRecord): string[] {
    const { header } = record;
    if (record.kind === "order") return header.supplier ? [] : ["Enter the supplier"];
    if (header.projectId !== null) {
      return getProject(db, header.projectId) ? [] : ["Choose an existing project"];
    }
    return header.projectName ? [] : ["Choose a project or enter a name for a new one"];
  }

  /** Create the order and its lines. New parts are created first. */
  function commitOrder(record: ImportRecord, lines: ImportLine[]) {
    const { header } = record;
    const { id: orderId } = orders.createOrder({
      supplier: header.supplier!,
      reference: header.reference,
      expectedOn: null,
      trackingUrl: null,
      notes: header.notes,
    });
    lines.forEach((line, index) =>
      atLine(index, () => {
        const f = line.fields;
        const createdPartId =
          line.resolution === "new" ? catalog.createPart(newPartInput(record, f)) : null;
        const orderLineId = orders.addLine(orderId, {
          partId: createdPartId ?? line.partId!,
          supplierSku: f.supplierSku,
          purchaseQuantity: Number(f.quantity),
          purchaseUnit: f.purchaseUnit!,
          packQuantity: Number(f.packQuantity),
          unitPrice: f.unitPrice,
          currency: f.unitPrice === null ? null : parseCurrency(f.currency),
          notes: f.notes,
        });
        recordLineCommit(db, line.id, { createdPartId, orderLineId, bomLineId: null });
      })
    );
    // An imported order with a date was already placed at the supplier. Headers saved before
    // the order date existed have no placedOn.
    if (header.placedOn && lines.length > 0) orders.markPlaced(orderId, header.placedOn);
    return { orderId, projectId: null };
  }

  /**
   * Add the BOM rows to the project with their components. A group with lines becomes a
   * component of the project; an existing component with the same name is reused.
   */
  function commitProject(record: ImportRecord, lines: ImportLine[]) {
    const { header } = record;
    const projectId =
      header.projectId ??
      projects.createProject({
        name: header.projectName!,
        status: "planned",
        notes: header.notes,
        links: [],
      });
    const existing = listComponents(db, projectId);
    const componentIds = new Map<number, number>();
    for (const group of listGroups(db, record.id)) {
      if (!lines.some((line) => line.groupId === group.id)) continue;
      const same = existing.find((c) => c.name.toLowerCase() === group.name.toLowerCase());
      componentIds.set(
        group.id,
        same?.id ?? projects.createComponent(projectId, { name: group.name, notes: null })
      );
    }
    lines.forEach((line, index) =>
      atLine(index, () => {
        const createdPartId =
          line.resolution === "new" ? catalog.createPart(newPartInput(record, line.fields)) : null;
        const partId = line.resolution === "requirement" ? null : (createdPartId ?? line.partId);
        const componentId = line.groupId === null ? null : componentIds.get(line.groupId)!;
        const bomLineId = projects.createBomLine(
          projectId,
          bomLineInput(line, partId, componentId)
        );
        recordLineCommit(db, line.id, { createdPartId, orderLineId: null, bomLineId });
      })
    );
    return { orderId: null, projectId };
  }

  function createDraft(input: NewImport, header: ImportHeader = EMPTY_HEADER): number {
    const csvSettings =
      input.sourceType === "csv" ? defaultCsvSettings(sourceRows("csv", input.sourceText)) : null;
    return insertImport(db, {
      ...input,
      sourceHash: sourceHash(input.sourceText),
      csvSettings,
      header,
    });
  }

  function mapCsvColumns(id: number): number {
    const record = requireOpen(id);
    const { rows, csv } = sourceView(record);
    if (!csv) throw new InventoryError("Column mapping needs a CSV source");
    const normalized = normalizeOutput(
      record.kind,
      loadCatalogContext(db),
      outputFromColumns(record.kind, rows, csv.settings)
    );
    saveProposals(record, normalized, { modelId: null, usage: null, versioned: false });
    return normalized.lines.length;
  }

  return {
    listImports: () => listImports(db),

    /** Save the source as a draft. Nothing is sent anywhere. */
    createImport(input: NewImport): number {
      return createDraft(input);
    },

    /**
     * Split extension CSV into one draft per supplier order. A supplier order that already has an
     * order or an import (open, committed, or skipped) is skipped, so a repeated run of the
     * extension imports only new orders. If a
     * row cannot be identified, save one ordinary draft so no source row is lost. That draft
     * gets lines from its columns when they include a description, such as a DigiKey copy.
     */
    createCsvOrderBatch(input: NewImport): CsvOrderBatchResult {
      if (input.kind !== "order" || input.sourceType !== "csv") {
        return { ids: [createDraft(input)], skipped: [], batched: false };
      }
      const rows = sourceRows("csv", input.sourceText);
      const fallback = (): CsvOrderBatchResult =>
        inTransaction(() => {
          const id = createDraft(input);
          if (defaultCsvSettings(rows).roles.includes("description")) mapCsvColumns(id);
          return { ids: [id], skipped: [], batched: false };
        });

      const header = rows[0]?.cells ?? [];
      const names = header.map((name) => name.trim().toLowerCase());
      const supplierIndex = names.indexOf("supplier");
      const referenceIndex = names.indexOf("order_reference");
      const descriptionIndex = names.indexOf("description");
      const dataRows = rows.slice(1);
      if (
        supplierIndex < 0 ||
        referenceIndex < 0 ||
        descriptionIndex < 0 ||
        dataRows.length === 0
      ) {
        return fallback();
      }

      const groups = new Map<string, { supplier: string; reference: string; rows: string[][] }>();
      for (const row of dataRows) {
        const supplier = row.cells[supplierIndex]?.trim() ?? "";
        const reference = row.cells[referenceIndex]?.trim() ?? "";
        if (!supplier || !reference) return fallback();
        const key = `${supplier.toLowerCase()}\u0000${reference.toLowerCase()}`;
        const group = groups.get(key) ?? { supplier, reference, rows: [] };
        group.rows.push(row.cells);
        groups.set(key, group);
      }

      return inTransaction(() => {
        const ids: number[] = [];
        const skipped: CsvOrderBatchResult["skipped"] = [];
        for (const group of groups.values()) {
          if (
            listOrdersWithReference(db, group.supplier, group.reference, null).length > 0 ||
            listOrderImportsWithReference(db, group.supplier, group.reference).length > 0
          ) {
            skipped.push({ supplier: group.supplier, reference: group.reference });
            continue;
          }
          const sourceText = formatCsv([header, ...group.rows]);
          const id = createDraft(
            { ...input, sourceText },
            {
              ...EMPTY_HEADER,
              supplier: group.supplier,
              reference: group.reference,
            }
          );
          mapCsvColumns(id);
          ids.push(id);
        }
        return { ids, skipped, batched: true };
      });
    },

    /** Correct the source text. Existing lines stay until the next parse. */
    updateSource(id: number, sourceText: string): void {
      inTransaction(() => {
        const record = requireOpen(id);
        let csvSettings = record.csvSettings;
        if (record.sourceType === "csv") {
          const fresh = defaultCsvSettings(sourceRows("csv", sourceText));
          // Keep the roles of columns that still exist.
          csvSettings = {
            hasHeader: csvSettings?.hasHeader ?? true,
            roles: fresh.roles.map((role, i) => csvSettings?.roles[i] ?? role),
          };
        }
        updateSource(db, id, { sourceText, sourceHash: sourceHash(sourceText), csvSettings });
      });
    },

    setCsvSettings(id: number, settings: CsvSettings): void {
      inTransaction(() => {
        const record = requireOpen(id);
        if (record.sourceType !== "csv") throw new InventoryError("This source is not CSV");
        updateSource(db, id, { ...record, csvSettings: settings });
      });
    },

    /**
     * Send the saved source to the extractor and replace the lines with its normalized
     * proposals. The import is marked as parsing before the call. A failed call or an answer
     * that does not match the schema marks it failed; its source and lines stay as they were.
     * Parsing writes only import tables.
     */
    async parse(id: number, extractor: Extractor): Promise<ParseOutcome> {
      const record = requireOpen(id);
      const context = loadCatalogContext(db);
      const { rows, csv } = sourceView(record);
      setParseState(db, id, "parsing", null);

      const fail = (error: string): ParseOutcome => {
        setParseState(db, id, "failed", error);
        return { ok: false, error };
      };
      let result;
      try {
        result = await extractor({
          kind: record.kind,
          system: systemPrompt(record.kind, context),
          prompt: sourcePrompt(rows, csv?.settings ?? null),
        });
      } catch (error) {
        if (error instanceof ExtractionError) return fail(error.message);
        return fail(`Parsing failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      const parsed = OUTPUT_SCHEMAS[record.kind].safeParse(result.output);
      if (!parsed.success) {
        return fail(
          `The model's answer did not match the ${record.kind} schema: ${parsed.error.issues
            .slice(0, 3)
            .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
            .join("; ")}`
        );
      }
      const normalized = normalizeOutput(record.kind, context, parsed.data);
      saveProposals(record, normalized, {
        modelId: result.modelId,
        usage: result.usage,
        versioned: true,
      });
      return { ok: true, lineCount: normalized.lines.length };
    },

    /**
     * Ask the extractor to clean up one order line: a cleaner description, the category, the
     * attributes, the purchase unit, pack size, and base unit when it can tell them, and the
     * existing catalog part that is the same item. A classifier, when given, chooses the
     * category and the matched part instead of the extractor. The line and its proposal
     * change; a matched part makes the line commit as that part. A failed call or an invalid
     * answer changes nothing.
     */
    async cleanupLine(
      id: number,
      lineId: number,
      extractor: Extractor,
      classifier: Classifier | null = null
    ): Promise<CleanupOutcome> {
      const record = requireOpen(id);
      if (record.kind !== "order") throw new InventoryError("Only order lines can be cleaned up");
      const line = requireLine(id, lineId);
      const context = loadCatalogContext(db);
      const f = line.fields;
      const parts = promptParts(context);

      const cleanupInput: CleanupLine = {
        supplier: record.header.supplier,
        sourceExcerpt: line.sourceExcerpt,
        description: f.description,
        category: context.categories.find((c) => c.id === f.categoryId)?.path ?? null,
        manufacturer: f.manufacturer,
        partNumber: f.partNumber,
        supplierSku: f.supplierSku,
        attributes: f.attributes,
        notes: f.notes,
        purchaseUnit: f.purchaseUnit,
        packQuantity: f.packQuantity,
        baseUnit: f.unit,
      };

      // Jev, when configured, chooses the category and the matched part instead of the
      // extractor. Both calls run at the same time.
      const [call, classified] = await Promise.all([
        extractLine(
          extractor,
          {
            kind: "line_cleanup",
            system: cleanupSystemPrompt(context),
            prompt: cleanupPrompt(
              cleanupInput,
              parts,
              lineCandidates(f).candidates.map((c) => c.part.id)
            ),
          },
          "Cleanup"
        ),
        classifyLine(classifier, { line: cleanupInput, categories: context.categories, parts }),
      ]);
      if (!call.ok) return call;
      if (!classified.ok) return classified;
      const parsed = lineCleanupSchema.safeParse(call.output);
      if (!parsed.success) {
        return { ok: false, error: "The model's answer did not match the cleanup schema" };
      }
      const output = withClassification(parsed.data, classified.classification);
      // Only a part from the list can be chosen; another ID is not a match.
      const matched = parts.find((p) => p.id === output.match?.partId) ?? null;

      inTransaction(() => {
        requireOpen(id);
        // Apply to the line as it is now, in case it was saved during the call.
        const fresh = requireLine(id, lineId);
        const proposal = cleanupLine(context, fresh, output);
        if (output.match && !matched) {
          proposal.unresolved.push(`Matched part ${output.match.partId} is not in the catalog`);
        }
        updateLineProposal(db, lineId, proposal);
        updateLine(db, lineId, {
          groupId: fresh.groupId,
          fields: proposal.fields,
          resolution: matched ? "existing" : fresh.resolution,
          partId: matched ? matched.id : fresh.partId,
        });
      });
      return { ok: true, matchedPart: matched && { id: matched.id, name: matched.name } };
    },

    /**
     * Ask the extractor to split one order line into the different items it holds, such as the
     * values of an assortment pack. The line becomes the first item and the other items are
     * new lines after it. Each item commits as a new part until the owner matches it; the
     * owner's notes guide the split. A failed call, an invalid answer, or an answer with fewer
     * than two items changes nothing.
     */
    async splitLine(
      id: number,
      lineId: number,
      extractor: Extractor,
      ownerNotes: string | null
    ): Promise<SplitOutcome> {
      const record = requireOpen(id);
      if (record.kind !== "order") throw new InventoryError("Only order lines can be split");
      const line = requireLine(id, lineId);
      const context = loadCatalogContext(db);
      const f = line.fields;

      const call = await extractLine(
        extractor,
        {
          kind: "line_split",
          system: splitSystemPrompt(context),
          prompt: splitPrompt(
            {
              supplier: record.header.supplier,
              sourceExcerpt: line.sourceExcerpt,
              description: f.description,
              category: context.categories.find((c) => c.id === f.categoryId)?.path ?? null,
              manufacturer: f.manufacturer,
              partNumber: f.partNumber,
              supplierSku: f.supplierSku,
              attributes: f.attributes,
              notes: f.notes,
              quantity: f.quantity,
              purchaseUnit: f.purchaseUnit,
              packQuantity: f.packQuantity,
              baseUnit: f.unit,
            },
            ownerNotes
          ),
        },
        "Split"
      );
      if (!call.ok) return call;
      const parsed = lineSplitSchema.safeParse(call.output);
      if (!parsed.success) {
        return { ok: false, error: "The model's answer did not match the split schema" };
      }
      if (parsed.data.items.length < 2) {
        return {
          ok: false,
          error:
            "The model found only one item in the line, so nothing changed. Describe the items in the notes and try again.",
        };
      }

      return inTransaction(() => {
        requireOpen(id);
        // Apply to the line as it is now, in case it was saved during the call.
        const fresh = requireLine(id, lineId);
        const [first, ...rest] = splitLine(context, fresh, parsed.data);
        updateLineProposal(db, lineId, first);
        updateLine(db, lineId, {
          groupId: fresh.groupId,
          fields: first.fields,
          resolution: "new",
          partId: null,
        });
        makeRoomAfter(db, id, fresh.position, rest.length);
        rest.forEach((proposal, index) =>
          insertLine(
            db,
            id,
            {
              groupId: fresh.groupId,
              sourceRow: fresh.sourceRow,
              sourceExcerpt: fresh.sourceExcerpt,
              proposal,
              fields: proposal.fields,
              resolution: "new",
              partId: null,
            },
            fresh.position + index + 1
          )
        );
        return { ok: true as const, lineCount: rest.length + 1 };
      });
    },

    /** Lines from the owner's CSV column roles, without a model. Replaces the lines. */
    linesFromColumns(id: number): number {
      return mapCsvColumns(id);
    },

    updateHeader(id: number, header: ImportHeader): void {
      inTransaction(() => {
        const record = requireOpen(id);
        if (header.projectId !== null && !getProject(db, header.projectId)) {
          throw new NotFoundError(`Project ${header.projectId} does not exist`);
        }
        updateHeader(db, id, {
          ...EMPTY_HEADER,
          ...(record.kind === "order"
            ? { supplier: header.supplier, reference: header.reference, placedOn: header.placedOn }
            : { projectId: header.projectId, projectName: header.projectName }),
          notes: header.notes,
        });
      });
    },

    /** Add a line the owner enters, such as after a failed parse. */
    addLine(id: number, edit?: LineEdit): number {
      return inTransaction(() => {
        const record = requireOpen(id);
        const line = edit ?? {
          fields: emptyLineFields(),
          groupId: null,
          resolution: "new" as const,
          partId: null,
        };
        checkEdit(record, line);
        return insertLine(db, id, {
          ...storedEdit(line),
          sourceRow: null,
          sourceExcerpt: null,
          proposal: null,
        });
      });
    },

    updateLine(id: number, lineId: number, edit: LineEdit): void {
      inTransaction(() => {
        const record = requireOpen(id);
        requireLine(id, lineId);
        checkEdit(record, edit);
        updateLine(db, lineId, storedEdit(edit));
      });
    },

    removeLine(id: number, lineId: number): void {
      inTransaction(() => {
        requireOpen(id);
        requireLine(id, lineId);
        deleteLine(db, lineId);
      });
    },

    addGroup(id: number, name: string): number {
      return inTransaction(() => {
        if (requireOpen(id).kind !== "project") {
          throw new InventoryError("Only BOM imports have component groups");
        }
        return insertGroup(db, id, { name, sourceRow: null, sourceExcerpt: null });
      });
    },

    renameGroup(id: number, groupId: number, name: string): void {
      inTransaction(() => {
        requireOpen(id);
        requireGroup(id, groupId);
        renameGroup(db, groupId, name);
      });
    },

    /** Remove a group. Its lines become ungrouped. */
    removeGroup(id: number, groupId: number): void {
      inTransaction(() => {
        requireOpen(id);
        requireGroup(id, groupId);
        deleteGroup(db, groupId);
      });
    },

    /** Delete an import that was not committed. Nothing outside the import changes. */
    discard(id: number): void {
      inTransaction(() => {
        requireOpen(id);
        deleteImport(db, id);
      });
    },

    /** Everything the review page shows: source, proposals, candidates, problems, warnings. */
    getReview(id: number) {
      const record = getImport(db, id);
      if (!record) return null;
      const groups = listGroups(db, id);
      const lines = listLines(db, id).map((line) => {
        const part = line.partId === null ? null : getPart(db, line.partId);
        const { requirement, candidates } = lineCandidates(line.fields);
        const identifierConflicts = candidates
          .filter((c) => IDENTIFIER_SOURCES.has(c.source) && c.status === "conflict")
          .map((c) => `${c.part.name} has this identifier, but: ${c.conflicts.join("; ")}`);
        const f = line.fields;
        let conversion: string | null = null;
        const baseUnit = part?.baseUnit ?? f.unit;
        if (record.kind === "order" && baseUnit && f.purchaseUnit) {
          const purchaseQuantity = Number(f.quantity);
          const packQuantity = Number(f.packQuantity);
          if (
            Number.isInteger(purchaseQuantity) &&
            purchaseQuantity > 0 &&
            Number.isInteger(packQuantity) &&
            packQuantity > 0
          ) {
            conversion = describePackConversion({
              purchaseQuantity,
              purchaseUnit: f.purchaseUnit,
              packQuantity,
              baseUnit,
            });
          }
        }
        return {
          ...line,
          part,
          candidates: candidates.map((c) => ({ ...c, sourceLabel: SOURCE_LABELS[c.source] })),
          identifierConflicts,
          /** Required attributes a generic requirement or new part does not state. */
          missingRequired:
            line.resolution === "existing" ? [] : requirement.missingRequired.map((m) => m.label),
          conversion,
          /** Readable typed attribute values, such as 4.7 kΩ for 4k7, by key. */
          readings: Object.fromEntries(
            lineConstraints(f).map((c) => [
              c.key,
              formatAttributeValue(c.normalization, c) ?? c.rawValue,
            ])
          ),
          problems: lineProblems(record.kind, line, part),
        };
      });
      return {
        record,
        source: sourceView(record),
        groups,
        lines,
        headerProblems: headerProblems(record),
        sameSource: listImportsWithSource(db, record.kind, record.sourceHash, id),
        sameReference:
          record.kind === "order" && record.header.supplier && record.header.reference
            ? listOrdersWithReference(db, record.header.supplier, record.header.reference, null)
            : [],
      };
    },

    /** Options for the review forms. */
    reviewOptions() {
      return {
        categories: categoryOptions(listCategories(db)),
        definitions: loadCatalogContext(db).definitions.map(
          ({ key, label, canonicalUnit, normalization }) => ({
            key,
            label,
            canonicalUnit,
            normalization,
          })
        ),
        parts: searchParts(db, {
          text: null,
          categoryId: null,
          attributes: [],
          tags: [],
          includeArchived: false,
        }).map(({ id, name, baseUnit, partNumber }) => ({ id, name, baseUnit, partNumber })),
        projects: listProjects(db).map(({ id, name }) => ({ id, name })),
        units: Object.keys(UNITS),
      };
    },

    /**
     * Commit the reviewed import in one transaction: new parts, then the draft order and its
     * lines, or the project's components and BOM rows. A repeated commit returns the recorded
     * result and creates nothing. No stock movement is recorded.
     */
    commit(id: number, operationId: string): CommitResult {
      return inTransaction(() => {
        const record = requireImport(id);
        if (record.commitState === "committed") {
          return { orderId: record.orderId, projectId: record.projectId, repeated: true };
        }
        const lines = listLines(db, id);
        // An order import whose lines were all removed records the supplier order as handled
        // without creating an order, so a later import of it is skipped.
        if (lines.length === 0 && record.kind === "order") {
          if (!record.header.supplier || !record.header.reference) {
            throw new InventoryError(
              "Enter the supplier and the order reference, so that the order is not imported again"
            );
          }
          recordCommit(db, id, { operationId, orderId: null, projectId: null });
          return { orderId: null, projectId: null, repeated: false };
        }
        if (lines.length === 0) throw new InventoryError("Add at least one line before committing");
        const problems = [
          ...headerProblems(record),
          ...lines.flatMap((line, index) =>
            lineProblems(
              record.kind,
              line,
              line.partId === null ? null : getPart(db, line.partId)
            ).map((problem) => `Line ${index + 1}: ${problem}`)
          ),
        ];
        if (problems.length > 0) throw new InventoryError(problems.join(". "));

        const result =
          record.kind === "order" ? commitOrder(record, lines) : commitProject(record, lines);
        recordCommit(db, id, { operationId, ...result });
        return { ...result, repeated: false };
      });
    },
  };
}

/** Run a line's commit step; a rejected change names the line. */
function atLine(index: number, fn: () => void) {
  try {
    fn();
  } catch (error) {
    if (isUserError(error)) throw new InventoryError(`Line ${index + 1}: ${error.message}`);
    throw error;
  }
}
