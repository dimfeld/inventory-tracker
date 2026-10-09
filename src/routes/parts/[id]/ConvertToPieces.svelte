<script lang="ts">
  import { formatPieceSize } from '#lib/pieces.ts';
  import SearchSelect from '#lib/components/SearchSelect.svelte';
  import { conversionPreview, convertParts, setAttributeForParts } from './conversion.remote';

  /**
   * Conversion of this bulk part, and optionally other parts merged into it, into one part
   * tracked as pieces. A live preview shows what changes and what blocks it.
   */
  let {
    part,
    candidates,
    dimensionOptions,
    operationId,
    today,
  }: {
    part: { id: number; name: string };
    /** Other parts that can be merged in. */
    candidates: { id: number; name: string; partNumber: string | null }[];
    /** Number attributes in mm, which can be piece dimensions. */
    dimensionOptions: { key: string; label: string }[];
    operationId: string;
    today: string;
  } = $props();

  let sources = $state<{ id: number; name: string }[]>([]);
  let lengthKey = $state('length');
  let widthKey = $state('');
  // The value chosen or typed for each differing attribute, by key.
  let chosen = $state<Record<string, string>>({});
  let fixError = $state('');

  const args = $derived({
    destinationId: part.id,
    sourceIds: sources.map((s) => s.id),
    lengthKey,
    widthKey: widthKey || null,
  });
  const available = $derived(candidates.filter((c) => !sources.some((s) => s.id === c.id)));

  async function useForAll(key: string, partIds: number[]) {
    fixError = '';
    const value = chosen[key]?.trim();
    if (!value) {
      fixError = 'Choose or type the value first.';
      return;
    }
    try {
      await setAttributeForParts({ partIds, key, value });
      await conversionPreview(args).refresh();
    } catch (e) {
      fixError = (e as { body?: { message?: string } }).body?.message ?? 'The value could not be saved.';
    }
  }
</script>

