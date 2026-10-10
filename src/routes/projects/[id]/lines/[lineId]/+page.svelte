<script lang="ts">
  import { enhance } from '$app/forms';
  import PartPicker from '#lib/components/PartPicker.svelte';
  import {
    formatLength,
    formatSize,
    isWholePiece,
    lengthInputValue,
    type PieceDisplayUnit,
  } from '#lib/pieces.ts';
  import { describeConstraint, formatLineQuantity } from '#lib/projects.ts';
  import { formatQuantity } from '#lib/units.ts';
  import {
    acceptSuggestion,
    pickPieces,
    releasePieceReservation,
    reservePiece,
    resizePieceReservation,
    returnPiece,
    usePiece,
  } from '../../pieces.remote';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  const line = $derived(data.line);
  const STATUS_STYLES = {
    match: 'bg-green-100 text-green-800',
    unresolved: 'bg-amber-100 text-amber-800',
    conflict: 'bg-red-100 text-red-800',
  } as const;
  const STATUS_LABELS = { match: 'match', unresolved: 'needs review', conflict: 'conflict' } as const;

  const feedback = $derived.by(() => {
    if (form?.action !== 'approve') return null;
    if ('success' in form) return { ok: true, text: form.success };
    if ('message' in form) return { ok: false, text: form.message };
    if ('errors' in form) return { ok: false, text: Object.values(form.errors ?? {}).join('. ') };
    return null;
  });

  const STOCK_ACTIONS = ['reserve', 'release', 'pick', 'use', 'return'];
  const stockFeedback = $derived.by(() => {
    if (!form || !STOCK_ACTIONS.includes(form.action)) return null;
    if ('success' in form) return { ok: true, text: form.success };
    if ('message' in form) return { ok: false, text: form.message };
    if ('errors' in form) return { ok: false, text: Object.values(form.errors ?? {}).join('. ') };
    return null;
  });

  const sheetFeedback = $derived.by(() => {
    if (form?.action !== 'cutsPerSheet') return null;
    if ('success' in form) return { ok: true, text: form.success };
    if ('message' in form) return { ok: false, text: form.message };
    if ('errors' in form) return { ok: false, text: Object.values(form.errors ?? {}).join('. ') };
    return null;
  });

  const incomingFeedback = $derived.by(() => {
    if (form?.action !== 'incoming') return null;
    if ('success' in form) return { ok: true, text: form.success };
    if ('message' in form) return { ok: false, text: form.message };
    if ('errors' in form) return { ok: false, text: Object.values(form.errors ?? {}).join('. ') };
    return null;
  });

  const coverage = $derived(data.stock.coverage);
  const lineCommitments = $derived(coverage.parts.flatMap((p) => p.commitments));
  const linePieceCommitments = $derived(coverage.parts.flatMap((p) => p.pieceCommitments));
  const allocationOf = (partId: number) => coverage.parts.find((p) => p.partId === partId);
  const issuesOf = (f: { fields: { allIssues(): { message: string }[] | undefined } }) =>
    f.fields.allIssues()?.map((issue) => issue.message).join('. ');
  const pickedOf = (partId: number) => data.pickedPieces.filter((p) => p.partId === partId);
  const reservedHere = (partId: number, locationId: number) =>
    allocationOf(partId)?.reservations.find((r) => r.locationId === locationId)?.quantity ?? 0;
</script>

<svelte:head>
  <title>{line.description} · {data.project.name}</title>
</svelte:head>

