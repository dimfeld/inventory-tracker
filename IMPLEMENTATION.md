# Inventory tracker: initial implementation plan

## Purpose and scope

Build a personal inventory tracker for electronics and hardware projects. Use Bun, SvelteKit, TypeScript, and SQLite. Run one app instance on the LAN. Use GPT-6 Luna through the Vercel AI SDK for all LLM calls.

This document defines the initial design and build sequence. It does not implement the app.

The initial app must let the owner:

- Record parts and quantities in storage.
- Reserve parts for a project, pick them, and record their use or return.
- Track orders and receive all or some of their items.
- Create and edit projects and their bills of materials (BOMs), with optional named component groups.
- Parse order lists and project BOMs with an LLM, then review the result.
- Match project requirements to inventory and show shortages without counting the same supply twice.
- Filter parts by category and attributes, including combinations such as M3 screws.

Proof of implementation will be the workflow checks in the build stages below. Keep business rules in server modules with tests that use SQLite. Keep route code small.

Multiuser support, public hosting, production hardening, supplier integrations, and automatic purchasing are outside the initial scope. Basic data integrity and a usable backup remain necessary for a personal inventory database.

## Design decisions

### Parts, stock, and requirements are different records

A **part** is a catalog entry, such as an M3 × 8 mm socket-head screw. **Stock** is a quantity of that part at a location. A **requirement** states what a project needs. An **order line** states what was purchased.

A requirement can name an exact part or specify attributes. For example, a BOM might specify an M3 screw without giving its length. Keep that requirement incomplete until the owner supplies the missing constraint. Do not silently select an arbitrary M3 screw.

Supplier product names and pack sizes do not define part identity. A pack of 100 screws supplies 100 individual screws. Keep the supplier SKU and pack information on the order line or a supplier reference.

### Quantity meanings

| Display value        | Meaning                                                                                            |
| -------------------- | -------------------------------------------------------------------------------------------------- |
| In storage           | Physical quantity in drawers, bins, or other stock locations, including reserved stock             |
| Reserved, not picked | Part of storage stock committed to a project                                                       |
| Available            | In storage minus all active storage reservations                                                   |
| Picked               | Physical quantity moved from storage to a project holding location                                 |
| Used                 | Quantity consumed or installed in a project; no longer available inventory                         |
| Ordered / on the way | Outstanding confirmed order quantity; show placed and shipped states separately                    |
| Needed, not ordered  | Project requirement not covered by used, picked, reserved, or explicitly committed incoming supply |

These values overlap. Do not add all of them to calculate total inventory. Total physical stock is storage plus picked stock. Incoming supply is separate.

Use one base unit per part: pieces for screws and components, length for wire, and volume or mass where needed. Store exact quantities as integer base-unit amounts with a unit and conversion scale. Select the base unit from the actual measurement needs; do not set an arbitrary decimal precision. Do not match incompatible units. Show pack conversion explicitly before import or receipt.

### Reservations and picking

- A reservation reduces available stock without changing physical storage stock.
- Picking transfers stock to the project's holding location and reduces its reservation in the same transaction.
- Recording use removes picked stock from physical inventory and credits the BOM requirement.
- Returning unused parts transfers picked stock back to storage. Offer a choice to reserve those parts again.
- Project cancellation releases storage and incoming commitments. Picked items require an explicit return or use action.
- Project completion does not silently discard unused picked parts.

Track quantities, not a single status per BOM row. One requirement can be partly used, partly picked, partly reserved, and partly waiting for an order.

## Main workflows

### Catalog and stock

Create a part with its name, category, attributes, unit, aliases, supplier references, and notes. Add an opening stock quantity and storage location. Support manual entry even when no API key is configured.

Show stock by location, available quantity, project reservations, picked quantities, incoming orders, and movement history. A stock count correction records a dated adjustment with a reason. If a correction would leave reservations above physical stock, show the affected projects and require reservation changes as part of the correction.

### Order import and receipt

1. Create an order manually or paste an order list. Accept CSV input with a column preview as well.
2. Parse the source into editable draft lines. Preserve the source text and source row for each proposal.
3. Review quantities, pack sizes, categories, attributes, and proposed catalog matches. Choose an existing part or create a part.
4. Save the reviewed order with supplier, order reference, order date, optional expected arrival date, tracking link, and notes.
5. Mark it placed or shipped. Draft orders do not count as incoming supply.
6. On arrival, choose **Receive all outstanding items** or review lines with individual **Add to inventory** buttons. Show destination locations and quantities before receipt.