<div class="card max-w-3xl space-y-4 text-sm">
  <p class="text-gray-600">
    Use this for cut stock such as extrusion, sheet, or rod. Each unit of stock becomes one piece with its own size,
    taken from the parts' dimension attributes. Parts that differ only by that size (such as three extrusion lengths)
    are merged into this part: their stock, supplier references (which get their size as the stock size), orders,
    and project rows move here, their names become aliases, and they are deleted.
  </p>

  <div>
    <h3 class="font-semibold">Parts to merge in</h3>
    {#if sources.length === 0}
      <p class="text-gray-600">None: convert only this part.</p>
    {:else}
      <ul class="mb-2">
        {#each sources as source (source.id)}
          <li class="flex items-center gap-2">
            {source.name}
            <button type="button" class="link text-xs" onclick={() => (sources = sources.filter((s) => s.id !== source.id))}>
              remove
            </button>
          </li>
        {/each}
      </ul>
    {/if}
    <SearchSelect
      label="Add a part to merge in"
      placeholder="Search {available.length} part(s)"
      items={available}
      key={(c) => c.id}
      text={(c) => `${c.name} ${c.partNumber ?? ''}`}
      onselect={(c) => (sources = [...sources, { id: c.id, name: c.name }])}
    >
      {#snippet option(c)}{c.name}{c.partNumber ? ` (${c.partNumber})` : ''}{/snippet}
    </SearchSelect>
  </div>

  <div class="grid gap-3 sm:grid-cols-2">
    <label class="block">
      Length of each piece
      <select bind:value={lengthKey} class="input">
        {#each dimensionOptions as option (option.key)}
          <option value={option.key}>{option.label}</option>
        {/each}
      </select>
    </label>
    <label class="block">
      Width of each piece
      <select bind:value={widthKey} class="input">
        <option value="">(none: 1D, such as extrusion or rod)</option>
        {#each dimensionOptions as option (option.key)}
          <option value={option.key}>{option.label}</option>
        {/each}
      </select>
    </label>
  </div>

  <svelte:boundary>
    {#snippet pending()}<p class="text-gray-600">Loading the preview…</p>{/snippet}
    {@const result = await conversionPreview(args)}
    {#if !result.ok}
      <p class="msg-error">{result.message}</p>
    {:else}
      {@const preview = result.preview}
      <div>
        <h3 class="font-semibold">Pieces</h3>
        <table class="data-table stack-table">
          <thead><tr><th>Part</th><th>Piece size</th><th>Pieces</th></tr></thead>
          <tbody>
            {#each preview.parts as p (p.partId)}
              <tr>
                <td class="font-medium sm:font-normal">{p.name}{p.role === 'destination' ? ' (kept)' : ''}</td>
                <td data-label="Size">{p.size ? formatPieceSize(p.size) : '—'}</td>
                <td data-label="Pieces">
                  {p.stock.map((s) => `${s.count} at ${s.locationName}`).join(', ') || 'none'}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>

      {#if preview.skus.length > 0}
        <div>
          <h3 class="font-semibold">Supplier references</h3>
          <ul>
            {#each preview.skus as s (`${s.fromPartId}-${s.supplier}-${s.sku}`)}
              <li>
                {s.supplier} {s.sku}:
                {#if s.kept && s.stockLengthMm !== null}
                  stock size {formatPieceSize({ lengthMm: s.stockLengthMm, widthMm: s.stockWidthMm })}
                {:else if s.kept}
                  no stock size
                {:else}
                  <span class="text-gray-600">already on this part, removed</span>
                {/if}
              </li>
            {/each}
          </ul>
        </div>
      {/if}
      <p>{preview.bomLineCount} project row(s) will use this part. Their quantities stay piece counts.</p>

      {#if preview.differences.length > 0}
        <div class="space-y-2">
          <h3 class="font-semibold">Attributes that differ</h3>
          {#each preview.differences as difference (difference.key)}
            {@const values = [...new Set(difference.values.flatMap((v) => (v.rawValue ? [v.rawValue] : [])))]}
            <div class="rounded border border-amber-300 bg-amber-50 p-2">
              <p class="font-medium">{difference.label}</p>
              <ul class="mb-1">
                {#each difference.values as value (value.partId)}
                  <li>{value.partName}: {value.display ?? 'missing'}</li>
                {/each}
              </ul>
              <div class="flex flex-wrap items-center gap-2">
                <input
                  list="values-{difference.key}"
                  bind:value={chosen[difference.key]}
                  placeholder={values[0] ?? 'Value'}
                  aria-label="Value of {difference.label} for all parts"
                  class="input-sm w-40"
                />
                <datalist id="values-{difference.key}">
                  {#each values as value (value)}<option {value}></option>{/each}
                </datalist>
                {#each values as value (value)}
                  <button type="button" class="btn-secondary" onclick={() => ((chosen[difference.key] = value), useForAll(difference.key, difference.values.map((v) => v.partId)))}>
                    Use {value} for all
                  </button>
                {/each}
                <button type="button" class="btn-secondary" onclick={() => useForAll(difference.key, difference.values.map((v) => v.partId))}>
                  Use typed value for all
                </button>
              </div>
            </div>
          {/each}
          {#if fixError}<p class="msg-error">{fixError}</p>{/if}
        </div>
      {/if}

      {#if preview.blockers.length > 0}
        <ul class="msg-error list-inside list-disc">
          {#each preview.blockers as blocker (blocker)}<li>{blocker}</li>{/each}
        </ul>
      {/if}

      <form
        {...convertParts.enhance(async ({ submit }) => {
          const deleted = sources.length > 0 ? ` and delete ${sources.length} merged part(s)` : '';
          if (confirm(`Convert to piece-tracked${deleted}? This cannot be undone.`)) await submit();
        })}
        class="space-y-3"
      >
        <input {...convertParts.fields.operationId.as('hidden', operationId)} />
        <input {...convertParts.fields.occurredOn.as('hidden', today)} />
        <input {...convertParts.fields.destinationId.as('hidden', part.id)} />
        {#each sources as source, index (source.id)}
          <input {...convertParts.fields.sourceIds[index].as('hidden', source.id)} />
        {/each}
        <input {...convertParts.fields.lengthKey.as('hidden', lengthKey)} />
        <input {...convertParts.fields.widthKey.as('hidden', widthKey)} />
        <div class="grid gap-3 sm:grid-cols-3">
          <label class="block sm:col-span-3">
            Name after conversion
            <input {...convertParts.fields.name.as('text', part.name)} class="input" />
          </label>
          <label class="block">
            Kerf (mm or in)
            <input {...convertParts.fields.kerf.as('text')} placeholder="0" class="input" />
          </label>
          <label class="block">
            Minimum offcut (mm or in)
            <input {...convertParts.fields.minOffcut.as('text')} placeholder="0" class="input" />
          </label>
        </div>
        {#if convertParts.fields.allIssues()?.length}
          <p class="msg-error">{convertParts.fields.allIssues()?.map((issue) => issue.message).join('. ')}</p>
        {/if}
        <button class="btn-danger" disabled={preview.blockers.length > 0 || convertParts.pending > 0}>
          Convert to piece-tracked
        </button>
      </form>
    {/if}
  </svelte:boundary>
</div>
