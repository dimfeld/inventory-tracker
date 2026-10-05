<script lang="ts">
  import { formatMoney, type MoneyTotals } from '#lib/money.ts';

  /**
   * Per-currency totals. Currencies are never added together, and lines with an unknown cost
   * are counted instead of being treated as zero.
   */
  let { costs, unknownLabel = 'unknown cost' }: { costs: MoneyTotals; unknownLabel?: string } =
    $props();
</script>

{#if costs.totals.length === 0 && costs.unknownCount === 0}
  <span class="text-gray-500">—</span>
{:else}
  <span>
    {#each costs.totals as total, i (total.currency)}{i > 0 ? ' · ' : ''}<span class="font-medium whitespace-nowrap"
        >{formatMoney(total)}</span
      >{/each}
    {#if costs.unknownCount > 0}
      <span class="text-amber-700">
        {costs.totals.length > 0 ? 'incomplete: ' : ''}{costs.unknownCount}
        line{costs.unknownCount === 1 ? '' : 's'} with {unknownLabel}
      </span>
    {/if}
  </span>
{/if}
