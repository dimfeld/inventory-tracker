<script lang="ts">
  import { enhance } from '$app/forms';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
</script>

<svelte:head>
  <title>Locations</title>
</svelte:head>

<h1 class="mb-4 text-2xl font-semibold">Storage locations</h1>

{#if data.locations.length === 0}
  <p class="mb-4 text-gray-600">No locations yet.</p>
{:else}
  <table class="mb-6 w-full text-left">
    <thead class="border-b text-sm text-gray-600">
      <tr><th class="py-1">Name</th><th>Kind</th><th>Notes</th></tr>
    </thead>
    <tbody>
      {#each data.locations as location (location.id)}
        <tr class="border-b border-gray-100">
          <td class="py-1">{location.name}</td>
          <td>{location.kind}</td>
          <td class="text-gray-600">{location.notes ?? ''}</td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}

<form method="POST" action="?/create" use:enhance class="max-w-md space-y-3 rounded border p-4">
  <h2 class="font-semibold">Add location</h2>
  <label class="block">
    <span class="text-sm">Name</span>
    <input name="name" required class="input" />
  </label>
  <label class="block">
    <span class="text-sm">Notes</span>
    <input name="notes" class="input" />
  </label>
  {#if form && 'message' in form}<p class="text-red-700">{form.message}</p>{/if}
  {#if form && 'errors' in form}<p class="text-red-700">{Object.values(form.errors ?? {}).join('. ')}</p>{/if}
  {#if form && 'created' in form}<p class="text-green-700">Added {form.created}.</p>{/if}
  <button class="btn">Add location</button>
</form>
