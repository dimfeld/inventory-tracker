<script lang="ts">
  import { MOVEMENT_LABELS } from '#lib/movements.ts';
  import { formatSize, type PieceDisplayUnit } from '#lib/pieces.ts';
  import PieceActionResult from '../PieceActionResult.svelte';
  import PieceActions, { type PieceActionKind } from '../PieceActions.svelte';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  const piece = $derived(data.piece);
  const part = $derived(data.part);
  const unit = $derived(part.pieceDisplayUnit);
  const other: Record<PieceDisplayUnit, PieceDisplayUnit> = { mm: 'in', in: 'mm' };
  const current = $derived(data.current);
  const canChange = $derived(current !== null && current.locationKind === 'storage' && !part.archivedAt);
  let action = $state<PieceActionKind | null>(null);

  function statusOf(p: { locationName: string | null; retiredBy: string | null }) {
    if (p.locationName !== null) return `in ${p.locationName}`;
    return p.retiredBy ? (MOVEMENT_LABELS[p.retiredBy] ?? p.retiredBy).toLowerCase() : 'retired';
  }
</script>

<svelte:head>
  <title>{formatSize(piece, unit)} — {part.name}</title>
</svelte:head>

<a href="/parts/{part.id}" class="back-link">← {part.name}</a>

<div class="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
  <h1 class="page-title"><span title={formatSize(piece, other[unit])}>{formatSize(piece, unit)}</span></h1>
  {#if piece.label}<span class="badge">{piece.label}</span>{/if}
  <span class="text-lg text-gray-600">{statusOf(piece)}</span>
</div>

<section class="card mb-6 max-w-2xl">
  <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
    <dt class="text-gray-600">Part</dt><dd><a href="/parts/{part.id}" class="link">{part.name}</a></dd>
    <dt class="text-gray-600">Status</dt>
    <dd>
      {#if piece.locationId !== null}
        In stock in <a href="/locations/{piece.locationId}" class="link">{piece.locationName}</a>
      {:else}
        Retired ({statusOf(piece)})
      {/if}
    </dd>
    <dt class="text-gray-600">Cut from</dt>
    <dd>
      {#if data.parent}
        <a href="/pieces/{data.parent.id}" class="link">{formatSize(data.parent, unit)}</a>
        <span class="text-gray-600">({statusOf(data.parent)})</span>
      {:else}
        —
      {/if}
    </dd>
    <dt class="text-gray-600">Made</dt><dd>{piece.createdAt.slice(0, 10)}</dd>
  </dl>
</section>

{#if canChange && current}
  <section class="mb-6">
    <div class="flex gap-1">
      <button type="button" class="btn-secondary" onclick={() => (action = 'cut')}>{piece.widthMm === null ? 'Cut' : 'Split'}</button>
      <button type="button" class="btn-secondary" onclick={() => (action = 'use')}>Use</button>
      <button type="button" class="btn-secondary" onclick={() => (action = 'scrap')}>Scrap</button>
    </div>
    {#if action}
      <PieceActions
        kind={action}
        piece={current}
        locations={data.locations}
        operationId={data.operationId}
        today={data.today}
        oncancel={() => (action = null)}
      />
    {/if}
  </section>
{/if}
<PieceActionResult />

{#snippet pieceList(title: string, pieces: typeof data.children)}
  <section class="mb-6">
    <h2 class="section-title">{title}</h2>
    <ul class="text-sm">
      {#each pieces as p (p.id)}
        <li>
          <a href="/pieces/{p.id}" class="link">{formatSize(p, unit)}</a>
          {#if p.label}<span class="badge">{p.label}</span>{/if}
          <span class="text-gray-600">— {statusOf(p)}</span>
        </li>
      {/each}
    </ul>
  </section>
{/snippet}

{#if data.children.length > 0}
  {@render pieceList('Cut into', data.children)}
{/if}
{#if data.siblings.length > 0}
  {@render pieceList('Other pieces from the same cut', data.siblings)}
{/if}

<section>
  <h2 class="section-title">Movement history</h2>
  {#if data.movements.length === 0}
    <p class="text-gray-600">No movements.</p>
  {:else}
    <table class="data-table stack-table max-w-3xl">
      <thead>
        <tr><th>Date</th><th>Type</th><th>From</th><th>To</th><th>Reason</th></tr>
      </thead>
      <tbody>
        {#each data.movements as movement (movement.id)}
          <tr>
            <td class="whitespace-nowrap text-gray-600">{movement.occurredOn}</td>
            <td class="font-medium sm:font-normal">{MOVEMENT_LABELS[movement.movementType] ?? movement.movementType}</td>
            <td data-label="From">{movement.fromLocationName ?? 'outside'}</td>
            <td data-label="To">{movement.toLocationName ?? 'outside'}</td>
            <td data-label="Reason" class="text-gray-600 {movement.reason ? '' : 'max-sm:hidden'}">{movement.reason ?? ''}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</section>
