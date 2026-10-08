<script lang="ts">
  import SearchSelect from '#lib/components/SearchSelect.svelte';
  import { PROVENANCE_LABELS, type ImportKind, type ImportLineFields, type LineProposal } from '#lib/imports.ts';
  import { editLine } from './lines.remote';

  interface Props {
    importId: number;
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
    /** True when the server can call the model to clean up the line. */
    cleanupAvailable?: boolean;
  }

  let { importId, kind, number, readonly, line, options, groups, cleanupAvailable = false }: Props = $props();

  // One form instance per line, so each line saves and cleans up on its own.
  const lineForm = $derived(editLine.for(line.id));
  const fields = $derived(lineForm.fields);
  /** True while a cleanup of this line is in flight. */
  /** The model request of this line that is in flight, if any. */
  let aiRequest = $state<'cleanup' | 'split' | null>(null);
  let splitDialog = $state<HTMLDialogElement>();
  let choosePart = $state<HTMLButtonElement>()!;
  let copyPart = $state<HTMLButtonElement>()!;

  const f = $derived(line.fields);
  const attributeRows = $derived([...f.attributes, { key: '', value: '' }, { key: '', value: '' }]);
  const idText = (id: number | null) => (id === null ? '' : String(id));

  /** The stored line as form input. Compared as text, so a reload with the same values keeps unsaved edits. */
  const saved = $derived(
    JSON.stringify({
      importId,
      description: f.description,
      quantity: f.quantity ?? '',
      unit: f.unit ?? '',
      purchaseUnit: f.purchaseUnit ?? '',
      packQuantity: f.packQuantity ?? '',
      unitPrice: f.unitPrice ?? '',
      currency: f.currency ?? '',
      referenceDesignators: f.referenceDesignators ?? '',
      categoryId: idText(f.categoryId),
      manufacturer: f.manufacturer ?? '',
      partNumber: f.partNumber ?? '',
      supplierSku: f.supplierSku ?? '',
      notes: f.notes ?? '',
      attributes: attributeRows,
      groupId: idText(line.groupId),
      resolution: line.resolution ?? '',
      partId: idText(line.partId),
    })
  );
  // When the stored line changes, such as after a save or a cleanup, the form shows it.
  $effect.pre(() => {
    lineForm.fields.set(JSON.parse(saved));
  });

  const issues = $derived(fields.allIssues());
  const resolution = $derived(fields.resolution.value() ?? line.resolution ?? '');

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

