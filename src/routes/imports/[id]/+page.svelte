<script lang="ts">
  import { enhance } from '$app/forms';
  import { attributeUnitsHint } from '#lib/attributes.ts';
  import { COLUMN_ROLE_LABELS, COLUMN_ROLES, KIND_LABELS, PROVENANCE_LABELS } from '#lib/imports.ts';
  import ImportLineForm from './ImportLineForm.svelte';
  import ParseForm from './ParseForm.svelte';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  const record = $derived(data.record);
  // A parse request from this page is in flight; distinct from a stored 'parsing' state.
  let parsing = $state(false);
  const committed = $derived(record.commitState === 'committed');
  const csv = $derived(data.source.csv);
  const blocking = $derived([
    ...data.headerProblems,
    ...data.lines.flatMap((line, index) => line.problems.map((p) => `Line ${index + 1}: ${p}`)),
  ]);

  function feedback(action: string) {
    if (form?.action !== action) return null;
    if ('success' in form && form.success) return { ok: true, text: form.success };
    if ('message' in form && form.message) return { ok: false, text: form.message };
    if ('errors' in form && form.errors) return { ok: false, text: Object.values(form.errors).join('. ') };
    return null;
  }

  function headerMark(field: string) {
    const provenance = record.headerProvenance?.[field];
    return provenance ? PROVENANCE_LABELS[provenance] : null;
  }

  const STATE_TEXT = {
    draft: 'Not parsed yet.',
    parsing: 'Parsing started but did not finish. You can parse again.',
    parsed: 'Parsed.',
    failed: 'Parsing failed. The source is unchanged; edit it, parse again, or enter lines by hand.',
  } as const;
</script>

<svelte:head>
  <title>{KIND_LABELS[record.kind]} import</title>
</svelte:head>

