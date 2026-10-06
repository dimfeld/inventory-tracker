<script lang="ts">
  import { enhance } from '$app/forms';
  import { PROVENANCE_LABELS, type ImportKind, type ImportLineFields, type LineProposal } from '#lib/imports.ts';

  interface Props {
    kind: ImportKind;
    number: number;
    readonly: boolean;
    line: {
      id: number;
      groupId: number | null;
      sourceRow: number | null;
      sourceExcerpt: string | null;
      proposal: LineProposal | null;
      fields: ImportLineFields;
      resolution: string | null;
      partId: number | null;
      createdPartId: number | null;
      candidates: {
        part: { id: number; name: string };
        status: 'match' | 'unresolved' | 'conflict';
        sourceLabel: string;
        conflicts: string[];
        unresolved: string[];
      }[];
      identifierConflicts: string[];
      missingRequired: string[];
      conversion: string | null;
      readings: Record<string, string>;
      problems: string[];
    };
    options: {
      categories: { id: number; path: string }[];
      definitions: { key: string; label: string; canonicalUnit: string | null }[];
      parts: { id: number; name: string; baseUnit: string; partNumber: string | null }[];
      units: string[];
    };
    groups: { id: number; name: string }[];
    feedback: { ok: boolean; text: string } | null;
    /** True when the server can call the model to clean up the line. */
    cleanupAvailable?: boolean;
  }

  let { kind, number, readonly, line, options, groups, feedback, cleanupAvailable = false }: Props = $props();

  /** True while a cleanup request of this line is in flight. */
  let cleaning = $state(false);

  // The form owns this after the initial value.
  // svelte-ignore state_referenced_locally
  let resolution = $state(line.resolution ?? '');

  const f = $derived(line.fields);
  const attributeRows = $derived([...f.attributes, { key: '', value: '' }, { key: '', value: '' }]);

  /** The provenance mark of a field: from the proposal, or edited/entered by the owner. */
  function mark(field: keyof ImportLineFields | `attribute:${string}`): string | null {
    const proposal = line.proposal;
    if (!proposal) return null;
    if (field.startsWith('attribute:')) {
      const key = field.slice('attribute:'.length);
      const before = proposal.fields.attributes.find((a) => a.key === key)?.value;
      const now = f.attributes.find((a) => a.key === key)?.value;
      if (before === undefined) return now === undefined ? null : 'edited';
      if (before !== now) return 'edited';
    } else {
      const key = field as keyof ImportLineFields;
      if (JSON.stringify(proposal.fields[key]) !== JSON.stringify(f[key])) return 'edited';
    }
    const provenance = proposal.provenance[field];
    return provenance ? PROVENANCE_LABELS[provenance] : null;
  }

  const STATUS_CLASSES = { match: 'text-green-700', unresolved: 'text-amber-700', conflict: 'text-red-700' };
</script>

