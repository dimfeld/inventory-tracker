<script lang="ts">
  import { enhance } from '$app/forms';
  import OrderFields from '#lib/components/OrderFields.svelte';
  import type { PageProps } from './$types';

  let { form }: PageProps = $props();
</script>

<svelte:head>
  <title>New order</title>
</svelte:head>

<p class="mb-2 text-sm"><a href="/orders" class="text-blue-700 hover:underline">← Orders</a></p>
<h1 class="mb-4 text-2xl font-semibold">New order</h1>

<form method="POST" use:enhance class="max-w-md space-y-3">
  <OrderFields />
  {#if form && 'message' in form}<p class="text-red-700">{form.message}</p>{/if}
  {#if form && 'errors' in form}<p class="text-red-700">{Object.values(form.errors ?? {}).join('. ')}</p>{/if}
  <p class="text-sm text-gray-600">The order starts as a draft. Add its lines on the next page.</p>
  <button class="btn">Create draft order</button>
</form>
