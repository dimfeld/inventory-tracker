<script lang="ts">
  import MoneyTotals from '#lib/components/MoneyTotals.svelte';
  import { ORDER_DELIVERY_LABELS } from '#lib/orders.ts';
  import { formatQuantity } from '#lib/units.ts';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  type OrderRow = (typeof data.orders)[number];
  const isComplete = (o: OrderRow) => o.status !== 'draft' && o.lineCount > 0 && o.openLineCount === 0;
  const groups = $derived([
    { title: 'Shipped', orders: data.orders.filter((o) => o.status === 'shipped' && !isComplete(o)) },
    { title: 'Placed', orders: data.orders.filter((o) => o.status === 'placed' && !isComplete(o)) },
    { title: 'Draft (not incoming)', orders: data.orders.filter((o) => o.status === 'draft') },
    { title: 'Nothing outstanding', orders: data.orders.filter(isComplete) },
  ]);
</script>

<svelte:head>
  <title>Orders</title>
</svelte:head>

<div class="mb-4 flex items-center gap-3">
  <h1 class="page-title">Orders</h1>
  <a href="/orders/new" class="btn ml-auto">New order</a>
</div>

{#if data.orders.length === 0}
  <p class="mb-4 text-gray-600">No orders yet.</p>
{/if}

{#if data.orders.length > 0}
  <p class="mb-2 text-sm text-gray-600">Actual costs are goods only; they exclude shipping and tax.</p>
{/if}

{#each groups as group (group.title)}
  {#if group.orders.length > 0}
    <section class="mb-6">
      <h2 class="section-title">{group.title}</h2>
      <table class="data-table stack-table">
        <thead>
          <tr>
            <th>Supplier</th>
            <th>Reference</th>
            <th>Placed</th>
            <th>Expected</th>
            <th>Delivery</th>
            <th class="text-right">Outstanding lines</th>
            <th class="text-right">Actual cost</th>
          </tr>
        </thead>
        <tbody>
          {#each group.orders as order (order.id)}
            <tr>
              <td>
                <a href="/orders/{order.id}" class="link font-medium sm:font-normal">{order.supplier}</a>
                {#if order.status !== 'draft' && order.openLineCount > 0}
                  <a href="/orders/{order.id}/receive" class="ml-2 text-xs text-gray-600 hover:underline">Receive</a>
                {/if}
              </td>
              <td data-label="Reference">{order.reference ?? '—'}</td>
              <td data-label="Placed">{order.placedOn ?? '—'}</td>
              <td data-label="Expected">{order.expectedOn ?? '—'}</td>
              <td data-label="Delivery">{ORDER_DELIVERY_LABELS[order.delivery]}</td>
              <td data-label="Outstanding" class="text-right">{order.openLineCount} of {order.lineCount}</td>
              <td data-label="Actual cost" class="text-right"><MoneyTotals costs={order.costs} unknownLabel="no price" /></td>
            </tr>
          {/each}
        </tbody>
      </table>
    </section>
  {/if}
{/each}

<section>
  <h2 class="section-title">Incoming supply by part</h2>
  {#if data.incoming.length === 0}
    <p class="text-sm text-gray-600">Nothing is outstanding on placed or shipped orders.</p>
  {:else}
    <p class="mb-2 text-sm text-gray-600">Outstanding quantities. Incoming supply is not physical stock.</p>
    <table class="data-table stack-table max-w-2xl">
      <thead>
        <tr><th>Part</th><th class="text-right">Placed</th><th class="text-right">Shipped</th></tr>
      </thead>
      <tbody>
        {#each data.incoming as part (part.partId)}
          <tr>
            <td><a href="/parts/{part.partId}" class="link font-medium sm:font-normal">{part.partName}</a></td>
            <td data-label="Placed" class="text-right">{formatQuantity(part.placed, part.baseUnit)}</td>
            <td data-label="Shipped" class="text-right">{formatQuantity(part.shipped, part.baseUnit)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</section>