{#snippet badge(field: keyof ImportLineFields | `attribute:${string}`)}
  {@const m = mark(field)}
  {#if m}<span class="ml-1 rounded bg-gray-100 px-1 text-xs text-gray-600">{m}</span>{/if}
{/snippet}

<!-- No reset after a save: it would clear the resolution and every field the save did not change. -->
<form
  method="POST"
  action="?/saveLine"
  use:enhance={({ submitter, cancel }) => {
    if (cleaning) return cancel();
    cleaning = submitter?.getAttribute('formaction') === '?/cleanupLine';
    return async ({ update }) => {
      cleaning = false;
      await update({ reset: false });
    };
  }}
  class="rounded border border-gray-200 p-3"
>
  <input type="hidden" name="line_id" value={line.id} />
  <div class="mb-2 flex flex-wrap items-baseline gap-2">
    <h3 class="font-semibold">Line {number}</h3>
    {#if line.sourceExcerpt !== null}
      <span class="text-sm text-gray-600">
        Source{line.sourceRow !== null ? ` row ${line.sourceRow}` : ''}:
        <code class="bg-gray-50 px-1">{line.sourceExcerpt}</code>
      </span>
    {:else if !line.proposal}
      <span class="text-sm text-gray-500">Entered by hand</span>
    {/if}
  </div>

  {#if line.proposal && line.proposal.unresolved.length > 0}
    <p class="text-sm text-amber-700">Unresolved when parsed: {line.proposal.unresolved.join('; ')}</p>
  {/if}
  {#each line.identifierConflicts as conflict (conflict)}
    <p class="text-sm text-red-700">Conflicting identifier: {conflict}</p>
  {/each}
  {#if line.missingRequired.length > 0}
    <p class="text-sm text-amber-700">Not specified: {line.missingRequired.join(', ')}</p>
  {/if}

  <fieldset disabled={readonly} class="mt-2 grid gap-2 sm:grid-cols-4">
    <label class="block sm:col-span-4">
      <span class="text-sm">Description {@render badge('description')}</span>
      <input name="description" value={f.description} class="input" />
    </label>
    {#if kind === 'order'}
      <label class="block">
        <span class="text-sm">Quantity ordered {@render badge('quantity')}</span>
        <input name="quantity" value={f.quantity ?? ''} inputmode="numeric" class="input" />
      </label>
      <label class="block">
        <span class="text-sm">Purchase unit {@render badge('purchaseUnit')}</span>
        <input name="purchase_unit" value={f.purchaseUnit ?? ''} placeholder="pack, each…" class="input" />
      </label>
      <label class="block">
        <span class="text-sm">Base units per purchase unit {@render badge('packQuantity')}</span>
        <input name="pack_quantity" value={f.packQuantity ?? ''} inputmode="numeric" class="input" />
      </label>
      <label class="block">
        <span class="text-sm">Base unit of a new part {@render badge('unit')}</span>
        <select name="unit" value={f.unit ?? ''} class="input">
          <option value="">—</option>
          {#each options.units as unit (unit)}<option value={unit}>{unit}</option>{/each}
          {#if f.unit && !options.units.includes(f.unit)}<option value={f.unit}>{f.unit} (unknown)</option>{/if}
        </select>
      </label>
      <label class="block">
        <span class="text-sm">Price per purchase unit {@render badge('unitPrice')}</span>
        <input name="unit_price" value={f.unitPrice ?? ''} inputmode="decimal" class="input" />
      </label>
      <label class="block">
        <span class="text-sm">Currency {@render badge('currency')}</span>
        <input name="currency" value={f.currency ?? ''} class="input" />
      </label>
    {:else}
      <label class="block">
        <span class="text-sm">Quantity {@render badge('quantity')}</span>
        <input name="quantity" value={f.quantity ?? ''} inputmode="decimal" class="input" />
      </label>
      <label class="block">
        <span class="text-sm">Unit {@render badge('unit')}</span>
        <select name="unit" value={f.unit ?? ''} class="input">
          <option value="">—</option>
          {#each options.units as unit (unit)}<option value={unit}>{unit}</option>{/each}
          {#if f.unit && !options.units.includes(f.unit)}<option value={f.unit}>{f.unit} (unknown)</option>{/if}
        </select>
      </label>
      <label class="block">
        <span class="text-sm">Reference designators {@render badge('referenceDesignators')}</span>
        <input name="reference_designators" value={f.referenceDesignators ?? ''} class="input" />
      </label>
      <label class="block">
        <span class="text-sm">Component group</span>
        <select name="group_id" value={line.groupId === null ? '' : String(line.groupId)} class="input">
          <option value="">Ungrouped</option>
          {#each groups as group (group.id)}<option value={String(group.id)}>{group.name}</option>{/each}
        </select>
      </label>
    {/if}
    <label class="block sm:col-span-2">
      <span class="text-sm">Category {@render badge('categoryId')}</span>
      <select name="category_id" value={f.categoryId === null ? '' : String(f.categoryId)} class="input">
        <option value="">None</option>
        {#each options.categories as category (category.id)}
          <option value={String(category.id)}>{category.path}</option>
        {/each}
      </select>
    </label>
    <label class="block">
      <span class="text-sm">Manufacturer {@render badge('manufacturer')}</span>
      <input name="manufacturer" value={f.manufacturer ?? ''} class="input" />
    </label>
    <label class="block">
      <span class="text-sm">Manufacturer part number {@render badge('partNumber')}</span>
      <input name="part_number" value={f.partNumber ?? ''} class="input" />
    </label>
    <label class="block">
      <span class="text-sm">Supplier SKU {@render badge('supplierSku')}</span>
      <input name="supplier_sku" value={f.supplierSku ?? ''} class="input" />
    </label>
    <label class="block sm:col-span-3">
      <span class="text-sm">Notes {@render badge('notes')}</span>
      <textarea name="notes" rows="2" class="input">{f.notes ?? ''}</textarea>
    </label>

    <div class="sm:col-span-4">
      <span class="text-sm">Attributes</span>
      {#each attributeRows as attribute, index (index)}
        <div class="flex items-center gap-2">
          <input name="attribute_key" value={attribute.key} list="attribute-keys" placeholder="key" class="input w-40" />
          <input name="attribute_value" value={attribute.value} placeholder="value as written" class="input" />
          <span class="w-40 text-sm text-gray-600">
            {#if attribute.key && line.readings[attribute.key]}reads as {line.readings[attribute.key]}{/if}
            {#if attribute.key}{@render badge(`attribute:${attribute.key}`)}{/if}
          </span>
        </div>
      {/each}
    </div>

    <fieldset class="sm:col-span-4">
      <legend class="text-sm">Commit as</legend>
      <label class="mr-3"><input type="radio" name="resolution" value="existing" bind:group={resolution} /> Existing part</label>
      <label class="mr-3"><input type="radio" name="resolution" value="new" bind:group={resolution} /> New catalog part</label>
      {#if kind === 'project'}
        <label><input type="radio" name="resolution" value="requirement" bind:group={resolution} /> Requirement (category and attributes)</label>
      {/if}
      {#if resolution === 'existing'}
        <select name="part_id" value={line.partId === null ? '' : String(line.partId)} class="input">
          <option value="">Choose a part</option>
          {#each options.parts as part (part.id)}
            <option value={String(part.id)}>{part.name}{part.partNumber ? ` (${part.partNumber})` : ''} — {part.baseUnit}</option>
          {/each}
        </select>
      {:else if resolution === 'new'}
        <p class="text-sm text-gray-600">
          The commit creates a part from the description, category, unit, identifiers, and attributes.
        </p>
      {/if}
    </fieldset>
  </fieldset>

  {#if line.conversion}<p class="mt-2 text-sm">Supplies {line.conversion}</p>{/if}

  {#if line.candidates.length > 0}
    <div class="mt-2 text-sm">
      <p class="font-semibold">Catalog candidates</p>
      <ul class="space-y-1">
        {#each line.candidates as candidate (candidate.part.id)}
          <li>
            <span class={STATUS_CLASSES[candidate.status]}>{candidate.status}</span>
            <a href="/parts/{candidate.part.id}" class="text-blue-700 hover:underline">{candidate.part.name}</a>
            <span class="text-gray-500">(found by {candidate.sourceLabel})</span>
            {#if !readonly}
              <button name="choose_part" value={candidate.part.id} class="btn-secondary ml-2 text-xs">Use this part</button>
            {/if}
            {#if candidate.conflicts.length + candidate.unresolved.length > 0}
              <div class="text-gray-600">{[...candidate.conflicts, ...candidate.unresolved].join('; ')}</div>
            {/if}
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  {#if line.problems.length > 0 && !readonly}
    <p class="mt-2 text-sm text-red-700">Before commit: {line.problems.join('; ')}</p>
  {/if}
  {#if line.createdPartId}
    <p class="mt-2 text-sm">Created <a href="/parts/{line.createdPartId}" class="text-blue-700 hover:underline">a new part</a>.</p>
  {/if}
  {#if feedback}<p class="mt-2 {feedback.ok ? 'text-green-700' : 'text-red-700'}">{feedback.text}</p>{/if}

  {#if !readonly}
    <div class="mt-2 flex flex-wrap items-center gap-2">
      <button class="btn" disabled={cleaning}>Save line</button>
      <button formaction="?/removeLine" class="btn-secondary" disabled={cleaning}>Remove line</button>
      {#if kind === 'order'}
        <button
          formaction="?/cleanupLine"
          class="btn-secondary"
          disabled={!cleanupAvailable || cleaning}
          title={cleanupAvailable ? undefined : 'OPENAI_API_KEY is not set'}
        >
          AI Clean up
        </button>
      {/if}
      <span role="status" class="flex items-center gap-2 text-sm">
        {#if cleaning}
          <span
            aria-hidden="true"
            class="inline-block size-4 animate-spin rounded-full border-2 border-gray-300 border-t-blue-700 motion-reduce:animate-none"
          ></span>
          Saving the line and sending it to OpenAI…
        {/if}
      </span>
    </div>
  {/if}
</form>
