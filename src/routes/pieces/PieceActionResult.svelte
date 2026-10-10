<script lang="ts">
  import { cutPiece, retirePiece, splitPiece } from './cut.remote';

  // The forms stay mounted here, so the result shows after the piece leaves the list.
  const results = $derived([cutPiece.result, splitPiece.result, retirePiece.result].filter((r) => r !== undefined));
</script>

{#each results as result, index (index)}
  <p class="msg-ok mt-3">{result.text}</p>
  {#each result.warnings as warning (warning)}
    <p class="mt-1 text-amber-700">Warning: {warning}</p>
  {/each}
{/each}