Record each receipt separately. Support partial deliveries, rejected or damaged items, and cancellation of the unfulfilled remainder. Receipt quantity must not exceed the outstanding amount unless the owner first records an order correction. Record usable received stock separately from damaged quantity.

Keep delivery and stock receipt distinct. The owner can mark a parcel delivered and leave its lines awaiting review. Only accepted receipts increase usable stock. A received order line has no outstanding supply even if its parent order is still open.

Receive an item, update the outstanding quantity, and convert its incoming project commitments to storage reservations in one transaction. If only part of a committed shipment arrives, use the commitment sequence to assign the received quantity; show the allocation before acceptance and allow changes. Leave the remaining commitment on the order line. Defective or missing items remain a visible shortage.

Each receipt submission has a unique operation ID. Repeated clicks or a repeated request must return the existing result instead of adding stock again. Do not deduplicate legitimate separate receipts just because their quantities are equal.

### Projects and BOMs

Create a project with a name, notes, optional link, and status: planned, active, paused, complete, or cancelled. Add or import requirements with quantities, units, reference designators, and optional notes.

Projects can optionally group related BOM rows into named **components**, such as Power supply, Controller, or Enclosure. A component belongs to its project and has a name, optional notes, and display order. Each BOM row can belong to a component in the same project or remain ungrouped. A project without components keeps a flat BOM. Here, optional means that grouping is optional; placing a requirement in a component does not exclude it from the build.

Provide component create, rename, reorder, and remove actions, plus controls to move BOM rows between components or to the ungrouped section. Removing a component moves its rows to the ungrouped section. Keep row IDs and all reservations, incoming commitments, picked stock, and recorded use intact. Grouping does not create a catalog part or an extra stock requirement.

Show components as BOM sections and allow component filters on coverage views and pick lists. Project totals include every BOM row once, including ungrouped rows. Component summaries use the same row quantities and retain part/unit distinctions; do not sum unlike parts or units into a misleading quantity. Viewing one component does not release stock or incoming supply committed to another component.

For each requirement, show the original description, constraints, selected parts, used quantity, picked quantity, reserved quantity, committed incoming quantity, and uncovered quantity. A requirement can use several approved parts and stock locations.

Provide actions to find candidates, approve a substitute, reserve, release, pick, record use, and return unused parts. A pick list shows locations and quantities. Changing a BOM quantity or part constraint must identify allocations that no longer fit. Resolve those allocations before saving the change; never silently remove physical picked stock.

### Matching and shortage planning

Use ordinary code for matching and arithmetic. The LLM extracts descriptions and attributes; it does not decide stock quantities or allocate inventory.

Match candidates in this order:

1. Exact manufacturer and part number, where supplied.
2. A known alias or supplier SKU mapped to a catalog part.
3. Category and normalized technical attributes.
4. Owner-approved substitutes for that requirement.

Identifiers still need a compatible unit and no conflicting supplied constraints. Preserve meaningful distinctions such as package, connector pitch, voltage rating, screw length, and head type. For generic requirements, check all required constraints. Unknown required attributes are unresolved, not matches. Apply ranges or minimum ratings only when the requirement explicitly permits them.

Show why each candidate matches and which constraints need review. Text search can find candidates but cannot prove interchangeability. Suggestions do not reserve stock. Reserve only after the owner accepts the choice.

For a BOM requirement:

```text
remaining = max(required - used - picked - reserved, 0)
needed_not_ordered = max(remaining - committed_incoming, 0)
```

All terms use compatible base units and refer to that requirement. When requirements change, remove excess commitments and report any excess picked or used quantity separately; the formula must not hide these conflicts.

Show unallocated available stock as a candidate supply. Commit it before treating the project as covered. Incoming commitments link specific quantities on specific order lines to specific BOM rows. Their sum cannot exceed that line's outstanding usable supply. Do not let the same incoming part cover several projects.

A combined shopping list includes uncovered requirements from planned, active, and paused projects, with controls to select which projects participate. Group identical part requirements. Keep ambiguous requirements separate and show the project breakdown. Selecting one project alone must not make stock reserved elsewhere appear available.

Keep component names in shopping-list breakdowns. Identical parts in different components can share a purchase suggestion, but each requirement keeps its own allocation. Component filters do not change reservations or project demand.

Example: storage contains 20 M3 × 8 mm screws. Project A reserves 8, leaving 12 available. Project B needs 15 and reserves 12. Its remaining need is 3. An order for 10 has 3 explicitly committed to B and 7 unallocated. B shows 12 reserved, 3 ordered, and 0 needed-not-ordered. Receiving those 3 transfers that incoming commitment into a storage reservation. Picking B's 15 moves them to its project location; it does not consume them.

