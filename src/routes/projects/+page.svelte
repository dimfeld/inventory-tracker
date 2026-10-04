<script lang="ts">
  import { enhance } from '$app/forms';
  import { PROJECT_STATUSES } from '#lib/projects.ts';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
</script>

<svelte:head>
  <title>Projects</title>
</svelte:head>

<h1 class="mb-4 text-2xl font-semibold">Projects</h1>

{#if data.projects.length === 0}
  <p class="mb-4 text-gray-600">No projects yet.</p>
{:else}
  <table class="mb-6 w-full text-left">
    <thead class="border-b text-sm text-gray-600">
      <tr><th class="py-1">Name</th><th>Status</th><th>BOM lines</th></tr>
    </thead>
    <tbody>
      {#each data.projects as project (project.id)}
        <tr class="border-b border-gray-100">
          <td class="py-1"><a href="/projects/{project.id}" class="text-blue-700 hover:underline">{project.name}</a></td>
          <td>{project.status}</td>
          <td>{project.lineCount}</td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}

<form method="POST" action="?/create" use:enhance class="max-w-md space-y-3 rounded border p-4">
  <h2 class="font-semibold">New project</h2>
  <label class="block">
    <span class="text-sm">Name</span>
    <input name="name" required class="input" />
  </label>
  <label class="block">
    <span class="text-sm">Status</span>
    <select name="status" class="input">
      {#each PROJECT_STATUSES as status (status)}
        <option value={status}>{status}</option>
      {/each}
    </select>
  </label>
  <label class="block">
    <span class="text-sm">Links (one per line)</span>
    <textarea name="links" rows="2" class="input"></textarea>
  </label>
  <label class="block">
    <span class="text-sm">Notes</span>
    <textarea name="notes" rows="2" class="input"></textarea>
  </label>
  {#if form && 'message' in form}<p class="text-red-700">{form.message}</p>{/if}
  {#if form && 'errors' in form}<p class="text-red-700">{Object.values(form.errors ?? {}).join('. ')}</p>{/if}
  <button class="btn">Create project</button>
</form>
