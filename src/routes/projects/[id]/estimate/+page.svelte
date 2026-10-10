<script lang="ts">
  import MoneyTotals from '#lib/components/MoneyTotals.svelte';
  import { formatMoney } from '#lib/money.ts';
  import { formatQuantity } from '#lib/units.ts';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  const base = $derived(`/projects/${data.project.id}`);
</script>

<svelte:head>
  <title>Cost estimate · {data.project.name}</title>
</svelte:head>

<a href={base} class="back-link">← {data.project.name}</a>

<h1 class="page-title mb-2">Cost estimate</h1>
<p class="mb-3 max-w-3xl text-sm text-gray-600">
  An estimate, not an actual purchase cost. Each row uses the most recent priced purchase of its
  part on a placed or shipped order, for the row's whole quantity. Prices exclude shipping and tax.
  Currencies are not converted or added together. Rows without an estimate are counted, not
  treated as zero. Amounts marked ≈ are rounded.
</p>

<section class="mb-6">
  <h2 class="section-title mb-1">Project estimate</h2>
  <p class="text-sm"><MoneyTotals costs={data.totals} unknownLabel="no estimate" /></p>
</section>

{#each data.groups as group (group.component?.id ?? 'ungrouped')}
  <section class="mb-6">
    <h3 class="mb-1 text-lg font-semibold">{group.component?.name ?? 'Ungrouped'}</h3>
    {#if group.rows.length === 0}
      <p class="text-sm text-gray-600">No rows.</p>
    {:else}
      <table class="data-table stack-table mb-2">
        <thead>
          <tr>
            <th>Description</th>
            <th>Quantity</th>
            <th>Basis</th>
            <th class="text-right">Estimate</th>
          </tr>
        </thead>
        <tbody>
          {#each group.rows as row (row.line.id)}
            <tr>
              <td>
                <a href="{base}/lines/{row.line.id}" class="link font-medium sm:font-normal">{row.line.description}</a>
              </td>
              <td data-label="Quantity" class="whitespace-nowrap">{formatQuantity(row.line.quantity, row.line.unit)}</td>
              <td data-label="Basis"><div>
                {#if row.source}
                  {@const source = row.source}
                  <div>
                    <a href="/parts/{source.partId}" class="link">{source.partName}</a>
                    from {source.supplier},
                    <a href="/orders/{source.orderId}" class="link">
                      order {source.reference ?? `#${source.orderId}`}</a
                    >{source.placedOn ? ` placed ${source.placedOn}` : ''}
                  </div>
                  <div class="text-gray-600">
                    {source.unitPrice} {source.currency} per {source.purchaseUnit} of
                    {formatQuantity(source.packQuantity, source.baseUnit)} → {formatMoney(source.baseUnitPrice)}
                    per {row.stockPieces === null ? source.baseUnit : 'stock piece'}
                  </div>
                  {#if row.stockPieces !== null}
                    <div class="text-gray-600">
                      Share of {row.stockPieces} stock {row.stockPieces === 1 ? 'piece' : 'pieces'}, by cut
                      length plus kerf
                    </div>
                  {/if}
                {:else}
                  <span class="text-amber-700">{row.unknownReason}</span>
                {/if}
              </div></td>
              <td data-label="Estimate" class="text-right whitespace-nowrap">
                {#if row.estimate}{formatMoney(row.estimate)}{:else}<span class="text-amber-700">Unknown</span>{/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
    <p class="text-sm">
      <span class="text-gray-600">{group.component?.name ?? 'Ungrouped'} estimate:</span>
      <MoneyTotals costs={group.totals} unknownLabel="no estimate" />
    </p>
  </section>
{/each}
