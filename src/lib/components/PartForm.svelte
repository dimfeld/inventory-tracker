<script lang="ts" module>
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
    }[];
  }

  export interface AttributeOptions {
    definitions: { key: string; label: string; canonicalUnit: string | null }[];
    /** Attribute keys that apply to each category ID, including inherited ones. */
    applicable: Record<number, string[]>;
  }
</script>

<script lang="ts">
  import { enhance } from '$app/forms';
  import type { CategoryOption } from '#lib/categories.ts';
  import { normalizeAttributeKey } from '#lib/schemas/part.ts';
  import { UNIT_CODES, UNITS } from '#lib/units.ts';

  interface Props {
    categories: CategoryOption[];
    attributeOptions: AttributeOptions;
    initial?: PartFormValues;
    /** True when stock exists, so the base unit cannot change. */
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
  });

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
    const unit = definitions.get(normalizeAttributeKey(label))?.canonicalUnit;
    return unit ? `Value, e.g. in ${unit}` : 'Value, e.g. M3';
  }

  // svelte-ignore state_referenced_locally
  let supplierParts = $state(
    initial?.supplierParts.length ? initial.supplierParts.map((s) => ({ ...s })) : [emptySupplier()]
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

  <fieldset class="rounded border p-3">
    <legend class="px-1 text-sm font-semibold">Attributes</legend>
    {#each attributes as attribute, index (index)}
      <div class="mb-2 flex gap-2">
        <input name="attribute_key" placeholder="Name, e.g. Thread" bind:value={attribute.label} class="input" />
        <input
          name="attribute_value"
          placeholder={valuePlaceholder(attribute.label)}
          bind:value={attribute.rawValue}
          class="input"
        />
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

  <fieldset class="rounded border p-3">
    <legend class="px-1 text-sm font-semibold">Supplier references</legend>
    {#each supplierParts as supplierPart, index (index)}
      <div class="mb-2 grid gap-2 sm:grid-cols-5">
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
      </div>
    {/each}
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
