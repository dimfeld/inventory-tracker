<script lang="ts">
  import { enhance } from '$app/forms';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
</script>

<svelte:head>
  <title>Locations</title>
</svelte:head>

<h2 class="section-title mb-2">Storage locations</h2>

{#if data.locations.length === 0}
  <p class="mb-4 text-gray-600">No locations yet.</p>
{:else}
  <table class="data-table stack-table mb-6 max-w-3xl">
    <thead>
      <tr><th>Name</th><th>Kind</th><th>Notes</th></tr>
    </thead>
    <tbody>
      {#each data.locations as location (location.id)}
        <tr>
          <td class="font-medium sm:font-normal">{location.name}</td>
          <td data-label="Kind">{location.kind}</td>
          <td data-label="Notes" class="text-gray-600 {location.notes ? '' : 'max-sm:hidden'}">{location.notes ?? ''}</td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}

<form method="POST" action="?/create" use:enhance class="card max-w-md space-y-3">
  <h2 class="font-semibold">Add location</h2>
  <label class="block">
    <span class="text-sm">Name</span>
    <input name="name" required class="input" />
  </label>
  <label class="block">
    <span class="text-sm">Notes</span>
    <textarea name="notes" rows="2" class="input"></textarea>
  </label>
  {#if form && 'message' in form}<p class="msg-error">{form.message}</p>{/if}
  {#if form && 'errors' in form}<p class="msg-error">{Object.values(form.errors ?? {}).join('. ')}</p>{/if}
  {#if form && 'created' in form}<p class="msg-ok">Added {form.created}.</p>{/if}
  <button class="btn">Add location</button>
</form>