{#snippet partLabel(part: Props['options']['parts'][number])}
  {part.name}{part.partNumber ? ` (${part.partNumber})` : ''} — {part.baseUnit}
{/snippet}

{#snippet badge(field: keyof ImportLineFields | `attribute:${string}`)}
  {@const m = mark(field)}
  {#if m}<span class="ml-1 rounded bg-gray-100 px-1 text-xs text-gray-600">{m}</span>{/if}
{/snippet}

<!-- No reset after a submit: the form shows the stored line, which the page reloads. -->
<form
  {...lineForm.enhance(async (instance) => {
    const intent = instance.fields.intent.value();
    aiRequest = intent === 'cleanup' || intent === 'split' ? intent : null;
    splitDialog?.close();
    try {
      await instance.submit();
    } finally {
      aiRequest = null;
    }
  })}
  class="card"
>
  <input {...fields.importId.as('hidden', importId)} />
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
      <input {...fields.description.as('text', f.description)} class="input" />
    </label>
    {#if kind === 'order'}
      <label class="block">
        <span class="text-sm">Quantity ordered {@render badge('quantity')}</span>
        <input {...fields.quantity.as('text', f.quantity ?? '')} inputmode="numeric" class="input" />
      </label>
      <label class="block">
        <span class="text-sm">Purchase unit {@render badge('purchaseUnit')}</span>
        <input {...fields.purchaseUnit.as('text', f.purchaseUnit ?? '')} placeholder="pack, each…" class="input" />
      </label>
      <label class="block">
        <span class="text-sm">Base units per purchase unit {@render badge('packQuantity')}</span>
        <input {...fields.packQuantity.as('text', f.packQuantity ?? '')} inputmode="numeric" class="input" />
      </label>
      <label class="block">
        <span class="text-sm">Base unit of a new part {@render badge('unit')}</span>
        <select {...fields.unit.as('select', f.unit ?? '')} class="input">
          <option value="">—</option>
          {#each options.units as unit (unit)}<option value={unit}>{unit}</option>{/each}
          {#if f.unit && !options.units.includes(f.unit)}<option value={f.unit}>{f.unit} (unknown)</option>{/if}
        </select>
      </label>
      <label class="block">
        <span class="text-sm">Price per purchase unit {@render badge('unitPrice')}</span>
        <input {...fields.unitPrice.as('text', f.unitPrice ?? '')} inputmode="decimal" class="input" />
      </label>
      <label class="block">
        <span class="text-sm">Currency {@render badge('currency')}</span>
        <input {...fields.currency.as('text', f.currency ?? '')} class="input" />
      </label>
    {:else}
      <label class="block">
        <span class="text-sm">Quantity {@render badge('quantity')}</span>
        <input {...fields.quantity.as('text', f.quantity ?? '')} inputmode="decimal" class="input" />
      </label>
      <label class="block">
        <span class="text-sm">Unit {@render badge('unit')}</span>
        <select {...fields.unit.as('select', f.unit ?? '')} class="input">
          <option value="">—</option>
          {#each options.units as unit (unit)}<option value={unit}>{unit}</option>{/each}
          {#if f.unit && !options.units.includes(f.unit)}<option value={f.unit}>{f.unit} (unknown)</option>{/if}
        </select>
      </label>
      <label class="block">
        <span class="text-sm">Reference designators {@render badge('referenceDesignators')}</span>
        <input {...fields.referenceDesignators.as('text', f.referenceDesignators ?? '')} class="input" />
      </label>
      <label class="block">
        <span class="text-sm">Component group</span>
        <select {...fields.groupId.as('select', idText(line.groupId))} class="input">
          <option value="">Ungrouped</option>
          {#each groups as group (group.id)}<option value={String(group.id)}>{group.name}</option>{/each}
        </select>
      </label>
    {/if}
    <label class="block sm:col-span-2">
      <span class="text-sm">Category {@render badge('categoryId')}</span>
      <select {...fields.categoryId.as('select', idText(f.categoryId))} class="input">
        <option value="">None</option>
        {#each options.categories as category (category.id)}
          <option value={String(category.id)}>{category.path}</option>
        {/each}
      </select>
    </label>
    <label class="block">
      <span class="text-sm">Manufacturer {@render badge('manufacturer')}</span>
      <input {...fields.manufacturer.as('text', f.manufacturer ?? '')} class="input" />
    </label>
    <label class="block">
      <span class="text-sm">Manufacturer part number {@render badge('partNumber')}</span>
      <input {...fields.partNumber.as('text', f.partNumber ?? '')} class="input" />
    </label>
    <label class="block">
      <span class="text-sm">Supplier SKU {@render badge('supplierSku')}</span>
      <input {...fields.supplierSku.as('text', f.supplierSku ?? '')} class="input" />
    </label>
    <label class="block sm:col-span-3">
      <span class="text-sm">Notes {@render badge('notes')}</span>
      <textarea {...fields.notes.as('text', f.notes ?? '')} rows="2" class="input"></textarea>
    </label>

    <div class="sm:col-span-4">
      <span class="text-sm">Attributes</span>
      {#each attributeRows as attribute, index (index)}
        <div class="flex flex-wrap items-center gap-x-2 sm:flex-nowrap">
          <input {...fields.attributes[index].key.as('text', attribute.key)} list="attribute-keys" placeholder="key" class="input w-32 sm:w-40" />
          <input {...fields.attributes[index].value.as('text', attribute.value)} placeholder="value as written" class="input min-w-0 flex-1" />
          <span class="text-sm text-gray-600 sm:w-40">
            {#if attribute.key && line.readings[attribute.key]}reads as {line.readings[attribute.key]}{/if}
            {#if attribute.key}{@render badge(`attribute:${attribute.key}`)}{/if}
          </span>
        </div>
      {/each}
    </div>

    <fieldset class="sm:col-span-4">
      <legend class="text-sm">Commit as</legend>
      <label class="mr-3"><input {...fields.resolution.as('radio', 'existing', line.resolution === 'existing')} /> Existing part</label>
      <label class="mr-3"><input {...fields.resolution.as('radio', 'new', line.resolution === 'new')} /> New catalog part</label>
      {#if kind === 'project'}
        <label><input {...fields.resolution.as('radio', 'requirement', line.resolution === 'requirement')} /> Requirement (category and attributes)</label>
      {/if}
      {#if resolution === 'existing'}
        {@const partId = fields.partId.value() ?? ''}
        {@const chosen = options.parts.find((part) => String(part.id) === partId)}
        <input {...fields.partId.as('hidden', partId)} />
        <p class="mt-1 text-sm">
          {#if chosen}
            Part: {@render partLabel(chosen)}
          {:else}
            <span class="text-gray-600">No part chosen</span>
          {/if}
        </p>
        <SearchSelect
          label="Search the catalog for the existing part of line {number}"
          placeholder="Search {options.parts.length} part(s)"
          items={options.parts}
          key={(part) => part.id}
          text={(part) => `${part.name} ${part.partNumber ?? ''}`}
          onselect={(part) => fields.partId.set(String(part.id))}
        >
          {#snippet option(part)}{@render partLabel(part)}{/snippet}
        </SearchSelect>
      {:else if resolution === 'new'}
        <p class="text-sm text-gray-600">
          The commit creates a part from the description, category, unit, identifiers, and attributes.
        </p>
        {#if !readonly}
          <SearchSelect
            label="Search the catalog for a part to copy into line {number}"
            placeholder="Copy the category and attributes from a part"
            items={options.parts}
            key={(part) => part.id}
            text={(part) => `${part.name} ${part.partNumber ?? ''}`}
            onselect={(part) => {
              copyPart.value = String(part.id);
              copyPart.form?.requestSubmit(copyPart);
            }}
          >
            {#snippet option(part)}{@render partLabel(part)}{/snippet}
          </SearchSelect>
        {/if}
      {/if}
    </fieldset>
  </fieldset>

  {#if line.conversion}<p class="mt-2 text-sm">Supplies {line.conversion}</p>{/if}

  {#if line.candidates.length > 0}
    {@const counts = Object.entries(Object.groupBy(line.candidates, (c) => c.status)).map(
      ([status, list]) => `${list!.length} ${status}`
    )}
    <div class="mt-2 max-w-2xl text-sm">
      <p><span class="font-semibold">Catalog candidates</span> <span class="text-gray-500">({counts.join(', ')})</span></p>
      {#if !readonly}
        <SearchSelect
          label="Search catalog candidates of line {number}"
          placeholder="Search {line.candidates.length} candidate(s) to use as the existing part"
          items={line.candidates}
          key={(c) => c.part.id}
          text={(c) => `${c.part.name} ${c.status} ${c.sourceLabel}`}
          onselect={(c) => {
            choosePart.value = String(c.part.id);
            choosePart.form?.requestSubmit(choosePart);
          }}
        >
          {#snippet option(candidate)}
            <span class={STATUS_CLASSES[candidate.status]}>{candidate.status}</span>
            {candidate.part.name}
            <span class="text-gray-500">(found by {candidate.sourceLabel})</span>
            {#if candidate.conflicts.length + candidate.unresolved.length > 0}
              <div class="text-xs text-gray-600">{[...candidate.conflicts, ...candidate.unresolved].join('; ')}</div>
            {/if}
          {/snippet}
        </SearchSelect>
      {/if}
    </div>
  {/if}

  {#if line.problems.length > 0 && !readonly}
    <p class="mt-2 text-sm text-red-700">Before commit: {line.problems.join('; ')}</p>
  {/if}
  {#if line.createdPartId}
    <p class="mt-2 text-sm">Created <a href="/parts/{line.createdPartId}" class="link">a new part</a>.</p>
  {/if}
  {#if issues?.length}
    <p class="mt-2 text-red-700">{issues.map((issue) => issue.message).join('. ')}</p>
  {:else if lineForm.result}
    <p class="mt-2 text-green-700">{lineForm.result.text}</p>
  {/if}

  {#if !readonly}
    <div class="mt-2 flex flex-wrap items-center gap-2">
      <!-- Save comes first: it is the button that Enter in a field presses. -->
      <button {...fields.intent.as('submit', 'save')} class="btn" disabled={lineForm.pending > 0}>Save line</button>
      <!-- Choosing a candidate submits the form with this button, like a click on it. -->
      <button
        bind:this={choosePart}
        {...fields.choosePart.as('submit', '')}
        hidden
        tabindex="-1"
        aria-hidden="true">Use this part</button
      >
      <!-- Choosing a part to copy submits the form with this button. -->
      <button
        bind:this={copyPart}
        {...fields.copyFrom.as('submit', '')}
        hidden
        tabindex="-1"
        aria-hidden="true">Copy this part</button
      >
      <button {...fields.intent.as('submit', 'remove')} class="btn-secondary" disabled={lineForm.pending > 0}>
        Remove line
      </button>
      <button
        {...fields.intent.as('submit', 'duplicate')}
        class="btn-secondary"
        disabled={lineForm.pending > 0}
        title="Save this line and add a copy after it, to split the line by hand"
      >
        Duplicate line
      </button>
      {#if kind === 'order'}
        <button
          {...fields.intent.as('submit', 'cleanup')}
          class="btn-secondary"
          disabled={!cleanupAvailable || lineForm.pending > 0}
          title={cleanupAvailable ? undefined : 'OPENAI_API_KEY is not set'}
        >
          AI clean up
        </button>
      {/if}
      <button
        type="button"
        class="btn-secondary"
        disabled={!cleanupAvailable || lineForm.pending > 0}
        title={cleanupAvailable ? undefined : 'OPENAI_API_KEY is not set'}
        onclick={() => splitDialog?.showModal()}
      >
        AI split
      </button>
      <!-- The dialog is in the form, so its fields and button submit this line. -->
      <dialog
        bind:this={splitDialog}
        aria-labelledby="split-title-{line.id}"
        class="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-lg border border-gray-200 bg-white p-4 text-gray-900 shadow-xl backdrop:bg-black/40"
      >
        <h4 id="split-title-{line.id}" class="mb-1 font-semibold">Split line {number} with AI</h4>
        <p class="hint mb-3">
          {#if kind === 'order'}
            Splits a line that holds several different items, such as an assortment pack, into one
            line per item. The first line keeps the price, and the other lines get a price of 0.
          {:else}
            Splits a row that holds several different items, such as screws with matching nuts,
            into one line per item.
          {/if}
          Sends the line and your notes to OpenAI.
        </p>
        <label class="block text-sm">
          Notes (optional)
          <textarea
            {...fields.splitNotes.as('text')}
            rows="3"
            placeholder="e.g. 5 values, 20 of each: 5k, 10k, 20k, 50k, 100k"
            class="input"
          ></textarea>
        </label>
        <div class="mt-3 flex justify-end gap-2">
          <button type="button" class="btn-secondary" onclick={() => splitDialog?.close()}>Cancel</button>
          <button {...fields.intent.as('submit', 'split')} class="btn" disabled={lineForm.pending > 0}>Split</button>
        </div>
      </dialog>
      <span role="status" class="flex items-center gap-2 text-sm">
        {#if aiRequest}
          <span
            aria-hidden="true"
            class="inline-block size-4 animate-spin rounded-full border-2 border-gray-300 border-t-blue-700 motion-reduce:animate-none"
          ></span>
          Saving the line and sending it to OpenAI for {aiRequest === 'split' ? 'a split' : 'clean up'}…
        {/if}
      </span>
    </div>
  {/if}
</form>
