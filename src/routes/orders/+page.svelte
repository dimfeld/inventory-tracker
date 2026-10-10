<script lang="ts">
  import MoneyTotals from '#lib/components/MoneyTotals.svelte';
  import { ORDER_DELIVERY_LABELS } from '#lib/orders.ts';
  import { matchesSearch } from '#lib/search.ts';
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

  // Find a delivered item by what it is, since order numbers are rarely known.
  let partQuery = $state('');
  const incoming = $derived(
    data.incoming.filter((part) =>
      matchesSearch(
        [part.partName, ...part.lines.flatMap((l) => [l.supplier, l.reference ?? ''])].join(' '),
        partQuery
      )
    )
  );
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

{#if data.incoming.length > 0}
  <section class="mb-8" aria-labelledby="incoming-title">
    <h2 id="incoming-title" class="section-title">Incoming parts</h2>
    <p class="hint mb-2">
      Find a delivered item to open its order or receive it. Outstanding quantities on placed and
      shipped orders; incoming supply is not physical stock.
    </p>
    <input
      type="search"
      bind:value={partQuery}
      placeholder="Filter by part, supplier, or reference"
      aria-label="Filter incoming parts"
      class="input mb-3 max-w-md"
    />
    <ul class="space-y-2">
      {#each incoming as part (part.partId)}
        <li class="card p-3 sm:p-3">
          <div class="flex flex-wrap items-baseline gap-x-3">
            <a href="/parts/{part.partId}" class="link font-medium">{part.partName}</a>
            <span class="text-sm text-gray-600">
              {[
                part.shipped > 0 ? `${formatQuantity(part.shipped, part.baseUnit)} shipped` : null,
                part.placed > 0 ? `${formatQuantity(part.placed, part.baseUnit)} placed` : null,
              ]
                .filter(Boolean)
                .join(', ')}
            </span>
          </div>
          <ul class="mt-1 divide-y divide-gray-100 text-sm">
            {#each part.lines as line (line.orderLineId)}
              <li class="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
                <a href="/orders/{line.orderId}" class="link">{line.supplier} {line.reference ?? `#${line.orderId}`}</a>
                <span class="badge">{line.status}</span>
                <span class="text-gray-600">
                  {formatQuantity(line.outstanding, part.baseUnit)}{line.expectedOn
                    ? `, expected ${line.expectedOn}`
                    : ''}
                </span>
                <a href="/orders/{line.orderId}/receive#receive-line-{line.orderLineId}" class="btn-secondary ml-auto">
                  Receive
                </a>
              </li>
            {/each}
          </ul>
        </li>
      {:else}
        <li class="hint">No incoming part matches “{partQuery}”.</li>
      {/each}
    </ul>
  </section>
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
