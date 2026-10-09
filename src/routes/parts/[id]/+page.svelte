<script lang="ts">
  import { tick } from 'svelte';
  import { enhance } from '$app/forms';
  import { formatAttributeValue } from '#lib/attributes.ts';
  import { formatArea, formatMm, formatPieceSize, formatPieceSizeInches } from '#lib/pieces.ts';
  import { formatQuantity } from '#lib/units.ts';
  import SearchSelect from '#lib/components/SearchSelect.svelte';
  import { mergePart } from './merge.remote';
  import { addPieces, movePiece, removePiece } from './pieces.remote';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  const MOVEMENT_LABELS: Record<string, string> = {
    opening: 'Opening stock',
    transfer: 'Transfer',
    loss: 'Loss',
    supplier_return: 'Supplier return',
    count_correction: 'Count correction',
    pick: 'Picked for project',
    project_use: 'Used by project',
    project_return: 'Returned from project',
    receipt: 'Order receipt',
  };

  const part = $derived(data.part);
  const isPieces = $derived(part.trackingMode === 'pieces');
  const dimensions = $derived(data.pieceDimensions);
  const total = $derived(data.balances.reduce((sum, b) => sum + b.quantity, 0));
  const reservedAt = (locationId: number) =>
    data.reserved.find((r) => r.locationId === locationId)?.reserved ?? 0;
  const balanceOf = (locationId: number) =>
    data.balances.find((b) => b.locationId === locationId)?.quantity ?? 0;
  const locationLabel = (location: { id: number; name: string }) =>
    `${location.name} (${formatQuantity(balanceOf(location.id), part.baseUnit)})`;

  function feedback(action: string) {
    if (form?.action !== action) return null;
    if ('success' in form) return { ok: true, text: form.success };
    if ('message' in form) return { ok: false, text: form.message };
    if ('errors' in form) return { ok: false, text: Object.values(form.errors ?? {}).join('. ') };
    return null;
  }

  const stockForms = [
    { action: 'opening', title: 'Opening stock', locationLabel: 'Into location', amountLabel: 'Quantity', reason: 'optional' },
    { action: 'transfer', title: 'Transfer', locationLabel: 'From', amountLabel: 'Quantity', reason: 'optional' },
    { action: 'loss', title: 'Loss', locationLabel: 'From', amountLabel: 'Quantity', reason: 'required' },
    { action: 'supplier_return', title: 'Return to supplier', locationLabel: 'From', amountLabel: 'Quantity', reason: 'required' },
    { action: 'count', title: 'Stock count', locationLabel: 'Location', amountLabel: 'Counted quantity', reason: 'required' },
  ] as const;
  type StockFormAction = (typeof stockForms)[number]['action'];

  // After a submit, the form keeps the kind of change that was just recorded.
  // svelte-ignore state_referenced_locally
  let stockAction = $state<StockFormAction>(
    stockForms.find((sf) => sf.action === form?.action)?.action ?? 'opening'
  );
  const stockForm = $derived(stockForms.find((sf) => sf.action === stockAction)!);
  // svelte-ignore state_referenced_locally
  let stockLocationId = $state(data.balances[0]?.locationId ?? data.locations[0]?.id);
  let amountInput = $state<HTMLInputElement>();

  // Number of size rows in the add pieces form. A row makes `count` equal pieces.
  let pieceRowCount = $state(1);

  // The piece that the move or remove form changes.
  let pieceAction = $state<{ kind: 'move' | 'remove'; pieceId: number } | null>(null);
  const actionPiece = $derived(data.pieces.find((p) => p.id === pieceAction?.pieceId));
  let pieceActionForm = $state<HTMLElement>();
  async function startPieceAction(kind: 'move' | 'remove', pieceId: number) {
    pieceAction = { kind, pieceId };
    await tick();
    pieceActionForm?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    pieceActionForm?.querySelector<HTMLElement>('select, input:not([type=hidden])')?.focus({ preventScroll: true });
  }
  const issuesOf = (f: { fields: { allIssues(): { message: string }[] | undefined } }) =>
    f.fields.allIssues()?.map((issue) => issue.message).join('. ');

  let mergeDestinationId = $state('');
  const mergeDestination = $derived(data.mergeTargets.find((p) => String(p.id) === mergeDestinationId));

  /** Open the stock form for one kind of change at one location, ready for the amount. */
  async function startStockChange(action: StockFormAction, locationId: number) {
    stockAction = action;
    stockLocationId = locationId;
    await tick();
    amountInput?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    amountInput?.focus({ preventScroll: true });
  }
