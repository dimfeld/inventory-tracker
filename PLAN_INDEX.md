# Inventory tracker plans

These tim plans cover `IMPLEMENTATION.md`. Each plan includes its own project context, design rules, planned work, and acceptance checks. Structured task arrays are empty for later task generation.

Plan 1 is the initial implementation parent. Plans 2–9 are its children and follow one dependency chain. Plans 10–18 are standalone optional plans. Plans 10–18 depend on plan 1 and have no parent. Plan 19 is a standalone follow-up to QR labels and depends on plan 12.

tim stores plans in its database. The local `.tim/plans/` files are materialized copies and are excluded from source control by this repository. This index records the plan IDs and coverage.

## Initial implementation

| ID  | Plan                                                   | Depends on       |
| --- | ------------------------------------------------------ | ---------------- |
| 1   | Initial inventory tracker implementation (parent)      | Child completion |
| 2   | Catalog, SQLite, and physical stock                    | None             |
| 3   | Typed categories, normalization, and inventory filters | 2                |
| 4   | Projects, BOM editing, and deterministic part matching | 3                |
| 5   | Reservations, picking, project use, and returns        | 4                |
| 6   | Orders, delivery review, and partial receipts          | 5                |
| 7   | Incoming commitments and project shopping lists        | 6                |
| 8   | Reviewed GPT-6 Luna order and BOM imports              | 7                |
| 9   | Phone workflows, LAN operation, and backup recovery    | 8                |

## Optional plans

| ID  | Plan                                                     | Depends on |
| --- | -------------------------------------------------------- | ---------- |
| 10  | Optional part photos and reference attachments           | 1          |
| 11  | Optional reorder points and preferred suppliers          | 1          |
| 12  | Optional bin labels and QR navigation                    | 1          |
| 13  | Optional repeated builds and BOM duplication             | 1          |
| 14  | Optional inventory and shopping CSV export               | 1          |
| 15  | Optional order costs and project estimates               | 1          |
| 16  | Optional kits and hardware assortment contents           | 1          |
| 17  | Optional reusable equipment and loans                    | 1          |
| 18  | Optional PDF, image, spreadsheet, and URL import sources | 1          |

## Follow-up scanner

| ID  | Plan                                                  | Depends on |
| --- | ----------------------------------------------------- | ---------- |
| 19  | Phone QR scanner with item and container highlighting | 12         |

Plan 19 detects multiple visible labels, identifies parts and containers, and highlights labels for a selected part or containers with recorded stock of that part. It uses the existing Caddy HTTPS hosting.

## BOM component groups

Projects can optionally group related BOM rows into named components, such as Power supply or Controller, and can keep rows ungrouped. Grouping does not exclude requirements from the build or change their stock allocations.

Plan 4 owns the component data model and editing controls. Plans 5, 7, 8, and 9 cover picking, coverage/shopping breakdowns, reviewed imports, and local recovery. Plans 13, 14, and 15 preserve groups in duplication, exports, and cost estimates. Plan 1 includes this requirement in the initial contract.

## Use

View a plan with `tim show <id> --full`. Use `tim ready` to find plans whose dependencies are complete. The first implementation plan is 2.

Generate structured tasks with `tim generate <id>` when ready to work on that plan. Optional plans include owner choices to resolve before the related work starts, such as reorder metrics, label dimensions, cost basis, kit representation, equipment identity, and additional import formats.

To edit a plan file, run `tim materialize <id>`, edit `.tim/plans/<id>.plan.md`, then run `tim sync <id>`.
