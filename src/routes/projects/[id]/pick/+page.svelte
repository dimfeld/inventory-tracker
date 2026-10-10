<script lang="ts">
  import { enhance } from '$app/forms';
  import { formatLength, formatSize } from '#lib/pieces.ts';
  import { formatQuantity } from '#lib/units.ts';
  import { pickPieces } from '../pieces.remote';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  const base = $derived(`/projects/${data.project.id}`);
  const filters = $derived([
    { value: null, label: 'All' },
    ...data.components.map((c) => ({ value: String(c.id), label: c.name })),
    { value: 'ungrouped', label: 'Ungrouped' },
  ]);
  const activeFilter = $derived(data.filter === null ? null : String(data.filter));
  const componentNames = $derived(new Map(data.components.map((c) => [c.id, c.name])));
  const issuesOf = (f: { fields: { allIssues(): { message: string }[] | undefined } }) =>
    f.fields.allIssues()?.map((issue) => issue.message).join('. ');
  /** Number of leftover rows on the pick form of a 2D cut. */
  const LEFTOVER_ROWS = 2;

  const feedback = $derived.by(() => {
    if (form?.action !== 'pick') return null;
    if ('success' in form) return { ok: true, text: form.success };
    if ('message' in form) return { ok: false, text: form.message };
    if ('errors' in form) return { ok: false, text: Object.values(form.errors ?? {}).join('. ') };
    return null;
  });
</script>

<svelte:head>
  <title>Pick list · {data.project.name}</title>
</svelte:head>

<a href={base} class="back-link">← {data.project.name}</a>

<h1 class="page-title mb-2">Pick list</h1>
<p class="hint mb-3">
  Reserved stock to take from storage, by location. Picking moves it to the project's holding
  location. A component filter changes only this view; it does not release any reservation.
</p>

