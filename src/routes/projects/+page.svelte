<script lang="ts">
  import { enhance } from '$app/forms';
  import { PROJECT_STATUSES } from '#lib/projects.ts';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
</script>

<svelte:head>
  <title>Projects</title>
</svelte:head>

<h1 class="page-title mb-4">Projects</h1>

<details class="card mb-6 max-w-md" open={data.projects.length === 0 || !!form}>
  <summary class="cursor-pointer font-semibold">New project</summary>
  <form method="POST" action="?/create" use:enhance class="mt-3 space-y-3">
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
    {#if form && 'message' in form}<p class="msg-error">{form.message}</p>{/if}
    {#if form && 'errors' in form}<p class="msg-error">{Object.values(form.errors ?? {}).join('. ')}</p>{/if}
    <button class="btn">Create project</button>
  </form>
</details>

{#if data.projects.length === 0}
  <p class="text-gray-600">No projects yet.</p>
{:else}
  <table class="data-table stack-table max-w-3xl">
    <thead>
      <tr><th>Name</th><th>Status</th><th class="text-right">BOM rows</th><th><span class="sr-only">Shortcuts</span></th></tr>
    </thead>
    <tbody>
      {#each data.projects as project (project.id)}
        <tr>
          <td><a href="/projects/{project.id}" class="link font-medium">{project.name}</a></td>
          <td data-label="Status"><span class="badge">{project.status}</span></td>
          <td data-label="BOM rows" class="text-right">{project.lineCount}</td>
          <td class="text-sm whitespace-nowrap sm:text-right">
            <a href="/projects/{project.id}/pick" class="link">Pick list</a>
            <a href="/shopping?select=1&project={project.id}" class="link ml-3">Shopping list</a>
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}
