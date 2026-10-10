<script lang="ts">
  import { formatSize } from '#lib/pieces.ts';
  import PieceActionResult from '../../pieces/PieceActionResult.svelte';
  import PieceActions, { type PieceActionKind } from '../../pieces/PieceActions.svelte';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  const location = $derived(data.location);

  // The piece that the cut, scrap, or use form changes.
  let pieceAction = $state<{ kind: PieceActionKind; pieceId: number } | null>(null);
  const actionPiece = $derived(data.pieces.find((p) => p.id === pieceAction?.pieceId));
</script>

<svelte:head>
  <title>{location.name}</title>
</svelte:head>

<a href="/settings/locations" class="back-link">← Locations</a>
<h1 class="page-title mb-2">{location.name}</h1>
{#if location.notes}<p class="mb-4 whitespace-pre-line text-gray-600">{location.notes}</p>{/if}

<section class="mb-6">
  <h2 class="section-title">Pieces</h2>
  {#if data.pieces.length === 0}
    <p class="text-gray-600">No pieces of piece-tracked parts here.</p>
  {:else}
    <table class="data-table stack-table max-w-4xl">
      <thead>
        <tr><th>Part</th><th>Size</th><th>Label</th><th></th></tr>
      </thead>
      <tbody>
        {#each data.pieces as piece (piece.id)}
          <tr class={pieceAction?.pieceId === piece.id ? 'bg-blue-50' : ''}>
            <td class="font-medium sm:font-normal"><a href="/parts/{piece.partId}" class="link">{piece.partName}</a></td>
            <td data-label="Size" class="whitespace-nowrap">
              <a href="/pieces/{piece.id}" class="link" title={formatSize(piece, piece.displayUnit === 'mm' ? 'in' : 'mm')}>
                {formatSize(piece, piece.displayUnit)}
              </a>
            </td>
            <td data-label="Label" class="text-gray-600 {piece.label ? '' : 'max-sm:hidden'}">{piece.label ?? ''}</td>
            <td class="whitespace-nowrap sm:text-right">
              {#if piece.locationKind === 'storage'}
                <div class="mt-1 flex gap-1 sm:mt-0 sm:justify-end">
                  <button type="button" class="btn-secondary" onclick={() => (pieceAction = { kind: 'cut', pieceId: piece.id })}>
                    {piece.widthMm === null ? 'Cut' : 'Split'}
                  </button>
                  <button type="button" class="btn-secondary" onclick={() => (pieceAction = { kind: 'use', pieceId: piece.id })}>Use</button>
                  <button type="button" class="btn-secondary" onclick={() => (pieceAction = { kind: 'scrap', pieceId: piece.id })}>Scrap</button>
                </div>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}

  <PieceActionResult />
  {#if pieceAction && actionPiece}
    <PieceActions
      kind={pieceAction.kind}
      piece={actionPiece}
      locations={data.locations}
      operationId={data.operationId}
      today={data.today}
      oncancel={() => (pieceAction = null)}
    />
  {/if}
</section>
