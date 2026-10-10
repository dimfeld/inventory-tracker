<script lang="ts" module>
  import type { PieceDisplayUnit } from '#lib/pieces.ts';
  import type { ConstraintComparison } from '#lib/projects.ts';

  export interface ConstraintRow {
    key: string;
    comparison: ConstraintComparison;
    value: string;
    maxValue: string | null;
  }

  export interface BomLineFormValues {
    description: string;
    amount: string;
    unit: string;
    componentId: number | null;
    referenceDesignators: string | null;
    notes: string | null;
    partId: number | null;
    categoryId: number | null;
    manufacturer: string | null;
    partNumber: string | null;
    constraints: ConstraintRow[];
    /** Cut size of a part tracked as pieces, as input text. A bare number is in the part's unit. */
    cutLength: string;
    cutWidth: string;
  }

  export interface BomFormOptions {
    categories: { id: number; path: string }[];
    definitions: {
      key: string;
      label: string;
      valueType: string;
      canonicalUnit: string | null;
      normalization: string | null;
    }[];
    /** Attribute keys that apply to each category ID, including inherited ones. */
    applicable: Record<number, string[]>;
    /** Attribute keys a generic requirement in each category must specify. */
    required: Record<number, string[]>;
    parts: { id: number; name: string; baseUnit: string; partNumber: string | null }[];
    /** Parts tracked as pieces, by ID: the unit of their sizes and whether they have a width. */
    pieceParts: Record<number, { displayUnit: PieceDisplayUnit; twoD: boolean }>;
    components: { id: number; name: string }[];
  }
</script>

<script lang="ts">
  import { enhance } from '$app/forms';
  import PartPicker from '#lib/components/PartPicker.svelte';
  import { attributeUnitsHint, previewMeasurement } from '#lib/attributes.ts';
  import { findLengthInText, formatLength, formatSize, parsePieceLength } from '#lib/pieces.ts';
  import { COMPARISON_LABELS, CONSTRAINT_COMPARISONS } from '#lib/projects.ts';
  import { UNIT_CODES, UNITS } from '#lib/units.ts';

  interface Props {
    options: BomFormOptions;
    initial?: BomLineFormValues;
    message?: string;
    errors?: Record<string, string>;
    submitLabel: string;
  }

  let { options, initial, message, errors, submitLabel }: Props = $props();

  const emptyRow = (key = ''): ConstraintRow => ({ key, comparison: 'equal', value: '', maxValue: null });

  // The form owns these after the initial values.
  // svelte-ignore state_referenced_locally
  let mode = $state(initial?.partId ? 'exact' : 'constraints');
  // svelte-ignore state_referenced_locally
  let partValue = $state(initial?.partId ? String(initial.partId) : '');
  // svelte-ignore state_referenced_locally
  let description = $state(initial?.description ?? '');
  // svelte-ignore state_referenced_locally
  let amount = $state(initial?.amount ?? '');
  // svelte-ignore state_referenced_locally
  let cutLength = $state(initial?.cutLength ?? '');
  // svelte-ignore state_referenced_locally
  let cutWidth = $state(initial?.cutWidth ?? '');
  // svelte-ignore state_referenced_locally
  let categoryId = $state<number | null>(initial?.categoryId ?? null);
  // svelte-ignore state_referenced_locally
  let rows = $state(initial?.constraints.length ? initial.constraints.map((c) => ({ ...c })) : [emptyRow()]);

  const definitions = $derived(new Map(options.definitions.map((d) => [d.key, d])));

  // A cut size applies to an exact part tracked as pieces, or to a requirement by category.
  const piecePart = $derived(
    mode === 'exact' && partValue ? (options.pieceParts[Number(partValue)] ?? null) : null
  );
  const showCutSize = $derived(mode === 'constraints' || piecePart !== null);
  const showWidth = $derived(mode === 'constraints' || piecePart?.twoD === true);
  const cutUnit = $derived(piecePart?.displayUnit ?? 'mm');
  const cutPreview = $derived.by(() => {
    if (!cutLength.trim()) return null;
    const lengthMm = parsePieceLength(cutLength, cutUnit);
    const widthMm = showWidth && cutWidth.trim() ? parsePieceLength(cutWidth, cutUnit) : null;
    if (lengthMm === null || (showWidth && cutWidth.trim() && widthMm === null)) return null;
    return `${amount || '?'} × ${formatSize({ lengthMm, widthMm }, cutUnit)}`;
  });
  /** A length in the description, as a hint for a row without a cut size, such as a converted row. */
  const descriptionLength = $derived.by(() => {
    if (piecePart === null || cutLength.trim()) return null;
    const mm = findLengthInText(description);
    return mm === null ? null : formatLength(mm, cutUnit);
  });
  const required = $derived(
    mode === 'constraints' && categoryId !== null ? (options.required[categoryId] ?? []) : []
  );

  /** Offer a row for each attribute of the category. Rows with values are kept. */
  function showApplicableRows(id: number | null) {
    categoryId = id;
    const keys = id === null ? [] : (options.applicable[id] ?? []);
    const kept = rows.filter((r) => r.value || keys.includes(r.key));
    const present = new Set(kept.map((r) => r.key));
    for (const key of keys) if (!present.has(key)) kept.push(emptyRow(key));
    rows = kept.length > 0 ? kept : [emptyRow()];
  }

  function placeholder(key: string) {
    const definition = definitions.get(key);
    const units = definition ? attributeUnitsHint(definition) : null;
    return units ? `Value in ${units}` : 'Value';
  }