### Categories and filters

Use a small category tree plus typed attributes and optional tags. Category examples are hardware → fasteners → screws and hardware → inserts → heat-set inserts. M3 is an attribute value shared across categories, not a separate branch for every possible combination.

| Filter           | Query meaning                      |
| ---------------- | ---------------------------------- |
| M3 items         | `thread = M3` across categories    |
| Screws           | Screw category and its descendants |
| M3 screws        | Screw category AND `thread = M3`   |
| Heat-set inserts | Heat-set insert category           |

Use AND between different filter fields and OR between selected values of the same field. Offer text search over names, aliases, manufacturer part numbers, and supplier SKUs. Show filters that apply to the selected category.

Starter attributes should cover the actual imported parts. Examples include thread, length, material, head and drive type for screws; thread and outer dimensions for inserts; resistance, tolerance, power, and package for resistors; capacitance, voltage, and package for capacitors; and pitch, pin count, gender, and mounting type for connectors.

Keep raw text beside normalized values. Normalize equivalent forms such as `4k7` and `4.7 kΩ`, or `M3x8` and separate thread/length fields. Do not infer a missing specification from a familiar product name.

## Data model

Use relational tables for identities, quantities, and links. Use category attribute definitions and structured attribute values for variable technical specifications. This avoids a column for every possible part feature while retaining typed comparisons.

| Table                        | Main data and role                                                                                                                                         |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `parts`                      | Name, category, base unit and conversion scale, manufacturer, part number, notes, archive state                                                            |
| `categories`                 | Name and parent category                                                                                                                                   |
| `attribute_definitions`      | Key, value type, canonical unit, applicable categories, normalization rule                                                                                 |
| `part_attributes`            | Part, attribute key, typed value, raw value; unique per part/key                                                                                           |
| `part_aliases`               | Alternate names for a part                                                                                                                                 |
| `supplier_parts`             | Supplier, SKU, part, product URL, purchase unit, pack conversion                                                                                           |
| `locations`                  | Storage or project holding location; project link for holding locations                                                                                    |
| `stock_movements`            | Part, quantity, source/destination location, movement type, date, reason, receipt/BOM links, operation ID                                                  |
| `projects`                   | Name, status, notes, links                                                                                                                                 |
| `project_components`         | Project, name, optional notes, display order                                                                                                               |
| `bom_lines`                  | Project, optional component in the same project, source description, required quantity/unit, exact part or typed constraints, reference designators, notes |
| `bom_part_choices`           | Approved part candidates for a BOM line, substitute flag, approval note                                                                                    |
| `reservations`               | BOM line, selected part, storage location, active reserved quantity                                                                                        |
| `orders`                     | Supplier, reference, placed/shipped state, dates, delivery review state, tracking link, notes                                                              |
| `order_lines`                | Order, reviewed part, purchase quantity, pack conversion, base quantity, cancelled/damaged quantities, optional cost/currency                              |
| `receipts` / `receipt_lines` | Receipt date, operation ID, order lines, accepted quantities, destinations, review notes                                                                   |
| `incoming_commitments`       | BOM line, order line, committed outstanding quantity, assignment sequence                                                                                  |
| `imports` / `import_lines`   | Source, import kind, schema/prompt/model versions, parse state, proposals, owner edits, commit state                                                       |

Derive stock balances from movements. An opening balance or receipt has an external source. A pick or return transfers between locations. Use, loss, and supplier return have an external destination with different movement types. Link project use to its BOM line. Preserve that link when crediting used quantities.

Derive picked quantities from project holding balances linked to BOM lines. Keep that link on project transfers and uses so that identical parts for different requirements remain distinguishable. Reservations are separate commitments; they are not physical movements.

Add foreign keys, quantity checks, and unique operation IDs. Use server transactions for rules that span rows: no negative physical balance, no storage over-reservation, no incoming over-allocation, and no repeated receipt or import commit. Validate again at write time; a page preview can become stale even with one user and several browser tabs.

Archive referenced parts instead of deleting them. Correct movements with compensating entries, rather than rewriting stock history. Keep migrations in source control.

## LLM import design