{#snippet message(action: string)}
  {@const fb = feedback(action)}
  {#if fb}<p class={fb.ok ? 'text-green-700' : 'text-red-700'}>{fb.text}</p>{/if}
{/snippet}

<p class="mb-2 text-sm"><a href="/imports" class="text-blue-700 hover:underline">← Imports</a></p>
<h1 class="mb-1 text-2xl font-semibold">{KIND_LABELS[record.kind]} import</h1>
<p class="mb-4 text-sm text-gray-600">
  Parsing sends the submitted source text to OpenAI (model gpt-6-luna). Line cleanup sends that line and the catalog
  part list. Saving drafts, entering lines by hand, mapping
  CSV columns, and committing stay on this server.
</p>

{#if committed}
  <p class="mb-4 rounded border border-green-300 bg-green-50 p-2">
    Committed on {record.committedAt}.
    {#if record.orderId}<a href="/orders/{record.orderId}" class="text-blue-700 hover:underline">View the order</a> — it is
      a draft; nothing was received or added to stock.{/if}
    {#if record.projectId}<a href="/projects/{record.projectId}" class="text-blue-700 hover:underline">View the project</a>.{/if}
    {#if record.kind === 'order' && !record.orderId}No lines were kept, so no order was created. A later import of this
      order is skipped.{/if}
  </p>
{/if}

{#if data.sameSource.length > 0 || data.sameReference.length > 0}
  <div class="mb-4 rounded border border-amber-300 bg-amber-50 p-2 text-sm">
    {#if data.sameSource.length > 0}
      <p>
        The same source was imported before:
        {#each data.sameSource as other, i (other.id)}{i > 0 ? ', ' : ''}<a href="/imports/{other.id}" class="text-blue-700 hover:underline">import {other.id}</a> ({other.commitState}){/each}.
      </p>
    {/if}
    {#if data.sameReference.length > 0}
      <p>
        Orders with this supplier reference already exist:
        {#each data.sameReference as order, i (order.id)}{i > 0 ? ', ' : ''}<a href="/orders/{order.id}" class="text-blue-700 hover:underline">order {order.id}</a>{/each}.
      </p>
    {/if}
    <p>A repeated purchase is allowed; check that this is not a duplicate before you commit.</p>
  </div>
{/if}

<section class="mb-6">
  <h2 class="mb-2 font-semibold">Source</h2>
  {#if csv}
    <form method="POST" action="?/columns" use:enhance class="mb-2 overflow-x-auto">
      <label class="mb-1 block text-sm">
        <input type="checkbox" name="has_header" checked={csv.settings.hasHeader} disabled={committed} /> First row is a header
      </label>
      <table class="text-left text-sm">
        <thead>
          <tr>
            <th class="pr-2 text-gray-500">Row</th>
            {#each csv.columns as column, i (i)}
              <th class="pr-2">
                <div>{column}</div>
                <select name="role" value={csv.settings.roles[i] ?? 'ignore'} disabled={committed} class="input text-xs">
                  {#each COLUMN_ROLES as role (role)}<option value={role}>{COLUMN_ROLE_LABELS[role]}</option>{/each}
                </select>
              </th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each csv.dataRows as row (row.row)}
            <tr class="border-b border-gray-100">
              <td class="pr-2 text-gray-500">{row.row}</td>
              {#each csv.columns as _, i (i)}<td class="pr-2">{row.cells[i] ?? ''}</td>{/each}
            </tr>
          {/each}
        </tbody>
      </table>
      {#if !committed}
        <div class="mt-2 flex gap-2">
          <button class="btn-secondary">Save columns</button>
          <button formaction="?/mapColumns" class="btn-secondary">Create lines from columns (no model)</button>
        </div>
      {/if}
      {@render message('columns')}
    </form>
  {:else}
    <ol class="mb-2 rounded bg-gray-50 p-2 font-mono text-sm">
      {#each data.source.rows as row (row.row)}
        <li><span class="mr-2 text-gray-500">{row.row}</span>{row.cells[0]}</li>
      {/each}
    </ol>
  {/if}

  {#if !committed}
    <details class="mb-2">
      <summary class="cursor-pointer text-sm text-blue-700">Edit the source</summary>
      <form method="POST" action="?/source" use:enhance class="space-y-2">
        <textarea name="source_text" rows="8" class="input font-mono text-sm">{record.sourceText}</textarea>
        <button class="btn-secondary">Save source</button>
      </form>
    </details>
    {@render message('source')}

    <ParseForm parsed={record.parseState !== 'draft'} parsingAvailable={data.parsingAvailable} hasCsv={!!csv} bind:pending={parsing} />
  {/if}
  {#if !parsing}<p class="mt-1 text-sm">{STATE_TEXT[record.parseState]}</p>{/if}
  {#if record.parseError}<p class="text-sm text-red-700">{record.parseError}</p>{/if}
  {@render message('parse')}
  {#if record.parsedAt}
    <p class="text-xs text-gray-500">
      {record.modelId ? `Model ${record.modelId}, prompt v${record.promptVersion}, schema v${record.schemaVersion}` : 'From CSV columns'}
      {#if record.totalTokens !== null}· {record.inputTokens} input + {record.outputTokens} output tokens{/if}
      · {record.parsedAt}
    </p>
  {/if}
</section>

<section class="mb-6 max-w-2xl">
  <h2 class="mb-2 font-semibold">{record.kind === 'order' ? 'Order' : 'Project'}</h2>
  <form method="POST" action="?/header" use:enhance>
    <fieldset disabled={committed} class="grid gap-2 sm:grid-cols-2">
      {#if record.kind === 'order'}
        <label class="block">
          <span class="text-sm">Supplier {#if headerMark('supplier')}<span class="text-xs text-gray-500">({headerMark('supplier')})</span>{/if}</span>
          <input name="supplier" value={record.header.supplier ?? ''} class="input" />
        </label>
        <label class="block">
          <span class="text-sm">Supplier order reference {#if headerMark('reference')}<span class="text-xs text-gray-500">({headerMark('reference')})</span>{/if}</span>
          <input name="reference" value={record.header.reference ?? ''} class="input" />
        </label>
        <label class="block">
          <span class="text-sm">Order date {#if headerMark('placedOn')}<span class="text-xs text-gray-500">({headerMark('placedOn')})</span>{/if}</span>
          <input type="date" name="placed_on" value={record.header.placedOn ?? ''} class="input" />
          <span class="text-xs text-gray-600">With a date, the commit marks the order placed on that date.</span>
        </label>
      {:else}
        <label class="block">
          <span class="text-sm">Add to project</span>
          <select name="project_id" value={record.header.projectId === null ? '' : String(record.header.projectId)} class="input">
            <option value="">A new project</option>
            {#each data.options.projects as project (project.id)}<option value={String(project.id)}>{project.name}</option>{/each}
          </select>
        </label>
        <label class="block">
          <span class="text-sm">New project name {#if headerMark('projectName')}<span class="text-xs text-gray-500">({headerMark('projectName')})</span>{/if}</span>
          <input name="project_name" value={record.header.projectName ?? ''} class="input" />
        </label>
      {/if}
      <label class="block sm:col-span-2">
        <span class="text-sm">Notes</span>
        <textarea name="notes" rows="2" class="input">{record.header.notes ?? ''}</textarea>
      </label>
      {#if !committed}<div><button class="btn-secondary">Save</button></div>{/if}
    </fieldset>
  </form>
  {@render message('header')}
</section>

{#if record.kind === 'project'}
  <section class="mb-6 max-w-2xl">
    <h2 class="mb-1 font-semibold">Component groups</h2>
    <p class="mb-2 text-sm text-gray-600">
      Groups organize BOM rows; they do not make a row optional. Only explicit source headings or component columns
      are proposed. Groups without lines are not committed.
    </p>
    {#if data.groups.length === 0}<p class="text-sm text-gray-600">No groups. The BOM is flat.</p>{/if}
    <ul class="space-y-1">
      {#each data.groups as group (group.id)}
        <li>
          <form method="POST" action="?/renameGroup" use:enhance class="flex flex-wrap items-center gap-2">
            <input type="hidden" name="group_id" value={group.id} />
            <input name="name" value={group.name} disabled={committed} class="input w-56" />
            <span class="text-sm text-gray-500">
              {group.sourceExcerpt !== null ? `source row ${group.sourceRow}: "${group.sourceExcerpt}"` : 'added in review'}
              · {data.lines.filter((l) => l.groupId === group.id).length} line(s)
            </span>
            {#if !committed}
              <button class="btn-secondary">Rename</button>
              <button formaction="?/removeGroup" class="btn-secondary">Remove</button>
            {/if}
          </form>
        </li>
      {/each}
    </ul>
    {#if !committed}
      <form method="POST" action="?/addGroup" use:enhance class="mt-2 flex gap-2">
        <input name="name" placeholder="New group name" class="input w-56" />
        <button class="btn-secondary">Add group</button>
      </form>
    {/if}
    {@render message('groups')}
  </section>
{/if}

<section class="mb-6">
  <h2 class="mb-2 font-semibold">Lines</h2>
  {@render message('lines')}
  {#if data.lines.length === 0}<p class="mb-2 text-sm text-gray-600">No lines yet.</p>{/if}
  <div class="space-y-3">
    <!-- Keyed by the choice too, so the editor shows a part chosen from the candidates. -->
    {#each data.lines as line, index (`${line.id}:${line.resolution}:${line.partId}`)}
      <ImportLineForm
        kind={record.kind}
        number={index + 1}
        readonly={committed}
        {line}
        options={data.options}
        groups={data.groups}
        feedback={feedback(`line-${line.id}`)}
        cleanupAvailable={data.parsingAvailable}
      />
    {/each}
  </div>
  <datalist id="attribute-keys">
    {#each data.options.definitions as definition (definition.key)}
      {@const units = attributeUnitsHint(definition)}
      <option value={definition.key}>{definition.label}{units ? ` (${units})` : ''}</option>
    {/each}
  </datalist>
  {#if !committed}
    <form method="POST" action="?/addLine" use:enhance class="mt-3">
      <button class="btn-secondary">Add a line by hand</button>
    </form>
    {@render message('addLine')}
  {/if}
</section>

{#if !committed}
  <section class="mb-6 max-w-2xl">
    <h2 class="mb-2 font-semibold">Commit</h2>
    <p class="mb-2 text-sm text-gray-600">
      {#if record.kind === 'order'}
        Creates any new parts and a draft order with these lines. It does not receive the order or add stock.
      {:else}
        Creates any new parts, the project if needed, its component groups, and these BOM rows. It does not reserve or
        add stock.
      {/if}
    </p>
    {#if blocking.length > 0}
      <ul class="mb-2 list-disc pl-5 text-sm text-red-700">
        {#each blocking as problem (problem)}<li>{problem}</li>{/each}
      </ul>
    {/if}
    <form method="POST" action="?/commit" use:enhance class="flex gap-2">
      <input type="hidden" name="operation_id" value={data.operationId} />
      <button class="btn" disabled={blocking.length > 0 || (data.lines.length === 0 && record.kind !== 'order')}>Commit import</button>
      <button formaction="?/discard" class="btn-secondary">Discard import</button>
    </form>
    {#if record.kind === 'order'}
      <p class="mt-2 text-sm text-gray-600">
        Remove the lines you do not track. If you remove every line, the commit creates no order but records this
        supplier order, so a later import of it is skipped. Discard import deletes the import, so a later import of the
        order is not skipped.
      </p>
    {/if}
    {@render message('commit')}
    {@render message('discard')}
  </section>
{/if}