</script>

<form method="POST" use:enhance class="space-y-4">
  <div class="grid gap-4 sm:grid-cols-2">
    <label class="block sm:col-span-2">
      <span class="text-sm">Description (as written in the BOM)</span>
      <input name="description" required bind:value={description} class="input" />
      {#if errors?.description}<span class="text-sm text-red-700">{errors.description}</span>{/if}
    </label>

    <div class="flex gap-2">
      <label class="block flex-1">
        <span class="text-sm">{cutLength.trim() && showCutSize ? 'Quantity (cut pieces)' : 'Quantity'}</span>
        <input name="amount" required inputmode="decimal" bind:value={amount} class="input" />
      </label>
      <label class="block">
        <span class="text-sm">Unit</span>
        <select name="unit" class="input">
          {#each UNIT_CODES as unit (unit)}
            <option value={unit} selected={unit === (initial?.unit ?? 'pcs')}>{unit} ({UNITS[unit].label})</option>
          {/each}
        </select>
      </label>
    </div>

    <label class="block">
      <span class="text-sm">Component</span>
      <select name="component_id" class="input">
        <option value="">Ungrouped</option>
        {#each options.components as component (component.id)}
          <option value={component.id} selected={component.id === initial?.componentId}>{component.name}</option>
        {/each}
      </select>
    </label>

    <label class="block">
      <span class="text-sm">Reference designators</span>
      <input name="reference_designators" value={initial?.referenceDesignators ?? ''} class="input" />
    </label>
  </div>
  {#if errors?.amount || errors?.unit}
    <p class="text-sm text-red-700">{errors.amount ?? errors.unit}</p>
  {/if}

  <fieldset class="card">
    <legend class="px-1 text-sm font-semibold">Requirement</legend>
    <div class="mb-3 flex gap-4">
      <label><input type="radio" name="mode" value="exact" bind:group={mode} /> Exact part</label>
      <label><input type="radio" name="mode" value="constraints" bind:group={mode} /> Typed constraints</label>
    </div>

    {#if mode === 'exact'}
      <div>
        <span class="text-sm">Part</span>
        <PartPicker parts={options.parts} bind:value={partValue} />
        <span class="text-sm text-gray-600">The quantity is stored in the part's base unit.</span>
        {#if errors?.part_id}<span class="text-sm text-red-700">{errors.part_id}</span>{/if}
      </div>
    {:else}
      <div class="grid gap-4 sm:grid-cols-3">
        <label class="block">
          <span class="text-sm">Category</span>
          <select
            name="category_id"
            class="input"
            onchange={(e) => showApplicableRows(e.currentTarget.value ? Number(e.currentTarget.value) : null)}
          >
            <option value="">(none)</option>
            {#each options.categories as category (category.id)}
              <option value={category.id} selected={category.id === categoryId}>{category.path}</option>
            {/each}
          </select>
        </label>
        <label class="block">
          <span class="text-sm">Manufacturer</span>
          <input name="manufacturer" value={initial?.manufacturer ?? ''} class="input" />
        </label>
        <label class="block">
          <span class="text-sm">Part number, alias, or supplier SKU</span>
          <input name="part_number" value={initial?.partNumber ?? ''} class="input" />
        </label>
      </div>
    {/if}
  </fieldset>

  {#if showCutSize}
    <fieldset class="card">
      <legend class="px-1 text-sm font-semibold">Cut size</legend>
      <p class="mb-2 text-sm text-gray-600">
        For material cut from stock pieces, such as extrusion or sheet: the size of each piece to cut.
        With a cut size, the quantity is the number of cut pieces, such as 2 × 415 mm. Leave it empty
        for whole pieces. A bare number is in {cutUnit}.
      </p>
      <div class="grid gap-4 sm:grid-cols-2">
        <label class="block">
          <span class="text-sm">Cut length</span>
          <input name="cut_length" bind:value={cutLength} class="input" />
          {#if errors?.cut_length}<span class="text-sm text-red-700">{errors.cut_length}</span>{/if}
        </label>
        {#if showWidth}
          <label class="block">
            <span class="text-sm">Cut width {mode === 'constraints' ? '(sheet only)' : ''}</span>
            <input name="cut_width" bind:value={cutWidth} class="input" />
            {#if errors?.cut_width}<span class="text-sm text-red-700">{errors.cut_width}</span>{/if}
          </label>
        {/if}
      </div>
      {#if cutPreview}<p class="mt-2 text-sm">{cutPreview}</p>{/if}
      {#if descriptionLength}
        <p class="mt-2 text-sm text-gray-600">The description mentions {descriptionLength}.</p>
      {/if}
    </fieldset>
  {/if}

  <fieldset class="card">
    <legend class="px-1 text-sm font-semibold">Constraints</legend>
    <!-- Fields are parallel lists, so every row submits every field. -->
    {#each rows as row, index (index)}
      {@const rule = definitions.get(row.key)?.normalization ?? null}
      {@const preview = [row.value, row.comparison === 'range' ? row.maxValue : null]
        .map((value) => previewMeasurement(rule, value ?? ''))
        .filter(Boolean)
        .join(' to ')}
      <div class="mb-2 grid gap-2 sm:grid-cols-4">
        <select name="constraint_key" bind:value={row.key} class="input">
          <option value="">Attribute</option>
          {#each options.definitions as definition (definition.key)}
            <option value={definition.key}>
              {definition.label}{required.includes(definition.key) ? ' *' : ''}
            </option>
          {/each}
        </select>
        <select name="constraint_comparison" bind:value={row.comparison} class="input">
          {#each CONSTRAINT_COMPARISONS as comparison (comparison)}
            <option value={comparison}>{COMPARISON_LABELS[comparison]}</option>
          {/each}
        </select>
        <input name="constraint_value" placeholder={placeholder(row.key)} bind:value={row.value} class="input" />
        <input
          name="constraint_max"
          placeholder={row.comparison === 'range' ? 'Upper value' : ''}
          readonly={row.comparison !== 'range'}
          bind:value={row.maxValue}
          class="input"
        />
        {#if preview}<p class="text-sm text-gray-600 sm:col-span-4">{preview}</p>{/if}
      </div>
    {/each}
    <p class="mb-2 text-sm text-gray-600">
      Values must match exactly unless you choose “at least” or “between”, which permit other numeric
      values. Unknown values on a part need review; they never count as matches.
      {#if required.length > 0}
        * Required for this category: without it, no generic part can match.
      {/if}
    </p>
    {#if errors?.constraints}<p class="text-sm text-red-700">{errors.constraints}</p>{/if}
    <button type="button" class="btn-secondary" onclick={() => rows.push(emptyRow())}>Add constraint</button>
  </fieldset>

  <label class="block">
    <span class="text-sm">Notes</span>
    <textarea name="notes" rows="2" class="input">{initial?.notes ?? ''}</textarea>
  </label>

  {#if message}<p class="text-red-700">{message}</p>{/if}
  <button class="btn">{submitLabel}</button>
</form>
