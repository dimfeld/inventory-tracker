<script lang="ts" module>
  import { PIECE_DISPLAY_UNITS } from '#lib/pieces.ts';
  import type { TrackingInput } from '#lib/schemas/part.ts';

  export interface PartFormValues {
    name: string;
    categoryId: number | null;
    baseUnit: string;
    manufacturer: string | null;
    partNumber: string | null;
    notes: string | null;
    attributes: { label: string; rawValue: string }[];
    aliases: string[];
    tags: string[];
    supplierParts: {
      id: number | null;
      supplier: string;
      sku: string;
      url: string | null;
      purchaseUnit: string | null;
      packQuantity: number | null;
      stockLengthMm?: number | null;
      stockWidthMm?: number | null;
    }[];
    tracking?: TrackingInput;
  }

  export interface AttributeOptions {
    definitions: {
      key: string;
      label: string;
      valueType: string;
      canonicalUnit: string | null;
      normalization: string | null;
    }[];
    /** Attribute keys that apply to each category ID, including inherited ones. */
    applicable: Record<number, string[]>;
  }
</script>

<script lang="ts">
  import { enhance } from '$app/forms';
  import { attributeUnitsHint, previewMeasurement } from '#lib/attributes.ts';
  import type { CategoryOption } from '#lib/categories.ts';
  import { normalizeAttributeKey } from '#lib/schemas/part.ts';
  import { UNIT_CODES, UNITS } from '#lib/units.ts';

  interface Props {
    categories: CategoryOption[];
    attributeOptions: AttributeOptions;
    initial?: PartFormValues;
    /** True when stock exists, so the base unit and the tracking mode cannot change. */
    baseUnitLocked?: boolean;
    message?: string;
    errors?: Record<string, string>;
    submitLabel: string;
  }

  let {
    categories,
    attributeOptions,
    initial,
    baseUnitLocked = false,
    message,
    errors,
    submitLabel,
  }: Props = $props();

  const emptySupplier = () => ({
    id: null,
    supplier: '',
    sku: '',
    url: null,
    purchaseUnit: null,
    packQuantity: null,
    stockLength: '',
    stockWidth: '',
  });

  // svelte-ignore state_referenced_locally
  let trackingMode = $state(initial?.tracking?.mode ?? 'bulk');
  // svelte-ignore state_referenced_locally
  let pieceWidthKey = $state(initial?.tracking?.widthKey ?? '');
  /** Number attributes in mm, which can be the dimensions of a piece. */
  const dimensionOptions = $derived(
    attributeOptions.definitions.filter((d) => d.valueType === 'number' && d.canonicalUnit === 'mm')
  );
  const lengthText = (mm: number | null | undefined) => (mm ? String(mm) : '');

  // Rows start from the initial values; the form owns them after that.
  // svelte-ignore state_referenced_locally
  let attributes = $state(
    initial?.attributes.length ? initial.attributes.map((a) => ({ ...a })) : [{ label: '', rawValue: '' }]
  );
  const definitions = $derived(new Map(attributeOptions.definitions.map((d) => [d.key, d])));

  /**
   * Offer a row for each attribute that applies to the category. Empty rows for attributes that
   * no longer apply are removed; rows with values are kept.
   */
  function showApplicableRows(categoryId: number | null) {
    const keys = categoryId === null ? [] : (attributeOptions.applicable[categoryId] ?? []);
    const kept = attributes.filter((a) => a.rawValue || keys.includes(normalizeAttributeKey(a.label)));
    const present = new Set(kept.map((a) => normalizeAttributeKey(a.label)));
    for (const key of keys) {
      if (!present.has(key)) kept.push({ label: definitions.get(key)?.label ?? key, rawValue: '' });
    }
    attributes = kept.length > 0 ? kept : [{ label: '', rawValue: '' }];
  }
  // svelte-ignore state_referenced_locally
  showApplicableRows(initial?.categoryId ?? null);

  function valuePlaceholder(label: string) {
    const definition = definitions.get(normalizeAttributeKey(label));
    const units = definition ? attributeUnitsHint(definition) : null;
    return units ? `Value in ${units}` : 'Value, e.g. M3';
  }

  // svelte-ignore state_referenced_locally
  let supplierParts = $state(
    initial?.supplierParts.length
      ? initial.supplierParts.map((s) => ({
          ...s,
          stockLength: lengthText(s.stockLengthMm),
          stockWidth: lengthText(s.stockWidthMm),
        }))
      : [emptySupplier()]
  );
</script>

