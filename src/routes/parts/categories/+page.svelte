<script lang="ts">
  import { enhance } from '$app/forms';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
</script>

<svelte:head>
  <title>Categories</title>
</svelte:head>

<h1 class="page-title mb-4">Categories</h1>

{#if data.categories.length === 0}
  <p class="mb-4 text-gray-600">No categories yet.</p>
{:else}
  <ul class="card mb-6 max-w-md divide-y divide-gray-100 py-1 text-sm">
    {#each data.categories as category (category.id)}
      <li class="py-1.5">
        <a href="/parts?category={category.id}" class="link">{category.path}</a>
      </li>
    {/each}
  </ul>
{/if}

<form method="POST" action="?/create" use:enhance class="card max-w-md space-y-3">
  <h2 class="font-semibold">Add category</h2>
  <label class="block">
    <span class="text-sm">Name</span>
    <input name="name" required class="input" />
  </label>
  <label class="block">
    <span class="text-sm">Parent</span>
    <select name="parent_id" class="input">
      <option value="">(top level)</option>
      {#each data.categories as category (category.id)}
        <option value={category.id}>{category.path}</option>
      {/each}
    </select>
  </label>
  {#if form && 'message' in form}<p class="msg-error">{form.message}</p>{/if}
  {#if form && 'errors' in form}<p class="msg-error">{Object.values(form.errors ?? {}).join('. ')}</p>{/if}
  {#if form && 'created' in form}<p class="msg-ok">Added {form.created}.</p>{/if}
  <button class="btn">Add category</button>
</form>