The official model ID is `gpt-6-luna`, and the model supports structured outputs. Keep this exact model for all LLM operations. [OpenAI model documentation](https://developers.openai.com/api/docs/models/gpt-6-luna).

Use `ai`, `@ai-sdk/openai`, and a schema library such as Zod. Define schema-validated output with `generateText` and `Output.object`. Keep order and project schemas separate while sharing part attribute schemas. Schema validation proves output structure, not factual accuracy. [Vercel AI SDK structured output documentation](https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data).

The pipeline is:

```text
source → draft import → GPT-6 Luna extraction → schema validation
       → unit normalization → candidate matching → owner review
       → transactional commit
```

Each proposed line should include source row or excerpt, description, quantity, purchase/base unit, pack conversion if known, category, attributes, supplied identifiers, and unresolved fields. Use null for absent information. Mark fields as source-stated, normalized, or inferred so the review screen can distinguish them. Reject invalid units and quantities before commit.

For project BOMs, preserve explicit component headings or source columns as proposed groups. Let the owner create, rename, assign, or clear groups during review. Rows without an explicit group remain ungrouped unless the owner assigns them. Commit reviewed components and their BOM rows together; keep source evidence for group assignments. Order lines do not require project component groups.

Give the model category definitions and extraction instructions. Treat pasted document text as data. Do not give the parser tools that can alter inventory. Keep API keys in server-only environment variables. The review screen must state that parsing sends the submitted source to OpenAI; core inventory operations remain local.

Save the draft before calling the model. A failed parse leaves the source available for manual editing or another parse attempt. A parse retry cannot create catalog parts, orders, or reservations. Committing an import is a separate operation with a unique ID. Warn about a matching source or supplier order reference, but allow legitimate repeated purchases.

Save model ID, prompt version, schema version, and available usage data with the import. Test extraction with stored representative source/expected-result fixtures. Run ordinary tests with model responses replaced by fixtures; use explicit live checks to assess model behavior.

AI clean up of an order line uses TypeSafe AI's Jev model (`@typesafe-ai/sdk`, `jev-latest`) for the category and the matching catalog part when `TYPESAFE_API_KEY` is set. GPT-6 Luna does not get the catalog parts and does not match parts. Jev runs at the same time as the GPT-6 Luna cleanup call, and its category replaces GPT-6 Luna's. A choice question accepts at most 255 options, so Jev gets one question for each chunk of 254 options plus a "none" option, and all questions go in one request. When more than one chunk chooses an option, a further request chooses between those options only. Without the key, GPT-6 Luna gives the category and no part is matched.

Initial inputs are pasted text and CSV. PDF, image, spreadsheet, and URL imports are later options. They require separate extraction and source-review handling; do not make them prerequisites for the requested BOM parsing.

## App structure and local operation

The repository contains a SvelteKit starter with TypeScript, Tailwind CSS, Vitest, and the Node adapter. It has no inventory implementation yet.

Keep that structure and add:

```text
src/lib/server/db/          SQLite connection, migrations, repository queries
src/lib/server/inventory/   Stock, reservations, transfers, and receipts
src/lib/server/projects/    BOM editing, matching, and shortage calculations
src/lib/server/imports/     Drafts, LLM extraction, normalization, and commit
src/lib/schemas/            Shared form and import validation
src/routes/parts/           Catalog, filters, part details, stock entry
src/routes/orders/          Order list, detail, receipt review
src/routes/projects/        Project list, BOM, pick list
src/routes/imports/         Source entry and proposal review
src/routes/shopping/        Combined shortages
```

Use SvelteKit server loads and form actions for reads and writes. Keep database and provider code in server-only modules. Avoid a separate API server, queue service, vector database, or agent framework for this scope.

Use `bun:sqlite` with parameterized SQL behind typed repository functions. Bun provides SQLite transactions; use them for coupled changes. Keep network calls outside database transactions. [Bun SQLite documentation](https://bun.sh/docs/runtime/sqlite).

Use a configurable local database path outside build output. Enable foreign keys and WAL mode. Keep the database files out of source control. Run the built app with Bun. The existing adapter produces a server build; verify that it starts under Bun and can load `bun:sqlite` during the first build stage. [SvelteKit Node adapter documentation](https://svelte.dev/docs/kit/adapter-node).

Set the local origin and LAN binding through deployment configuration. Use a local disk for the database. Document database migration and backup/restore commands. Make a consistent backup with SQLite's backup facility, or stop the app before copying its database files. Verify restore before treating the backup as usable. No authentication or tenant model is required.

## Build sequence and proof

Each stage adds a usable workflow. These checks define completion; optional features below do not expand these gates.

### Stage 1: Catalog and physical stock

Add the database, migrations, parts, categories, attributes, locations, manual entry, stock adjustments, search, and filters.

Prove that a part and opening stock persist after app restart; location transfers preserve total stock; invalid negative adjustments fail; and M3, screw, M3 screw, and heat-set insert filters return the expected fixture parts. Build and run the server under Bun with SQLite access.

### Stage 2: Projects, reservations, and picking

Add BOM editing, optional named component groups, deterministic matching, approved substitutes, reservations, picking, use, returns, and project status changes.

Prove the shared-stock example above up to reservation. Verify that two projects cannot reserve the same stock, a partial pick updates both storage and reservation, use credits the correct requirement, and a return restores storage. Verify that cancelling a project releases commitments and preserves physical picked stock until resolved.

Verify that flat and grouped BOMs use the same quantity rules. Moving a row or removing its component preserves the row and its allocations. Identical parts in different components compete for the same available stock, and project totals count each row once.

### Stage 3: Orders, receipts, and shortages

Add manual orders, incoming commitments, partial receipt, receipt review, receive-all, order corrections, and the combined shopping list.

Prove the full shared-stock example. Verify that a pack of 100 adds 100 pieces, duplicate receipt submission adds stock only once, and a partial receipt leaves the correct remainder. Verify that delivered-but-unreviewed parts do not appear as usable stock, and cancelling an outstanding line exposes the affected project shortage.

### Stage 4: Reviewed LLM imports

Add source drafts, text/CSV parsing, structured output, review/edit screens, catalog candidate matching, and import commit.

Prove that both an order list and a project BOM can be parsed, corrected, and committed. Fixture cases must include missing screw dimensions, a resistor with alternate value notation, a pack quantity, and a conflicting exact identifier. Verify that failed parsing and repeated import commit do not change stock or create duplicate records. A live check confirms the configured model and SDK path.

Include a BOM source with named sections and ungrouped rows. Verify that group assignments can be corrected before commit, and a flat source does not acquire invented components.

### Stage 5: Local use and recovery

Finish the pick list and receipt screens for use from a phone near the storage bins. Document local startup, configuration, migrations, and backup/restore.

Prove a complete path from BOM import through matching, order creation, partial receipt, picking, use, and return. Restore a backup to a separate database and confirm stock, projects, and open orders. Run the repository's applicable type, lint, unit, and build checks as each implementation stage changes code.

## Useful additions to consider

These are recommendations based on the intended workflows, not claims that every inventory app needs them.

| Addition                                         | Benefit                                                    | Proposed scope                                         |
| ------------------------------------------------ | ---------------------------------------------------------- | ------------------------------------------------------ |
| Storage locations and pick lists                 | Find parts without searching drawers                       | Included in the initial design                         |
| Unit and pack conversion                         | Avoid counting packs as individual parts                   | Included                                               |
| Partial receipt, damaged items, and cancellation | Reflect what actually arrived                              | Included                                               |
| Movement history, stock counts, and returns      | Explain and correct quantities                             | Included                                               |
| Approved substitutes and aliases                 | Reuse suitable parts without losing technical distinctions | Included                                               |
| Backup and restore                               | Recover the personal catalog and project history           | Included                                               |
| Supplier links, datasheets, photos, and notes    | Identify a part and order it again                         | Links/notes initially; file attachments later          |
| Reorder points and preferred suppliers           | Replace frequently used supplies                           | Optional; owner sets thresholds per part               |
| Bin labels and QR codes                          | Open a part or location from a phone                       | Optional                                               |
| Project build quantity and BOM duplication       | Plan repeated builds without re-entry                      | Optional                                               |
| CSV export                                       | Use inventory and shopping lists outside the app           | Optional                                               |
| Order costs and project cost estimates           | Track spending                                             | Optional; store currency and avoid implicit conversion |
| Kits and assortment contents                     | Track mixed boxes of hardware                              | Optional; requires explicit component quantities       |
| Reusable tools and loan tracking                 | Track equipment that is not consumed                       | Optional; a separate workflow from consumable stock    |

The label feature has a standalone follow-up scanner plan (tim plan 19, depending on plan 12). A phone camera detects multiple visible QR labels, shows what they identify, and highlights direct part labels or container labels with recorded physical stock of a selected part. Keep decoding on the phone, preserve current-label outlines separately from prior finds, and leave stock changes to explicit inventory actions. Reuse the existing Caddy HTTPS hosting.

Decisions to confirm when the related work starts: whether initial sources need PDF/image support, which fractional units the actual inventory uses, and whether reusable tools belong in this app. These choices do not prevent the initial text/CSV and consumable-stock implementation.