<form method="POST" use:enhance class="space-y-4">
  <div class="grid gap-4 sm:grid-cols-2">
    <label class="block sm:col-span-2">
      <span class="text-sm">Name</span>
      <input name="name" required value={initial?.name ?? ''} class="input" />
      {#if errors?.name}<span class="text-sm text-red-700">{errors.name}</span>{/if}
    </label>

    <label class="block">
      <span class="text-sm">Category</span>
      <select
        name="category_id"
        class="input"
        onchange={(e) => showApplicableRows(e.currentTarget.value ? Number(e.currentTarget.value) : null)}
      >
        <option value="">(none)</option>
        {#each categories as category (category.id)}
          <option value={category.id} selected={category.id === initial?.categoryId}>
            {category.path}
          </option>
        {/each}
      </select>
    </label>

    <label class="block">
      <span class="text-sm">Base unit</span>
      {#if baseUnitLocked}
        <input type="hidden" name="base_unit" value={initial?.baseUnit} />
        <input disabled value={initial?.baseUnit} class="input bg-gray-100" />
        <span class="text-sm text-gray-600">Stock is recorded in this unit, so it cannot change.</span>
      {:else}
        <select name="base_unit" class="input">
          {#each UNIT_CODES as unit (unit)}
            <option value={unit} selected={unit === (initial?.baseUnit ?? 'pcs')}>
              {unit} ({UNITS[unit].label})
            </option>
          {/each}
        </select>
        <span class="text-sm text-gray-600">
          Quantities are whole numbers of this unit. Use the smallest unit you measure.
        </span>
      {/if}
    </label>

    <label class="block">
      <span class="text-sm">Manufacturer</span>
      <input name="manufacturer" value={initial?.manufacturer ?? ''} class="input" />
    </label>

    <label class="block">
      <span class="text-sm">Manufacturer part number</span>
      <input name="part_number" value={initial?.partNumber ?? ''} class="input" />
    </label>
  </div>

  <fieldset class="card space-y-3">
    <legend class="px-1 text-sm font-semibold">Stock tracking</legend>
    <label class="block max-w-md">
      <span class="text-sm">How stock is counted</span>
      {#if baseUnitLocked}
        <input type="hidden" name="tracking_mode" value={trackingMode} />
      {/if}
      <select name="tracking_mode" bind:value={trackingMode} disabled={baseUnitLocked} class="input disabled:bg-gray-100">
        <option value="bulk">One quantity per location</option>
        <option value="pieces">Individual pieces with their own size (cut stock)</option>
      </select>
      {#if baseUnitLocked}
        <span class="text-sm text-gray-600">Stock is recorded this way, so it cannot change.</span>
      {:else if trackingMode === 'pieces'}
        <span class="text-sm text-gray-600">
          For extrusion, sheet, and rod. Each piece keeps its own length (and width), so offcuts are kept.
          Use the pcs base unit. Remove the per-piece attributes, such as the length, from the attributes below.
        </span>
      {/if}
      {#if errors?.tracking_mode}<span class="text-sm text-red-700">{errors.tracking_mode}</span>{/if}
    </label>
    {#if trackingMode === 'pieces'}
      <div class="grid gap-3 sm:grid-cols-2">
        <label class="block">
          <span class="text-sm">Length of each piece</span>
          <select name="piece_length_key" required class="input">
            {#each dimensionOptions as definition (definition.key)}
              <option value={definition.key} selected={definition.key === (initial?.tracking?.lengthKey ?? 'length')}>
                {definition.label}
              </option>
            {/each}
          </select>
        </label>
        <label class="block">
          <span class="text-sm">Width of each piece</span>
          <select name="piece_width_key" bind:value={pieceWidthKey} class="input">
            <option value="">(none: 1D, such as extrusion or rod)</option>
            {#each dimensionOptions as definition (definition.key)}
              <option value={definition.key}>{definition.label}</option>
            {/each}
          </select>
        </label>
        <label class="block">
          <span class="text-sm">Kerf (mm or in)</span>
          <input name="kerf" value={lengthText(initial?.tracking?.kerfMm)} placeholder="0" class="input" />
          <span class="text-sm text-gray-600">Material lost to each cut.</span>
          {#if errors?.kerf}<span class="text-sm text-red-700">{errors.kerf}</span>{/if}
        </label>
        <label class="block">
          <span class="text-sm">Minimum offcut (mm or in)</span>
          <input name="min_offcut" value={lengthText(initial?.tracking?.minOffcutMm)} placeholder="0" class="input" />
          <span class="text-sm text-gray-600">Shorter offcuts are not worth keeping.</span>
          {#if errors?.min_offcut}<span class="text-sm text-red-700">{errors.min_offcut}</span>{/if}
        </label>
        <label class="block">
          <span class="text-sm">Show sizes in</span>
          <select name="piece_display_unit" class="input">
            {#each PIECE_DISPLAY_UNITS as unit (unit)}
              <option value={unit} selected={unit === (initial?.tracking?.displayUnit ?? 'mm')}>{unit}</option>
            {/each}
          </select>
          <span class="text-sm text-gray-600">Cut and split forms show sizes in this unit. A bare number is in this unit.</span>
          {#if errors?.piece_display_unit}<span class="text-sm text-red-700">{errors.piece_display_unit}</span>{/if}
        </label>
        <label class="block">
          <span class="text-sm">Standard length (mm or in)</span>
          <input name="standard_length" value={lengthText(initial?.tracking?.standardLengthMm)} class="input" />
          <span class="text-sm text-gray-600">
            The size it usually comes in, such as 96 in for a 4 × 8 ft sheet. Optional.
          </span>
        </label>
        {#if pieceWidthKey}
          <label class="block">
            <span class="text-sm">Standard width (mm or in)</span>
            <input name="standard_width" value={lengthText(initial?.tracking?.standardWidthMm)} class="input" />
            <span class="text-sm text-gray-600">Such as 48 in for a 4 × 8 ft sheet.</span>
          </label>
        {/if}
        {#if errors?.standard_size}<span class="text-sm text-red-700">{errors.standard_size}</span>{/if}
      </div>
    {/if}
  </fieldset>

  <fieldset class="card">
    <legend class="px-1 text-sm font-semibold">Attributes</legend>
    {#each attributes as attribute, index (index)}
      {@const rule = definitions.get(normalizeAttributeKey(attribute.label))?.normalization ?? null}
      {@const preview = previewMeasurement(rule, attribute.rawValue)}
      <div class="mb-2 flex gap-2">
        <input name="attribute_key" placeholder="Name, e.g. Thread" bind:value={attribute.label} class="input" />
        <input
          name="attribute_value"
          placeholder={valuePlaceholder(attribute.label)}
          bind:value={attribute.rawValue}
          class="input"
        />
        {#if preview}
          <span class="self-center text-sm whitespace-nowrap text-gray-600">{preview}</span>
        {/if}
      </div>
    {/each}
    <p class="mb-2 text-sm text-gray-600">
      The original text is kept. A thread such as M3x8 also sets the length.
      Empty values are not saved and stay unknown.
    </p>
    {#if errors?.attributes}<p class="text-sm text-red-700">{errors.attributes}</p>{/if}
    <button type="button" class="btn-secondary" onclick={() => attributes.push({ label: '', rawValue: '' })}>
      Add attribute
    </button>
  </fieldset>

  <label class="block">
    <span class="text-sm">Aliases (one per line)</span>
    <textarea name="aliases" rows="2" class="input">{initial?.aliases.join('\n') ?? ''}</textarea>
  </label>

  <label class="block">
    <span class="text-sm">Tags (comma separated, optional)</span>
    <input name="tags" value={initial?.tags.join(', ') ?? ''} class="input" />
  </label>

  <fieldset class="card">
    <legend class="px-1 text-sm font-semibold">Supplier references</legend>
    {#each supplierParts as supplierPart, index (index)}
      <div class="mb-3 grid gap-2 border-b border-gray-100 pb-3 last-of-type:border-0 sm:grid-cols-2 lg:grid-cols-5 lg:border-0 lg:pb-0">
        <input type="hidden" name="supplier_id" value={supplierPart.id ?? ''} />
        <input name="supplier_name" placeholder="Supplier" bind:value={supplierPart.supplier} class="input" />
        <input name="supplier_sku" placeholder="SKU" bind:value={supplierPart.sku} class="input" />
        <input name="supplier_url" type="url" placeholder="Product URL" bind:value={supplierPart.url} class="input" />
        <input
          name="supplier_purchase_unit"
          placeholder="Sold as, e.g. pack"
          bind:value={supplierPart.purchaseUnit}
          class="input"
        />
        <input
          name="supplier_pack_quantity"
          inputmode="numeric"
          placeholder="Base units per purchase unit"
          bind:value={supplierPart.packQuantity}
          class="input"
        />
        {#if trackingMode === 'pieces'}
          <input
            name="supplier_stock_length"
            placeholder="Stock length, e.g. 1220 or 48 in"
            aria-label="Stock length"
            bind:value={supplierPart.stockLength}
            class="input"
          />
          {#if pieceWidthKey}
            <input
              name="supplier_stock_width"
              placeholder="Stock width (mm or in)"
              aria-label="Stock width"
              bind:value={supplierPart.stockWidth}
              class="input"
            />
          {/if}
        {/if}
      </div>
    {/each}
    {#if trackingMode === 'pieces'}
      <p class="mb-2 text-sm text-gray-600">
        The stock size is the size of one piece as sold, such as a 1220 mm stick. A receipt makes one piece of this
        size per unit.
      </p>
    {/if}
    {#if errors?.supplier_parts}<p class="text-sm text-red-700">{errors.supplier_parts}</p>{/if}
    <button type="button" class="btn-secondary" onclick={() => supplierParts.push(emptySupplier())}>
      Add supplier reference
    </button>
  </fieldset>

  <label class="block">
    <span class="text-sm">Notes</span>
    <textarea name="notes" rows="3" class="input">{initial?.notes ?? ''}</textarea>
  </label>

  {#if message}<p class="text-red-700">{message}</p>{/if}
  <button class="btn">{submitLabel}</button>
</form>
