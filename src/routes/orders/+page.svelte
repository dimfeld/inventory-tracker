<script lang="ts">
  import MoneyTotals from '#lib/components/MoneyTotals.svelte';
  import { DELIVERY_LABELS } from '#lib/orders.ts';
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
  <h1 class="text-2xl font-semibold">Orders</h1>
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
      <h2 class="mb-2 font-semibold">{group.title}</h2>
      <table class="w-full text-left text-sm">
        <thead class="border-b text-gray-600">
          <tr>
            <th class="py-1">Supplier</th>
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
            <tr class="border-b border-gray-100">
              <td class="py-1"><a href="/orders/{order.id}" class="text-blue-700 hover:underline">{order.supplier}</a></td>
              <td>{order.reference ?? '—'}</td>
              <td>{order.placedOn ?? '—'}</td>
              <td>{order.expectedOn ?? '—'}</td>
              <td>{DELIVERY_LABELS[order.deliveryState]}</td>
              <td class="text-right">{order.openLineCount} of {order.lineCount}</td>
              <td class="text-right"><MoneyTotals costs={order.costs} unknownLabel="no price" /></td>
            </tr>
          {/each}
        </tbody>
      </table>
    </section>
  {/if}
{/each}

<section>
  <h2 class="mb-2 font-semibold">Incoming supply</h2>
  {#if data.incoming.length === 0}
    <p class="text-sm text-gray-600">Nothing is outstanding on placed or shipped orders.</p>
  {:else}
    <p class="mb-2 text-sm text-gray-600">Outstanding quantities. Incoming supply is not physical stock.</p>
    <table class="w-full text-left text-sm">
      <thead class="border-b text-gray-600">
        <tr><th class="py-1">Part</th><th class="text-right">Placed</th><th class="text-right">Shipped</th></tr>
      </thead>
      <tbody>
        {#each data.incoming as part (part.partId)}
          <tr class="border-b border-gray-100">
            <td class="py-1"><a href="/parts/{part.partId}" class="text-blue-700 hover:underline">{part.partName}</a></td>
            <td class="text-right">{formatQuantity(part.placed, part.baseUnit)}</td>
            <td class="text-right">{formatQuantity(part.shipped, part.baseUnit)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</section>