</script>

<svelte:head>
  <title>{part.name}</title>
</svelte:head>

<a href="/parts" class="back-link">← Parts</a>

<div class="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
  <h1 class="page-title">{part.name}</h1>
  {#if part.archivedAt}
    <span class="badge">archived</span>
  {/if}
  <span class="text-lg text-gray-600">
    {isPieces ? `${data.pieces.length} piece(s)` : formatQuantity(total, part.baseUnit)} in stock
  </span>
  <div class="flex gap-2 sm:ml-auto">
    <a href="/parts/{part.id}/edit" class="btn-secondary">Edit</a>
    <a href="/parts/new?from={part.id}" class="btn-secondary">Copy</a>
    <form method="POST" action={part.archivedAt ? '?/restore' : '?/archive'} use:enhance>
      <button class="btn-secondary">{part.archivedAt ? 'Restore' : 'Archive'}</button>
    </form>
  </div>
</div>
{#if feedback('archive') ?? feedback('restore')}
  {@const fb = feedback('archive') ?? feedback('restore')}
  <p class="mb-3 {fb?.ok ? 'msg-ok' : 'msg-error'}">{fb?.text}</p>
{/if}

<section class="card mb-6 grid gap-4 sm:grid-cols-2">
  <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
    <dt class="text-gray-600">Category</dt><dd>{part.categoryName ?? '—'}</dd>
    <dt class="text-gray-600">Base unit</dt><dd>{part.baseUnit}</dd>
    {#if dimensions}
      <dt class="text-gray-600">Tracked as</dt>
      <dd>
        pieces by {dimensions.length.label.toLowerCase()}{dimensions.width ? ` × ${dimensions.width.label.toLowerCase()}` : ''};
        kerf {formatMm(part.kerfMm)}, minimum offcut {formatMm(part.minOffcutMm)}
      </dd>
    {/if}
    <dt class="text-gray-600">Manufacturer</dt><dd>{part.manufacturer ?? '—'}</dd>
    <dt class="text-gray-600">Part number</dt><dd>{part.partNumber ?? '—'}</dd>
    <dt class="text-gray-600">Aliases</dt><dd>{data.aliases.join(', ') || '—'}</dd>
    <dt class="text-gray-600">Tags</dt><dd>{data.tags.join(', ') || '—'}</dd>
    {#each data.attributes as attribute (attribute.key)}
      {@const normalized = formatAttributeValue(attribute.normalization, attribute)}
      <dt class="text-gray-600">{attribute.label}</dt>
      <dd>
        {attribute.rawValue}
        {#if normalized === null && attribute.normalization}
          <span class="text-gray-500">(not recognized; compared as unknown)</span>
        {:else if normalized !== null && normalized !== attribute.rawValue}
          <span class="text-gray-500">→ {normalized}</span>
        {/if}
      </dd>
    {/each}
  </dl>
  <div class="text-sm">
    {#if data.supplierParts.length > 0}
      <h2 class="font-semibold">Supplier references</h2>
      <ul class="mb-2">
        {#each data.supplierParts as sp (sp.id)}
          <li>
            {sp.supplier}
            {#if sp.url}<a href={sp.url} class="link" rel="noreferrer" target="_blank">{sp.sku}</a>{:else}{sp.sku}{/if}
            {#if sp.stockLengthMm !== null}
              <span class="text-gray-600">
                — stock size {formatPieceSize({ lengthMm: sp.stockLengthMm, widthMm: sp.stockWidthMm })}
              </span>
            {/if}
            {#if sp.purchaseUnit || sp.packQuantity}
              <span class="text-gray-600">
                — {sp.purchaseUnit ?? 'purchase unit'}{#if sp.packQuantity} = {formatQuantity(sp.packQuantity, part.baseUnit)}{/if}
              </span>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
    {#if part.notes}
      <h2 class="font-semibold">Notes</h2>
      <p class="whitespace-pre-line">{part.notes}</p>
    {/if}
  </div>
</section>

{#if isPieces}
  {@render piecesSection()}
{:else}
<section class="mb-6">
  <h2 class="section-title">Stock by location</h2>
  {#if data.balances.length === 0}
    <p class="text-gray-600">No stock recorded.</p>
  {:else}
    <table class="data-table stack-table max-w-3xl">
      <thead>
        <tr><th>Location</th><th class="text-right">Quantity</th><th>Reserved</th><th></th></tr>
      </thead>
      <tbody>
        {#each data.balances as balance (balance.locationId)}
          <tr>
            <td class="font-medium sm:font-normal">{balance.locationName}</td>
            <td data-label="Quantity" class="text-right whitespace-nowrap">{formatQuantity(balance.quantity, part.baseUnit)}</td>
            <td data-label="Reserved" class="text-gray-600 {reservedAt(balance.locationId) > 0 ? '' : 'max-sm:hidden'}">
              {#if reservedAt(balance.locationId) > 0}
                {formatQuantity(reservedAt(balance.locationId), part.baseUnit)} reserved,
                {formatQuantity(balance.quantity - reservedAt(balance.locationId), part.baseUnit)} available
              {/if}
            </td>
            <td class="whitespace-nowrap sm:text-right">
              {#if !part.archivedAt}
                <div class="mt-1 flex gap-1 sm:mt-0 sm:justify-end">
                  <button type="button" class="btn-secondary" onclick={() => startStockChange('count', balance.locationId)}>Count</button>
                  {#if data.locations.length > 1}
                    <button type="button" class="btn-secondary" onclick={() => startStockChange('transfer', balance.locationId)}>Move</button>
                  {/if}
                </div>
              {/if}
            </td>
          </tr>
        {/each}
        <tr class="font-semibold">
          <td>Total physical stock</td>
          <td data-label="Total" class="text-right whitespace-nowrap">{formatQuantity(total, part.baseUnit)}</td>
          <td class="max-sm:hidden"></td>
          <td class="max-sm:hidden"></td>
        </tr>
      </tbody>
    </table>
  {/if}
</section>

{/if}

{#if !part.archivedAt && isPieces}
  {@render addPiecesSection()}
{:else if !part.archivedAt}
  <section class="mb-6" id="change-stock">
    <h2 class="section-title">Change stock</h2>
    {#if data.locations.length === 0}
      <p class="text-gray-600">
        <a href="/settings/locations" class="link">Add a storage location</a> first.
      </p>
    {:else}
      {@const fb = feedback(stockForm.action)}
      <div class="card max-w-xl">
        <div role="tablist" aria-label="Kind of stock change" class="-mx-1 mb-3 flex gap-1 overflow-x-auto px-1 pb-1">
          {#each stockForms as sf (sf.action)}
            <button
              type="button"
              role="tab"
              aria-selected={sf.action === stockAction}
              class={sf.action === stockAction ? 'pill-active' : 'pill'}
              onclick={() => (stockAction = sf.action)}>{sf.title}</button
            >
          {/each}
        </div>
        <form method="POST" action="?/{stockForm.action}" use:enhance class="space-y-3 text-sm">
          <input type="hidden" name="operation_id" value={data.operationId} />
          <div class="grid gap-3 sm:grid-cols-2">
            <label class="block">
              {stockForm.locationLabel}
              <select name="location_id" required class="input" bind:value={stockLocationId}>
                {#each data.locations as location (location.id)}
                  <option value={location.id}>{locationLabel(location)}</option>
                {/each}
              </select>
            </label>
            {#if stockForm.action === 'transfer'}
              <label class="block">
                To
                <select name="to_location_id" required class="input">
                  {#each data.locations as location (location.id)}
                    <option value={location.id} selected={location.id !== stockLocationId}>{locationLabel(location)}</option>
                  {/each}
                </select>
              </label>
            {/if}
            <div class="flex gap-2">
              <label class="block grow">
                {stockForm.amountLabel}
                <input bind:this={amountInput} name="amount" required inputmode="decimal" class="input" />
              </label>
              <label class="block">
                Unit
                <select name="unit" class="input">
                  {#each data.units as unit (unit)}
                    <option value={unit} selected={unit === part.baseUnit}>{unit}</option>
                  {/each}
                </select>
              </label>
            </div>
            <label class="block">
              Date
              <input name="occurred_on" type="date" value={data.today} required class="input" />
            </label>
            <label class="block sm:col-span-2">
              Reason{stockForm.reason === 'optional' ? ' (optional)' : ''}
              <input name="reason" required={stockForm.reason === 'required'} class="input" />
            </label>
          </div>
          {#if fb}<p class={fb.ok ? 'msg-ok' : 'msg-error'}>{fb.text}</p>{/if}
          <button class="btn">Record {stockForm.title.toLowerCase()}</button>
        </form>
      </div>
    {/if}
  </section>
{/if}

<section>
  <h2 class="section-title">Movement history</h2>
  {#if data.movements.length === 0}
    <p class="text-gray-600">No movements.</p>
  {:else}
    <table class="data-table stack-table">
      <thead>
        <tr><th>Date</th><th>Type</th><th>From</th><th>To</th><th class="text-right">Quantity</th><th>Reason</th></tr>
      </thead>
      <tbody>
        {#each data.movements as movement (movement.id)}
          <tr>
            <td class="whitespace-nowrap text-gray-600">{movement.occurredOn}</td>
            <td class="font-medium sm:font-normal">{MOVEMENT_LABELS[movement.movementType] ?? movement.movementType}</td>
            <td data-label="From">{movement.fromLocationName ?? 'outside'}</td>
            <td data-label="To">{movement.toLocationName ?? 'outside'}</td>
            <td data-label="Quantity" class="text-right whitespace-nowrap">{formatQuantity(movement.quantity, part.baseUnit)}</td>
            <td data-label="Reason" class="text-gray-600 {movement.reason ? '' : 'max-sm:hidden'}">{movement.reason ?? ''}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</section>

{#if !isPieces}
<section class="mt-6">
  <h2 class="section-title">Merge into another part</h2>
  <div class="card max-w-xl space-y-3 text-sm">
    <p class="text-gray-600">
      Use this when this part is a duplicate. Its stock history, orders, project rows,
      reservations, aliases, and supplier references move to the part you choose, and then this
      part is deleted. The attributes and tags of this part are not kept. Only parts with the
      same base unit ({part.baseUnit}) can be chosen.
    </p>
    <form
      {...mergePart.enhance(async ({ submit }) => {
        if (confirm(`Move the records of this part to "${mergeDestination?.name}" and delete this part?`)) {
          await submit();
        }
      })}
      class="space-y-3"
    >
      <input {...mergePart.fields.sourceId.as('hidden', part.id)} />
      <input {...mergePart.fields.destinationId.as('hidden', mergeDestinationId)} />
      <p>
        {#if mergeDestination}
          Keep: {mergeDestination.name}{mergeDestination.partNumber ? ` (${mergeDestination.partNumber})` : ''}
        {:else}
          <span class="text-gray-600">No part chosen</span>
        {/if}
      </p>
      <SearchSelect
        label="Search for the part to keep"
        placeholder="Search {data.mergeTargets.length} part(s)"
        items={data.mergeTargets}
        key={(target) => target.id}
        text={(target) => `${target.name} ${target.partNumber ?? ''}`}
        onselect={(target) => (mergeDestinationId = String(target.id))}
      >
        {#snippet option(target)}{target.name}{target.partNumber ? ` (${target.partNumber})` : ''}{/snippet}
      </SearchSelect>
      {#if mergePart.fields.allIssues()?.length}
        <p class="msg-error">{mergePart.fields.allIssues()?.map((issue) => issue.message).join('. ')}</p>
      {/if}
      <button class="btn-danger" disabled={!mergeDestination || mergePart.pending > 0}>Merge and delete this part</button>
    </form>
  </div>
</section>
{/if}

{#snippet pieceSize(piece: { lengthMm: number; widthMm: number | null })}
  <span title={formatPieceSizeInches(piece)}>{formatPieceSize(piece)}</span>
{/snippet}

{#snippet piecesSection()}
  <section class="mb-6">
    <h2 class="section-title">Pieces by location</h2>
    {#if data.pieces.length === 0}
      <p class="text-gray-600">No pieces in stock.</p>
    {:else}
      <table class="data-table stack-table mb-4 max-w-3xl">
        <thead>
          <tr>
            <th>Location</th>
            <th class="text-right">Pieces</th>
            <th class="text-right">{dimensions?.width ? 'Total area' : 'Total length'}</th>
          </tr>
        </thead>
        <tbody>
          {#each data.pieceTotals as total (total.locationId)}
            <tr>
              <td class="font-medium sm:font-normal"><a href="/locations/{total.locationId}" class="link">{total.locationName}</a></td>
              <td data-label="Pieces" class="text-right">{total.pieceCount}</td>
              <td data-label="Total" class="text-right whitespace-nowrap">
                {total.totalAreaMm2 === null ? formatMm(total.totalLengthMm) : formatArea(total.totalAreaMm2)}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>

      <table class="data-table stack-table max-w-3xl">
        <thead>
          <tr><th>Size</th><th>Location</th><th>Label</th><th></th></tr>
        </thead>
        <tbody>
          {#each data.pieces as piece (piece.id)}
            <tr class={pieceAction?.pieceId === piece.id ? 'bg-blue-50' : ''}>
              <td class="font-medium whitespace-nowrap sm:font-normal">{@render pieceSize(piece)}</td>
              <td data-label="Location">{piece.locationName}</td>
              <td data-label="Label" class="text-gray-600 {piece.label ? '' : 'max-sm:hidden'}">{piece.label ?? ''}</td>
              <td class="whitespace-nowrap sm:text-right">
                {#if !part.archivedAt && piece.locationKind === 'storage'}
                  <div class="mt-1 flex gap-1 sm:mt-0 sm:justify-end">
                    {#if data.locations.length > 1}
                      <button type="button" class="btn-secondary" onclick={() => startPieceAction('move', piece.id)}>Move</button>
                    {/if}
                    <button type="button" class="btn-secondary" onclick={() => startPieceAction('remove', piece.id)}>Remove</button>
                  </div>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}

    {#if movePiece.result}<p class="msg-ok mt-3">{movePiece.result.text}</p>{/if}
    {#if removePiece.result}<p class="msg-ok mt-3">{removePiece.result.text}</p>{/if}
    {#if pieceAction && actionPiece}
      <div bind:this={pieceActionForm} class="card mt-3 max-w-xl text-sm">
        {#if pieceAction.kind === 'move'}
          <form {...movePiece} class="space-y-3">
            <h3 class="font-semibold">Move {formatPieceSize(actionPiece)} from {actionPiece.locationName}</h3>
            <input {...movePiece.fields.operationId.as('hidden', data.operationId)} />
            <input {...movePiece.fields.occurredOn.as('hidden', data.today)} />
            <input {...movePiece.fields.pieceId.as('hidden', actionPiece.id)} />
            <div class="grid gap-3 sm:grid-cols-2">
              <label class="block">
                To
                <select {...movePiece.fields.toLocationId.as('select')} required class="input">
                  {#each data.locations.filter((l) => l.id !== actionPiece.locationId) as location (location.id)}
                    <option value={String(location.id)}>{location.name}</option>
                  {/each}
                </select>
              </label>
              <label class="block">
                Reason (optional)
                <input {...movePiece.fields.reason.as('text')} class="input" />
              </label>
            </div>
            {#if issuesOf(movePiece)}<p class="msg-error">{issuesOf(movePiece)}</p>{/if}
            <div class="flex gap-2">
              <button class="btn" disabled={movePiece.pending > 0}>Move piece</button>
              <button type="button" class="btn-secondary" onclick={() => (pieceAction = null)}>Cancel</button>
            </div>
          </form>
        {:else}
          <form {...removePiece} class="space-y-3">
            <h3 class="font-semibold">Remove {formatPieceSize(actionPiece)} from {actionPiece.locationName}</h3>
            <input {...removePiece.fields.operationId.as('hidden', data.operationId)} />
            <input {...removePiece.fields.occurredOn.as('hidden', data.today)} />
            <input {...removePiece.fields.pieceId.as('hidden', actionPiece.id)} />
            <label class="block">
              Reason
              <input {...removePiece.fields.reason.as('text')} required placeholder="Lost, bent, scrap…" class="input" />
            </label>
            {#if issuesOf(removePiece)}<p class="msg-error">{issuesOf(removePiece)}</p>{/if}
            <div class="flex gap-2">
              <button class="btn-danger" disabled={removePiece.pending > 0}>Remove piece</button>
              <button type="button" class="btn-secondary" onclick={() => (pieceAction = null)}>Cancel</button>
            </div>
          </form>
        {/if}
      </div>
    {/if}
  </section>
{/snippet}

{#snippet addPiecesSection()}
  <section class="mb-6" id="add-pieces">
    <h2 class="section-title">Add pieces</h2>
    {#if data.locations.length === 0}
      <p class="text-gray-600">
        <a href="/settings/locations" class="link">Add a storage location</a> first.
      </p>
    {:else}
      <form {...addPieces} class="card max-w-2xl space-y-3 text-sm">
        <p class="text-gray-600">
          Existing pieces, such as stock you have when you start, or pieces a count found. Enter sizes in mm, or add
          <code>in</code> for inches. Receipts of orders add pieces on their own.
        </p>
        <input {...addPieces.fields.operationId.as('hidden', data.operationId)} />
        <input {...addPieces.fields.partId.as('hidden', part.id)} />
        {#each { length: pieceRowCount }, index (index)}
          {@const row = addPieces.fields.pieces[index]}
          <div class="flex flex-wrap items-end gap-2">
            <label class="block w-32">
              {dimensions?.length.label ?? 'Length'}
              <input {...row.length.as('text')} required={index === 0} placeholder="e.g. 1220" class="input" />
            </label>
            {#if dimensions?.width}
              <label class="block w-32">
                {dimensions.width.label}
                <input {...row.width.as('text')} required={index === 0} placeholder="e.g. 150" class="input" />
              </label>
            {/if}
            <label class="block w-20">
              Count
              <input {...row.count.as('text', '1')} inputmode="numeric" class="input" />
            </label>
            <label class="block grow">
              Label (optional)
              <input {...row.label.as('text')} class="input" />
            </label>
          </div>
        {/each}
        <button type="button" class="btn-secondary" onclick={() => (pieceRowCount += 1)}>Add another size</button>
        <div class="grid gap-3 sm:grid-cols-2">
          <label class="block">
            Into location
            <select {...addPieces.fields.locationId.as('select', String(data.locations[0]?.id ?? ''))} required class="input">
              {#each data.locations as location (location.id)}
                <option value={String(location.id)}>{location.name}</option>
              {/each}
            </select>
          </label>
          <label class="block">
            Date
            <input {...addPieces.fields.occurredOn.as('date', data.today)} required class="input" />
          </label>
          <label class="block sm:col-span-2">
            Reason (optional)
            <input {...addPieces.fields.reason.as('text')} class="input" />
          </label>
        </div>
        {#if issuesOf(addPieces)}<p class="msg-error">{issuesOf(addPieces)}</p>{/if}
        {#if addPieces.result}<p class="msg-ok">{addPieces.result.text}</p>{/if}
        <button class="btn" disabled={addPieces.pending > 0}>Add pieces</button>
      </form>
    {/if}
  </section>
{/snippet}