{#if data.components.length > 0}
  <nav aria-label="Component filter" class="-mx-4 mb-4 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
    {#each filters as filter (filter.value)}
      <a
        href={filter.value === null ? `${base}/pick` : `${base}/pick?component=${filter.value}`}
        aria-current={filter.value === activeFilter ? 'true' : undefined}
        class={filter.value === activeFilter ? 'pill-active' : 'pill'}
      >
        {filter.label}
      </a>
    {/each}
  </nav>
{/if}

{#if feedback}<p class="mb-3 {feedback.ok ? 'msg-ok' : 'msg-error'}">{feedback.text}</p>{/if}

{#snippet pickResult(form: ReturnType<typeof pickPieces.for>)}
  {#if issuesOf(form)}<p class="msg-error w-full">{issuesOf(form)}</p>{/if}
  {#if form.result}
    <p class="msg-ok w-full">{form.result.text}</p>
    {#each form.result.warnings as warning (warning)}<p class="notice w-full">{warning}</p>{/each}
  {/if}
{/snippet}

{#snippet pickHidden(form: ReturnType<typeof pickPieces.for>, reservationIds: number[], unit: string)}
  <input {...form.fields.projectId.as('hidden', data.project.id)} />
  <input {...form.fields.operationId.as('hidden', data.operationId)} />
  <input {...form.fields.occurredOn.as('hidden', data.today)} />
  <input {...form.fields.reservationIds.as('hidden', reservationIds.join(','))} />
  <input {...form.fields.unit.as('hidden', unit)} />
{/snippet}

{#each data.pieceStops as stop (stop.locationId)}
  <section class="card mb-4">
    <h2 class="mb-2 text-lg font-semibold">{stop.locationName} <span class="text-sm font-normal text-gray-600">pieces to cut</span></h2>
    <ul class="divide-y divide-gray-100 text-sm">
      {#each stop.pieces as piece (piece.pieceId)}
        {@const unit = piece.displayUnit}
        {@const allCuts = piece.cuts.every((cut) => cut.widthMm === null || cut.whole)}
        <li class="py-2">
          <div class="mb-1 flex flex-wrap items-center gap-2">
            <a href="/pieces/{piece.pieceId}" class="link font-semibold">Piece #{piece.pieceId}</a>
            <span>{formatSize(piece, unit)}</span>
            {#if piece.label}<span class="text-gray-600">{piece.label}</span>{/if}
            <a href="/parts/{piece.partId}" class="link">{piece.partName}</a>
            {#if piece.widthMm === null && piece.kerfMm > 0}
              <span class="text-gray-500">kerf {formatLength(piece.kerfMm, unit)} per cut</span>
            {/if}
            {#if piece.cuts.length > 1 && allCuts}
              {@const pickAll = pickPieces.for(`piece-${piece.pieceId}`)}
              <form {...pickAll} class="ml-auto">
                {@render pickHidden(pickAll, piece.cuts.map((cut) => cut.reservationId), unit)}
                <button class="btn-secondary" disabled={pickAll.pending > 0}>Pick all {piece.cuts.length}</button>
                {@render pickResult(pickAll)}
              </form>
            {/if}
          </div>
          <ul class="space-y-1 pl-4">
            {#each piece.cuts as cut (cut.reservationId)}
              {@const pick = pickPieces.for(`reservation-${cut.reservationId}`)}
              {@const measured = cut.widthMm !== null && !cut.whole}
              <li>
                <form {...pick} class="flex flex-wrap items-center gap-2">
                  <span class="font-semibold">
                    {cut.whole ? 'Whole piece' : `Cut ${formatSize(cut, unit)}`}
                  </span>
                  <span class="text-gray-600">
                    for <a href="{base}/lines/{cut.lineId}" class="hover:underline">{cut.lineDescription}</a>
                    {#if data.components.length > 0}
                      ({cut.componentId === null ? 'Ungrouped' : (componentNames.get(cut.componentId) ?? 'Ungrouped')})
                    {/if}
                  </span>
                  {@render pickHidden(pick, [cut.reservationId], unit)}
                  {#if measured}
                    <input {...pick.fields.measured.as('hidden', 'yes')} />
                    <span class="w-full text-gray-600">Leftover pieces to keep (length × width). Leave empty to keep none.</span>
                    {#each { length: LEFTOVER_ROWS } as _, index (index)}
                      {@const row = pick.fields.leftovers[index]}
                      <input {...row.length.as('text')} placeholder="Length" aria-label="Leftover {index + 1} length" class="input-sm w-24" />
                      ×
                      <input {...row.width.as('text')} placeholder="Width" aria-label="Leftover {index + 1} width" class="input-sm w-24" />
                    {/each}
                  {/if}
                  <button class="btn-secondary ml-auto" disabled={pick.pending > 0}>Pick</button>
                  {@render pickResult(pick)}
                </form>
              </li>
            {/each}
          </ul>
        </li>
      {/each}
    </ul>
  </section>
{/each}

{#each data.stops as stop (stop.locationId)}
  <section class="card mb-4">
    <h2 class="mb-2 text-lg font-semibold">{stop.locationName}</h2>
    <ul class="divide-y divide-gray-100 text-sm">
      {#each stop.items as item (item.reservationId)}
        <li class="flex flex-wrap items-center gap-2 py-2">
          <span class="font-semibold">{formatQuantity(item.quantity, item.baseUnit)}</span>
          <a href="/parts/{item.partId}" class="link">{item.partName}</a>
          <span class="text-gray-600">
            for <a href="{base}/lines/{item.lineId}" class="hover:underline">{item.lineDescription}</a>
            {#if data.components.length > 0}({item.componentName ?? 'Ungrouped'}){/if}
          </span>
          <form method="POST" action="?/pick" use:enhance class="ml-auto flex items-center gap-1">
            <input type="hidden" name="line_id" value={item.lineId} />
            <input type="hidden" name="part_id" value={item.partId} />
            <input type="hidden" name="location_id" value={stop.locationId} />
            <input type="hidden" name="unit" value={item.baseUnit} />
            <input type="hidden" name="operation_id" value={data.operationId} />
            <input type="hidden" name="occurred_on" value={data.today} />
            <input
              name="amount"
              required
              inputmode="decimal"
              value={item.quantity}
              aria-label="Quantity to pick"
              class="input-sm w-20"
            />
            <button class="btn-secondary">Pick</button>
          </form>
        </li>
      {/each}
    </ul>
  </section>
{/each}

{#if data.stops.length === 0 && data.pieceStops.length === 0}
  <p class="text-gray-600">Nothing reserved to pick.</p>
{/if}
