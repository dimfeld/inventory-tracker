---
name: audit-catalog
description: Audit the categories and attributes of the PROD inventory database. Finds parts without a category or in the wrong category, missing or useful new categories and attributes, attribute values that are not consistent or not readable, and values that can be filled in from part names. Asks the user which changes to make, then applies them with a backup. Use when the user asks to audit, clean up, standardize, or extend categories, attributes, or attribute values.
---

# Audit the catalog taxonomy

This skill works on the **prod database**: `~/.local/share/inventory-tracker/inventory.sqlite`.
That is the database of the running app and the one the user cares about. Do not audit
`data/inventory.sqlite` in the repo: it is a development database with test data.

All reads and writes go through `.claude/skills/audit-catalog/catalog.ts`, which uses the app's
own services and the prod database by default. Run it from the repository root with `bun`.
Do not write SQL against the prod database.

## Rules

- **Make no change before the user approves it.** First collect and present proposals. Then
  ask with the AskUserQuestion tool. Apply only the changes that the user selects.
- Every value you add must come from evidence: the part name, notes, manufacturer part number,
  or an existing attribute. Never guess a dimension or a type. If the evidence is not clear,
  leave the value out and list it as an open question.
- Do not delete a category or attribute that is in use. The services refuse this anyway.
- `apply` makes a backup in `~/.local/share/inventory-tracker/backups/` before it writes.
  Always tell the user the backup path.

## Steps

### 1. Read the current state

```sh
bun .claude/skills/audit-catalog/catalog.ts report > "$SCRATCH/catalog-report.json"
```

Use your scratchpad directory for `$SCRATCH`. The report has:

- `categories`: full path, parent, the attribute keys assigned directly (with `required`),
  and the counts of parts, child categories, and BOM rows.
- `attributes`: each definition (key, label, value type, normalization rule, unit), its
  categories, and its distinct values with `readsAs` (the typed reading; `null` means the rule
  cannot read the value) and part counts.
- `parts`: ID, name, category path, archived flag, and attribute values (raw text by key).

To see one attribute's values in detail: `catalog.ts values KEY`.

### 2. Find problems and opportunities

Check each of these and collect concrete proposals with part IDs and values:

**Categories**
- Parts without a category, and parts in a parent category that fit a child category.
- Parts in the wrong category (for example, a tool in Hardware).
- Groups of similar parts that have no category of their own, or categories that are empty
  or that have only one part that fits a sibling category.
- Hierarchy that does not make sense (a category under the wrong parent).

**Attribute definitions**
- Useful attributes that do not exist yet, which part names show clearly (for example, shank
  diameter for CNC bits, or color for LEDs).
- Two definitions for the same property (synonyms such as `od` and `outer_diameter`).
- Unused definitions, and definitions with an unsuitable type or rule (for example, a text
  attribute that holds measurements).
- Categories where many parts have an attribute that is not assigned to the category, and
  required flags that do not fit.

**Attribute values**
- Values that mean the same but are written differently: case, spelling, or synonyms (for
  example `Socket head`, `socket-head`, and `Hexagon socket head cap`). Propose one standard
  form for each group.
- Values that the rule cannot read (`readsAs: null`), such as `3.28 Ft` or `1/8"`. Propose a
  readable form.
- Values that are in the wrong attribute (for example, a cutting length stored as `length`).
- Missing values that the part name states clearly.

### 3. Ask the user

Present the proposals in groups (categories, new attributes, value standardization, missing
values), with a short reason and the affected parts for each. Then use AskUserQuestion, with
`multiSelect: true` where the user can choose several proposals. If there are too many
proposals for one question, ask group by group. Accept free-text changes from the user's
"Other" answers. If the user approves nothing, stop.

### 4. Write and check the plan

Write the approved changes as a JSON array of operations in the scratchpad. Then do a dry run.
The dry run runs every operation in a transaction and rolls it back:

```sh
bun .claude/skills/audit-catalog/catalog.ts apply "$SCRATCH/plan.json" --dry-run
```

Fix any error and run the dry run again. One failed operation stops the whole plan.

### 5. Apply and verify

```sh
bun .claude/skills/audit-catalog/catalog.ts apply "$SCRATCH/plan.json"
```

Run `report` again and confirm that the changes are there and that the new values are
readable (`readsAs` is not `null` for attributes with a rule). Then tell the user what changed,
the backup path, and the open questions that you did not apply.

## Plan format

A category is given by its ID or its full path, such as `"Hardware / Fasteners / Nuts"`. A
category created earlier in the same plan can be used by its path in later operations.

```json
[
  { "op": "createCategory", "name": "Nuts", "parent": "Hardware / Fasteners" },
  { "op": "updateCategory", "category": "Hardware / Materials", "name": "Raw materials", "parent": null },
  { "op": "deleteCategory", "category": "Electronics / Passives / Capacitors" },
  { "op": "setPartCategory", "partIds": [80, 91], "category": "Hardware / Fasteners / Nuts" },
  { "op": "createAttribute", "key": "shank_diameter", "label": "Shank diameter",
    "valueType": "number", "normalization": "length", "canonicalUnit": "mm" },
  { "op": "updateAttribute", "key": "head", "label": "Head type" },
  { "op": "deleteAttribute", "key": "unused_key" },
  { "op": "setApplicability", "key": "shank_diameter", "category": "Tooling / CNC bits", "required": true },
  { "op": "replaceValue", "key": "head", "from": "socket-head", "to": "Socket head" },
  { "op": "setPartValues", "key": "shank_diameter", "values": { "65": "3.175 mm", "70": "6.35 mm" } }
]
```

- `setApplicability` with `"required": null` removes the assignment. An attribute assigned to
  a category also applies to its child categories.
- `setPartValues` with a `null` value removes that part's value.
- `updateAttribute` changes only the given fields. A new type, rule, or unit types all stored
  values again. It is refused if BOM rows constrain the attribute.
- `replaceValue` matches the exact raw text, so it changes one spelling at a time.

## Attribute types and rules

Keys are lowercase with `_` (`shank_diameter`); the key cannot change later. Value types are
`text`, `number`, and `boolean`. The rules (from `src/lib/attributes.ts`) turn raw text into a
typed value for filters and BOM matching:

| Rule | Reads | Notes |
|---|---|---|
| `length` | `8`, `8 mm`, `1.2 cm`, `0.125 in`, `0.1"` | Stored in mm. A bare number is mm. **No fractions** (`1/8"`) and **no feet**: write `3.175 mm` or `0.125 in`, and `1000 mm` for `3.28 ft`. |
| `thread` | `M3`, `M3x8` | Metric threads. |
| `resistance`, `capacitance`, `voltage`, `power`, `percent` | `4k7`, `100n`, `5V`, `0.5W`, `5%` | Engineering notation. |
| `count` | `2`, `4 pin`, `3POS` | Whole numbers. |
| `keyword` | any text | Compared without case. Use for types and materials. |
| `code` | any text | Compared in upper case. Use for part codes, packages, and IC names. |

A `number` attribute without a rule takes only plain numbers (for example `tip_angle`: `90`).

Keep the raw text in a clean, readable form, because the app shows it. For example, write
`Carbon steel`, not `carbon steel`.

## Manual changes

The user can make the same changes in the app under **Settings** (Categories, Attributes, and
Locations tabs). The Attributes tab shows each attribute's values with a **Change** form to
standardize them.
