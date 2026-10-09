<script lang="ts">
  import { formatPieceSize, formatPieceSizeInches } from '#lib/pieces.ts';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  const location = $derived(data.location);
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
    <table class="data-table stack-table max-w-3xl">
      <thead>
        <tr><th>Part</th><th>Size</th><th>Label</th></tr>
      </thead>
      <tbody>
        {#each data.pieces as piece (piece.id)}
          <tr>
            <td class="font-medium sm:font-normal"><a href="/parts/{piece.partId}" class="link">{piece.partName}</a></td>
            <td data-label="Size" class="whitespace-nowrap">
              <span title={formatPieceSizeInches(piece)}>{formatPieceSize(piece)}</span>
            </td>
            <td data-label="Label" class="text-gray-600 {piece.label ? '' : 'max-sm:hidden'}">{piece.label ?? ''}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</section>
