<script lang="ts">
  import { KIND_LABELS } from '#lib/imports.ts';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  const QUICK_ACTIONS = [
    { href: '/parts/new', label: 'New part' },
    { href: '/orders/new', label: 'New order' },
    { href: '/imports', label: 'Import a list' },
    { href: '/shopping', label: 'Shopping list' },
  ];
</script>

<svelte:head>
  <title>Inventory</title>
</svelte:head>

<h1 class="page-title mb-4">Inventory</h1>

<nav aria-label="Quick actions" class="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
  {#each QUICK_ACTIONS as action (action.href)}
    <a href={action.href} class="btn-secondary min-h-11">{action.label}</a>
  {/each}
</nav>

<div class="grid gap-4 md:grid-cols-2">
  <section class="card">
    <div class="mb-2 flex items-center justify-between gap-2">
      <h2 class="font-semibold">Open projects</h2>
      <a href="/projects" class="link text-sm">All projects</a>
    </div>
    {#if data.openProjects.length === 0}
      <p class="hint">No planned, active, or paused projects. <a href="/projects" class="link">Start one</a>.</p>
    {:else}
      <ul class="divide-y divide-gray-100">
        {#each data.openProjects as project (project.id)}
          <li class="flex items-center gap-2 py-1.5">
            <a href="/projects/{project.id}" class="link grow">{project.name}</a>
            <span class="badge">{project.status}</span>
            <a href="/projects/{project.id}/pick" class="text-sm text-gray-600 hover:underline">Pick list</a>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section class="card">
    <div class="mb-2 flex items-center justify-between gap-2">
      <h2 class="font-semibold">Incoming orders</h2>
      <a href="/orders" class="link text-sm">All orders</a>
    </div>
    {#if data.incomingOrders.length === 0}
      <p class="hint">Nothing is outstanding on placed or shipped orders.</p>
    {:else}
      <ul class="divide-y divide-gray-100">
        {#each data.incomingOrders as order (order.id)}
          <li class="flex flex-wrap items-center gap-x-2 py-1.5">
            <a href="/orders/{order.id}" class="link grow">{order.supplier} {order.reference ?? ''}</a>
            <span class="text-sm text-gray-600">
              {order.status}{order.expectedOn ? `, expected ${order.expectedOn}` : ''}
            </span>
            <a href="/orders/{order.id}/receive" class="text-sm text-gray-600 hover:underline">Receive</a>
          </li>
        {/each}
      </ul>
    {/if}
    {#if data.draftOrders.length > 0}
      <p class="hint mt-2">
        {data.draftOrders.length} draft {data.draftOrders.length === 1 ? 'order is' : 'orders are'} not placed yet:
        {#each data.draftOrders as order, i (order.id)}{i > 0 ? ', ' : ''}<a href="/orders/{order.id}" class="link"
            >{order.supplier} {order.reference ?? ''}</a
          >{/each}.
      </p>
    {/if}
  </section>

  {#if data.pendingImports.length > 0}
    <section class="card md:col-span-2">
      <div class="mb-2 flex items-center justify-between gap-2">
        <h2 class="font-semibold">Imports to finish</h2>
        <a href="/imports" class="link text-sm">All imports</a>
      </div>
      <ul class="divide-y divide-gray-100">
        {#each data.pendingImports as item (item.id)}
          <li class="flex items-center gap-2 py-1.5">
            <a href="/imports/{item.id}" class="link min-w-0 grow truncate">{item.title || `Import ${item.id}`}</a>
            <span class="shrink-0 text-sm text-gray-600">{KIND_LABELS[item.kind]}, {item.lineCount} lines</span>
          </li>
        {/each}
      </ul>
    </section>
  {/if}
</div>