{#snippet hiddenFields(partId: number)}
  <input type="hidden" name="line_id" value={line.id} />
  <input type="hidden" name="part_id" value={partId} />
  <input type="hidden" name="operation_id" value={data.operationId} />
  <input type="hidden" name="occurred_on" value={data.today} />
{/snippet}

{#snippet amountFields(part: { baseUnit: string; units: string[] }, max?: number)}
  <input
    name="amount"
    required
    inputmode="decimal"
    value={max ?? ''}
    aria-label="Quantity"
    class="input-sm w-20"
  />
  <select name="unit" aria-label="Unit" class="input-sm">
    {#each part.units as unit (unit)}
      <option value={unit} selected={unit === part.baseUnit}>{unit}</option>
    {/each}
  </select>
{/snippet}

{#snippet amountForm(
  action: string,
  label: string,
  part: { partId: number; baseUnit: string; units: string[] },
  locationId: number,
  max?: number
)}
  <form method="POST" action="?/{action}" use:enhance class="flex items-end gap-1">
    {@render hiddenFields(part.partId)}
    <input type="hidden" name="location_id" value={locationId} />
    {@render amountFields(part, max)}
    <button class="btn-secondary">{label}</button>
  </form>
{/snippet}

{#snippet sizeFields(
  form: ReturnType<typeof reservePiece.for> | ReturnType<typeof resizePieceReservation.for>,
  unit: PieceDisplayUnit,
  twoD: boolean,
  size: { lengthMm: number; widthMm: number | null } | null
)}
  <input {...form.fields.unit.as('hidden', unit)} />
  <input
    {...form.fields.length.as('text')}
    value={size ? lengthInputValue(size.lengthMm, unit) : ''}
    placeholder="Length ({unit})"
    aria-label="Length"
    class="input-sm w-24"
  />
  {#if twoD}
    ×
    <input
      {...form.fields.width.as('text')}
      value={size?.widthMm ? lengthInputValue(size.widthMm, unit) : ''}
      placeholder="Width ({unit})"
      aria-label="Width"
      class="input-sm w-24"
    />
    <label class="flex items-center gap-1">
      <input {...form.fields.confirmFit.as('checkbox')} /> The cut size fits in the piece
    </label>
  {/if}
{/snippet}

{#snippet formResult(form: { result?: { text: string; warnings: string[] } } & Parameters<typeof issuesOf>[0])}
  {#if issuesOf(form)}<p class="msg-error w-full">{issuesOf(form)}</p>{/if}
  {#if form.result}
    <p class="msg-ok w-full">{form.result.text}</p>
    {#each form.result.warnings as warning (warning)}<p class="notice w-full">{warning}</p>{/each}
  {/if}
{/snippet}

{#snippet resizeForm(reservation: (typeof coverage.parts)[number]['pieceReservations'][number])}
  {@const resize = resizePieceReservation.for(reservation.id)}
  <details class="w-full">
    <summary class="cursor-pointer text-gray-600">Change size</summary>
    <form {...resize} class="mt-1 flex flex-wrap items-center gap-2">
      <input {...resize.fields.projectId.as('hidden', data.project.id)} />
      <input {...resize.fields.reservationId.as('hidden', reservation.id)} />
      {@render sizeFields(resize, reservation.displayUnit, reservation.pieceWidthMm !== null, reservation)}
      <button class="btn-secondary" disabled={resize.pending > 0}>Change size</button>
      {@render formResult(resize)}
    </form>
  </details>
{/snippet}

{#snippet storagePieces(part: (typeof data.stock.parts)[number])}
  <h4 class="mb-1 font-medium">Pieces in storage</h4>
  <p class="mb-1 text-gray-600">
    Leave the size empty to reserve {line.cutLengthMm === null ? 'the whole piece' : 'the row\'s cut size'}.
  </p>
  <table class="data-table stack-table mb-2">
    <thead>
      <tr><th>Piece</th><th>Location</th><th class="text-right">Free</th><th>Reserved</th><th></th></tr>
    </thead>
    <tbody>
      {#each part.storagePieces as piece (piece.id)}
        {@const unit = piece.displayUnit}
        {@const twoD = piece.widthMm !== null}
        {@const reserve = reservePiece.for(piece.id)}
        <tr>
          <td class="font-medium sm:font-normal">
            <a href="/pieces/{piece.id}" class="link">#{piece.id}</a> {formatSize(piece, unit)}
            {#if piece.label}<span class="text-gray-600">{piece.label}</span>{/if}
          </td>
          <td data-label="Location">{piece.locationName}</td>
          <td data-label="Free" class="text-right">
            {twoD ? (piece.reservations.length === 0 ? 'whole piece' : 'none') : formatLength(piece.freeLengthMm, unit)}
          </td>
          <td data-label="Reserved">
            {#each piece.reservations as r (r.id)}
              <div>{formatSize(r, unit)} for {r.projectName}: {r.lineDescription}</div>
            {:else}
              —
            {/each}
          </td>
          <td class="pt-2 sm:pt-1.5">
            {#if twoD ? piece.reservations.length === 0 : piece.freeLengthMm > 0}
              <form {...reserve} class="flex flex-wrap items-center gap-1">
                <input {...reserve.fields.projectId.as('hidden', data.project.id)} />
                <input {...reserve.fields.lineId.as('hidden', line.id)} />
                <input {...reserve.fields.pieceId.as('hidden', piece.id)} />
                {@render sizeFields(reserve, unit, twoD, null)}
                <button class="btn-secondary" disabled={reserve.pending > 0}>Reserve</button>
                {@render formResult(reserve)}
              </form>
            {/if}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
{/snippet}

{#snippet pieceStock(
  part: (typeof data.stock.parts)[number],
  allocation: (typeof coverage.parts)[number] | undefined
)}
  {@const free = part.storagePieces.filter((p) => p.reservations.length === 0).length}
  <p class="mb-2 text-gray-600">
    Tracked as pieces. In storage: {part.storagePieces.length} piece(s), {free} with no reservation.
  </p>
  {#if allocation && allocation.pieceReservations.length > 0}
    <h4 class="mb-1 font-medium">Reserved for this row</h4>
    <ul class="mb-2 space-y-1">
      {#each allocation.pieceReservations as reservation (reservation.id)}
        {@const unit = reservation.displayUnit}
        {@const piece = { lengthMm: reservation.pieceLengthMm, widthMm: reservation.pieceWidthMm }}
        {@const whole = isWholePiece(piece, reservation)}
        {@const pick = pickPieces.for(`reservation-${reservation.id}`)}
        {@const release = releasePieceReservation.for(reservation.id)}
        <li class="flex flex-wrap items-center gap-2">
          <span class="font-semibold">{whole ? 'Whole piece' : formatSize(reservation, unit)}</span>
          <span class="text-gray-600">
            of <a href="/pieces/{reservation.pieceId}" class="link">piece #{reservation.pieceId}</a>
            ({formatSize(piece, unit)}) at {reservation.locationName}
          </span>
          {#if whole || reservation.widthMm === null}
            <form {...pick}>
              <input {...pick.fields.projectId.as('hidden', data.project.id)} />
              <input {...pick.fields.operationId.as('hidden', data.operationId)} />
              <input {...pick.fields.occurredOn.as('hidden', data.today)} />
              <input {...pick.fields.reservationIds.as('hidden', String(reservation.id))} />
              <input {...pick.fields.unit.as('hidden', unit)} />
              <button class="btn-secondary" disabled={pick.pending > 0}>Pick</button>
            </form>
          {:else}
            <a href="/projects/{data.project.id}/pick" class="link">Pick on the pick list</a>
          {/if}
          <form {...release}>
            <input {...release.fields.projectId.as('hidden', data.project.id)} />
            <input {...release.fields.reservationId.as('hidden', reservation.id)} />
            <button class="btn-secondary" disabled={release.pending > 0}>Release</button>
          </form>
          {#if issuesOf(pick)}<p class="msg-error w-full">{issuesOf(pick)}</p>{/if}
          {#if issuesOf(release)}<p class="msg-error w-full">{issuesOf(release)}</p>{/if}
          {@render resizeForm(reservation)}
        </li>
      {/each}
    </ul>
  {/if}
  {#if part.allowed && !part.archived && coverage.uncovered > 0 && part.storagePieces.length > 0}
    {@render storagePieces(part)}
  {/if}
  {#if allocation && allocation.used > 0}
    <p class="mb-1">Used: {formatQuantity(allocation.used, part.baseUnit)}.</p>
  {/if}
  {#if pickedOf(part.partId).length > 0}
    <h4 class="mb-1 font-medium">Picked and held</h4>
    <ul class="space-y-2">
      {#each pickedOf(part.partId) as picked (picked.pieceId)}
        {@const use = usePiece.for(picked.pieceId)}
        {@const back = returnPiece.for(picked.pieceId)}
        <li class="flex flex-wrap items-end gap-3">
          <span>
            <a href="/pieces/{picked.pieceId}" class="link">Piece #{picked.pieceId}</a>
            {formatSize(picked, picked.displayUnit)}
            {#if picked.label}<span class="text-gray-600">{picked.label}</span>{/if}
          </span>
          <form {...use} class="flex flex-wrap items-end gap-1">
            <input {...use.fields.projectId.as('hidden', data.project.id)} />
            <input {...use.fields.lineId.as('hidden', line.id)} />
            <input {...use.fields.pieceId.as('hidden', picked.pieceId)} />
            <input {...use.fields.operationId.as('hidden', data.operationId)} />
            <input {...use.fields.occurredOn.as('hidden', data.today)} />
            <input {...use.fields.reason.as('text')} placeholder="Note (optional)" class="input-sm" />
            <button class="btn-secondary" disabled={use.pending > 0}>Record use</button>
          </form>
          <form {...back} class="flex flex-wrap items-end gap-1">
            <input {...back.fields.projectId.as('hidden', data.project.id)} />
            <input {...back.fields.lineId.as('hidden', line.id)} />
            <input {...back.fields.pieceId.as('hidden', picked.pieceId)} />
            <input {...back.fields.operationId.as('hidden', data.operationId)} />
            <input {...back.fields.occurredOn.as('hidden', data.today)} />
            <select {...back.fields.toLocationId.as('select')} required aria-label="Return to" class="input-sm">
              {#each data.storageLocations as location (location.id)}
                <option value={String(location.id)}>{location.name}</option>
              {/each}
            </select>
            <label class="flex items-center gap-1">
              <input {...back.fields.reserveAgain.as('checkbox')} /> Reserve again
            </label>
            <button class="btn-secondary" disabled={back.pending > 0}>Return</button>
          </form>
          {#if issuesOf(use)}<p class="msg-error w-full">{issuesOf(use)}</p>{/if}
          {#if issuesOf(back)}<p class="msg-error w-full">{issuesOf(back)}</p>{/if}
        </li>
      {/each}
    </ul>
  {/if}
{/snippet}

<nav aria-label="Rows" class="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
  <a href="/projects/{data.project.id}" class="link">← {data.project.name}</a>
  <span class="ml-auto text-gray-500">Row {data.position.index + 1} of {data.position.count}</span>
  {#if data.previousLineId !== null}
    <a href="/projects/{data.project.id}/lines/{data.previousLineId}" class="btn-secondary">← Previous</a>
  {/if}
  {#if data.nextLineId !== null}
    <a href="/projects/{data.project.id}/lines/{data.nextLineId}" class="btn-secondary">Next →</a>
  {/if}
</nav>

<div class="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
  <h1 class="page-title">{line.description}</h1>
  <div class="flex gap-2 sm:ml-auto">
    <a href="/projects/{data.project.id}/lines/{line.id}/edit" class="btn-secondary">Edit row</a>
    <a
      href="/projects/{data.project.id}/lines/new{line.componentId === null ? '' : `?component=${line.componentId}`}"
      class="btn-secondary">Add another row</a
    >
  </div>
</div>

<dl class="card mb-6 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
  <dt class="text-gray-600">Quantity</dt><dd>{formatLineQuantity(line)}</dd>
  {#if line.cutWidthMm !== null}
    <dt class="text-gray-600">Cuts per sheet</dt>
    <dd>
      <form method="POST" action="?/cutsPerSheet" use:enhance class="flex flex-wrap items-center gap-1">
        <input
          name="cuts_per_sheet"
          inputmode="numeric"
          value={line.cutsPerSheet ?? ''}
          placeholder="1"
          aria-label="Cut pieces that fit on one stock sheet"
          class="input-sm w-16"
        />
        <button class="btn-secondary">Save</button>
        <span class="text-xs text-gray-600">
          How many cut pieces fit on one stock sheet. Shopping buys sheets by it.
        </span>
      </form>
      {#if sheetFeedback}<p class={sheetFeedback.ok ? 'msg-ok' : 'msg-error'}>{sheetFeedback.text}</p>{/if}
    </dd>
  {/if}
  <dt class="text-gray-600">Component</dt><dd>{data.component?.name ?? 'Ungrouped'}</dd>
  <dt class="text-gray-600">Reference designators</dt><dd>{line.referenceDesignators ?? '—'}</dd>
  {#if line.partId !== null}
    <dt class="text-gray-600">Exact part</dt>
    <dd><a href="/parts/{line.partId}" class="link">{line.partName}</a></dd>
  {:else}
    <dt class="text-gray-600">Category</dt><dd>{line.categoryName ?? '—'}</dd>
    <dt class="text-gray-600">Identifier</dt>
    <dd>{[line.manufacturer, line.partNumber].filter(Boolean).join(' ') || '—'}</dd>
  {/if}
  <dt class="text-gray-600">Constraints</dt>
  <dd>{line.constraints.map(describeConstraint).join('; ') || '—'}</dd>
  {#if line.notes}<dt class="text-gray-600">Notes</dt><dd>{line.notes}</dd>{/if}
</dl>

{#if data.missingRequired.length > 0}
  <p class="notice mb-4">
    This requirement does not specify {data.missingRequired.map((m) => m.label).join(', ')}, which
    {data.missingRequired.length === 1 ? 'is' : 'are'} required for its category. No part can match
    until you <a href="/projects/{data.project.id}/lines/{line.id}/edit" class="text-blue-700 underline">add
    {data.missingRequired.length === 1 ? 'it' : 'them'}</a>.
  </p>
{/if}

{#if feedback}<p class="mb-3 {feedback.ok ? 'msg-ok' : 'msg-error'}">{feedback.text}</p>{/if}

<section class="mb-6">
  <h2 class="section-title">Approved parts</h2>
  {#if line.choices.length === 0}
    <p class="text-sm text-gray-600">None yet. Approving a part does not reserve stock.</p>
  {:else}
    <ul class="space-y-1 text-sm">
      {#each line.choices as choice (choice.id)}
        <li class="flex flex-wrap items-center gap-2">
          <a href="/parts/{choice.partId}" class="link">{choice.partName}</a>
          {#if choice.substitute}<span class="rounded bg-amber-100 px-1 text-xs">substitute</span>{/if}
          {#if choice.note}<span class="text-gray-600">{choice.note}</span>{/if}
          <form method="POST" action="?/removeChoice" use:enhance>
            <input type="hidden" name="choice_id" value={choice.id} />
            <button class="link-danger">Remove</button>
          </form>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<section class="mb-6">
  <h2 class="section-title">Stock for this row</h2>
  <dl class="mb-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
    <dt class="text-gray-600">Required</dt><dd>{formatQuantity(coverage.required, coverage.unit)}</dd>
    <dt class="text-gray-600">Used</dt><dd>{formatQuantity(coverage.used, coverage.unit)}</dd>
    <dt class="text-gray-600">Picked</dt><dd>{formatQuantity(coverage.picked, coverage.unit)}</dd>
    <dt class="text-gray-600">Reserved</dt><dd>{formatQuantity(coverage.reserved, coverage.unit)}</dd>
    <dt class="text-gray-600">Remaining</dt><dd>{formatQuantity(coverage.uncovered, coverage.unit)}</dd>
    <dt class="text-gray-600">Ordered (committed)</dt><dd>{formatQuantity(coverage.ordered, coverage.unit)}</dd>
    <dt class="text-gray-600">Needed, not ordered</dt>
    <dd class={coverage.neededNotOrdered > 0 ? 'font-semibold text-amber-700' : ''}>
      {formatQuantity(coverage.neededNotOrdered, coverage.unit)}
    </dd>
    {#if coverage.excess > 0}
      <dt class="text-red-700">Excess</dt>
      <dd class="text-red-700">
        {formatQuantity(coverage.excess, coverage.unit)} more than required. Return or keep it; it is not deleted.
      </dd>
    {/if}
  </dl>
  {#if stockFeedback}<p class="mb-3 {stockFeedback.ok ? 'msg-ok' : 'msg-error'}">{stockFeedback.text}</p>{/if}

  {#if data.suggestion.cuts.length > 0 && coverage.uncovered > 0}
    {@const accept = acceptSuggestion.for(line.id)}
    <div class="card mb-3 text-sm">
      <h3 class="mb-1 font-semibold">Suggested pieces</h3>
      <p class="mb-1 text-gray-600">Offcuts and the shortest pieces that fit come first.</p>
      <ul class="mb-2 list-disc pl-5">
        {#each data.suggestion.cuts as cut, index (index)}
          <li>
            Cut {formatSize(cut.size, cut.piece.displayUnit)} from
            <a href="/pieces/{cut.piece.id}" class="link">piece #{cut.piece.id}</a>
            ({formatSize(cut.piece, cut.piece.displayUnit)}, {cut.piece.partName}) at {cut.piece.locationName}
          </li>
        {/each}
      </ul>
      {#if data.suggestion.unplaced > 0}
        <p class="mb-2 text-amber-700">No piece in storage fits {data.suggestion.unplaced} more cut piece(s).</p>
      {/if}
      <form {...accept} class="flex flex-wrap items-center gap-2">
        <input {...accept.fields.projectId.as('hidden', data.project.id)} />
        <input {...accept.fields.lineId.as('hidden', line.id)} />
        <input
          {...accept.fields.cuts.as(
            'hidden',
            JSON.stringify(data.suggestion.cuts.map((c) => ({ pieceId: c.piece.id, ...c.size })))
          )}
        />
        <button class="btn-secondary" disabled={accept.pending > 0}>Accept suggestion</button>
        {@render formResult(accept)}
      </form>
    </div>
  {/if}

  {#if data.stock.parts.length === 0}
    <p class="text-sm text-gray-600">Approve a part to reserve stock for this row.</p>
  {/if}
  {#each data.stock.parts as part (part.partId)}
    {@const allocation = allocationOf(part.partId)}
    <article class="card mb-3 text-sm">
      <h3 class="mb-2 font-semibold">
        <a href="/parts/{part.partId}" class="link">{part.partName}</a>
        {#if !part.allowed}<span class="rounded bg-red-100 px-1 text-xs text-red-800">no longer approved</span>{/if}
      </h3>
      {#if part.pieces}
        {@render pieceStock(part, allocation)}
      {:else if part.storage.length === 0}
        <p class="mb-2 text-gray-600">No stock in storage.</p>
      {:else}
        <table class="data-table stack-table mb-2">
          <thead>
            <tr>
              <th>Location</th>
              <th class="text-right">In storage</th>
              <th class="text-right">Reserved (all)</th>
              <th class="text-right">Available</th>
              <th class="text-right">For this row</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {#each part.storage as stock (stock.locationId)}
              {@const mine = reservedHere(part.partId, stock.locationId)}
              <tr>
                <td class="font-medium sm:font-normal">{stock.locationName}</td>
                <td data-label="In storage" class="text-right">{formatQuantity(stock.balance, part.baseUnit)}</td>
                <td data-label="Reserved (all)" class="text-right">{formatQuantity(stock.reserved, part.baseUnit)}</td>
                <td data-label="Available" class="text-right">{formatQuantity(stock.available, part.baseUnit)}</td>
                <td data-label="For this row" class="text-right">{formatQuantity(mine, part.baseUnit)}</td>
                <td class="space-y-1 pt-2 sm:pt-1.5">
                  {#if part.allowed && !part.archived && stock.available > 0 && coverage.uncovered > 0}
                    {@render amountForm('reserve', 'Reserve', part, stock.locationId)}
                  {/if}
                  {#if mine > 0}
                    {@render amountForm('pick', 'Pick', part, stock.locationId, mine)}
                    {@render amountForm('release', 'Release', part, stock.locationId, mine)}
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
      {#if !part.pieces && allocation && (allocation.picked > 0 || allocation.used > 0)}
        <p class="mb-1">
          Picked and held: {formatQuantity(allocation.picked, part.baseUnit)}. Used:
          {formatQuantity(allocation.used, part.baseUnit)}.
        </p>
      {/if}
      {#if !part.pieces && allocation && allocation.picked > 0}
        <div class="flex flex-wrap gap-3">
          <form method="POST" action="?/use" use:enhance class="flex flex-wrap items-end gap-1">
            {@render hiddenFields(part.partId)}
            {@render amountFields(part, allocation.picked)}
            <input name="reason" placeholder="Note (optional)" class="input-sm" />
            <button class="btn-secondary">Record use</button>
          </form>
          <form method="POST" action="?/return" use:enhance class="flex flex-wrap items-end gap-1">
            {@render hiddenFields(part.partId)}
            {@render amountFields(part, allocation.picked)}
            <select name="location_id" required class="input-sm">
              {#each data.storageLocations as location (location.id)}
                <option value={location.id}>{location.name}</option>
              {/each}
            </select>
            <label class="flex items-center gap-1"><input type="checkbox" name="reserve_again" /> Reserve again</label>
            <button class="btn-secondary">Return</button>
          </form>
        </div>
      {/if}
    </article>
  {/each}
</section>

<section class="mb-6">
  <h2 class="section-title mb-1">Incoming supply</h2>
  <p class="mb-2 text-sm text-gray-600">
    An order covers this row only after you commit part of it here. When the stock arrives, the
    committed quantity becomes a reservation. Cut pieces share an incoming stock piece while
    they and their kerf fit, and become piece reservations on the new pieces.
  </p>
  {#if incomingFeedback}<p class="mb-2 {incomingFeedback.ok ? 'msg-ok' : 'msg-error'}">{incomingFeedback.text}</p>{/if}
  {#if lineCommitments.length > 0}
    <table class="data-table stack-table mb-3">
      <thead>
        <tr><th>Order</th><th>Part</th><th>Expected</th><th class="text-right">Committed</th><th></th></tr>
      </thead>
      <tbody>
        {#each lineCommitments as commitment (commitment.id)}
          <tr>
            <td>
              <a href="/orders/{commitment.orderId}" class="link font-medium sm:font-normal">
                {commitment.supplier} {commitment.reference ?? ''}
              </a>
            </td>
            <td data-label="Part">{commitment.partName}</td>
            <td data-label="Expected">{commitment.expectedOn ?? '—'}</td>
            <td data-label="Committed" class="text-right">{formatQuantity(commitment.quantity, commitment.baseUnit)}</td>
            <td class="pt-2 sm:pt-1.5">
              <form method="POST" action="?/releaseIncoming" use:enhance class="flex items-end gap-1">
                <input type="hidden" name="commitment_id" value={commitment.id} />
                <input
                  name="quantity"
                  required
                  inputmode="numeric"
                  value={commitment.quantity}
                  aria-label="Quantity ({commitment.baseUnit})"
                  class="input-sm w-20"
                />
                <button class="btn-secondary">Release</button>
              </form>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
  {#if linePieceCommitments.length > 0}
    <table class="data-table stack-table mb-3">
      <thead>
        <tr><th>Order</th><th>Part</th><th>Expected</th><th>Incoming piece</th><th class="text-right">Cut piece</th><th></th></tr>
      </thead>
      <tbody>
        {#each linePieceCommitments as commitment (commitment.id)}
          <tr>
            <td>
              <a href="/orders/{commitment.orderId}" class="link font-medium sm:font-normal">
                {commitment.supplier} {commitment.reference ?? ''}
              </a>
            </td>
            <td data-label="Part">{commitment.partName}</td>
            <td data-label="Expected">{commitment.expectedOn ?? '—'}</td>
            <td data-label="Incoming piece">#{commitment.stickIndex + 1}</td>
            <td data-label="Cut piece" class="text-right">{formatSize(commitment, commitment.displayUnit)}</td>
            <td class="pt-2 sm:pt-1.5">
              <form method="POST" action="?/releaseIncomingPiece" use:enhance>
                <input type="hidden" name="commitment_id" value={commitment.id} />
                <button class="btn-secondary">Release</button>
              </form>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
  {#if data.incoming.length === 0}
    <p class="text-sm text-gray-600">No placed or shipped order has outstanding supply of an approved part.</p>
  {:else}
    <table class="data-table stack-table">
      <thead>
        <tr>
          <th>Order</th><th>Part</th><th>Expected</th>
          <th class="text-right">Outstanding</th><th class="text-right">Uncommitted</th><th></th>
        </tr>
      </thead>
      <tbody>
        {#each data.incoming as option (option.orderLineId)}
          <tr>
            <td>
              <a href="/orders/{option.orderId}" class="link font-medium sm:font-normal">
                {option.supplier} {option.reference ?? ''}
              </a>
              <span class="text-gray-500">{option.status}</span>
            </td>
            <td data-label="Part">
              {option.partName}
              {#if option.stockSize}
                <span class="text-gray-500">({formatSize(option.stockSize, line.pieceDisplayUnit)} each)</span>
              {/if}
            </td>
            <td data-label="Expected">{option.expectedOn ?? '—'}</td>
            <td data-label="Outstanding" class="text-right">{formatQuantity(option.outstanding, option.baseUnit)}</td>
            <td data-label="Uncommitted" class="text-right">
              {formatQuantity(option.uncommitted, option.baseUnit)}
              {#if option.stockSize}<div class="text-xs text-gray-500">cut pieces that fit</div>{/if}
            </td>
            <td class="pt-2 sm:pt-1.5">
              {#if option.uncommitted > 0 && coverage.neededNotOrdered > 0}
                <form method="POST" action="?/assignIncoming" use:enhance class="flex items-end gap-1">
                  <input type="hidden" name="order_line_id" value={option.orderLineId} />
                  <input
                    name="quantity"
                    required
                    inputmode="numeric"
                    aria-label="Quantity ({option.baseUnit})"
                    class="input-sm w-20"
                  />
                  <span class="text-gray-600">{option.baseUnit}</span>
                  <button class="btn-secondary">Commit</button>
                </form>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</section>

<section class="mb-6">
  <h2 class="section-title mb-1">Candidates</h2>
  <p class="mb-2 text-sm text-gray-600">
    Suggestions only. A part that is not a confirmed match can be approved only as a substitute with
    a note.
  </p>
  {#if data.candidates.length === 0}
    <p class="text-sm text-gray-600">
      No candidates. Add a category, an identifier, or constraints, or approve a substitute below.
    </p>
  {/if}
  {#each data.candidates as candidate (candidate.part.id)}
    <article class="card mb-3 text-sm">
      <div class="mb-1 flex flex-wrap items-center gap-2">
        <a href="/parts/{candidate.part.id}" class="link font-semibold">
          {candidate.part.name}
        </a>
        <span class="rounded px-1 text-xs {STATUS_STYLES[candidate.status]}">{STATUS_LABELS[candidate.status]}</span>
        <span class="text-gray-500">found by {candidate.sourceLabel}</span>
        {#if candidate.choice}
          <span class="rounded bg-blue-100 px-1 text-xs">
            approved{candidate.choice.substitute ? ' as substitute' : ''}
          </span>
        {/if}
      </div>
      {#if candidate.choice?.note}<p class="mb-1 text-gray-600">Approval note: {candidate.choice.note}</p>{/if}
      <ul class="mb-2 list-disc pl-5">
        {#each candidate.conflicts as reason (reason)}<li class="text-red-700">{reason}</li>{/each}
        {#each candidate.unresolved as reason (reason)}<li class="text-amber-700">{reason}</li>{/each}
        {#each candidate.evidence as reason (reason)}<li class="text-gray-700">{reason}</li>{/each}
      </ul>
      {#if !candidate.choice}
        <form method="POST" action="?/approve" use:enhance class="flex flex-wrap items-end gap-2">
          <input type="hidden" name="part_id" value={candidate.part.id} />
          {#if candidate.status === 'match'}
            <label class="flex items-center gap-1">
              <input type="checkbox" name="substitute" /> Substitute
            </label>
          {:else}
            <input type="hidden" name="substitute" value="on" />
          {/if}
          <textarea
            name="note"
            rows="2"
            placeholder={candidate.status === 'match' ? 'Note (optional)' : 'Why is this substitute acceptable?'}
            required={candidate.status !== 'match'}
            class="input mt-0 max-w-md grow"
          ></textarea>
          <button class="btn-secondary">
            {candidate.status === 'match' ? 'Approve' : 'Approve as substitute'}
          </button>
        </form>
      {/if}
    </article>
  {/each}
</section>

<form method="POST" action="?/approve" use:enhance class="card max-w-xl space-y-2 text-sm">
  <h2 class="font-semibold">Approve another part as a substitute</h2>
  <input type="hidden" name="substitute" value="on" />
  <PartPicker parts={data.parts} label="Search for a substitute part" />
  <textarea name="note" rows="2" required placeholder="Why is this substitute acceptable?" class="input"></textarea>
  <button class="btn-secondary">Approve substitute</button>
</form>
