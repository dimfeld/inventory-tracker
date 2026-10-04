<script lang="ts">
  import { enhance } from '$app/forms';
  import { describeConstraint } from '#lib/projects.ts';
  import { formatQuantity } from '#lib/units.ts';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  const line = $derived(data.line);
  const STATUS_STYLES = {
    match: 'bg-green-100 text-green-800',
    unresolved: 'bg-amber-100 text-amber-800',
    conflict: 'bg-red-100 text-red-800',
  } as const;
  const STATUS_LABELS = { match: 'match', unresolved: 'needs review', conflict: 'conflict' } as const;

  const feedback = $derived.by(() => {
    if (form?.action !== 'approve') return null;
    if ('success' in form) return { ok: true, text: form.success };
    if ('message' in form) return { ok: false, text: form.message };
    if ('errors' in form) return { ok: false, text: Object.values(form.errors ?? {}).join('. ') };
    return null;
  });
</script>

<svelte:head>
  <title>{line.description} · {data.project.name}</title>
</svelte:head>

<p class="mb-2 text-sm">
  <a href="/projects/{data.project.id}" class="text-blue-700 hover:underline">← {data.project.name}</a>
</p>

<div class="mb-4 flex flex-wrap items-center gap-3">
  <h1 class="text-2xl font-semibold">{line.description}</h1>
  <a href="/projects/{data.project.id}/lines/{line.id}/edit" class="btn-secondary ml-auto">Edit row</a>
</div>

<dl class="mb-6 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
  <dt class="text-gray-600">Quantity</dt><dd>{formatQuantity(line.quantity, line.unit)}</dd>
  <dt class="text-gray-600">Component</dt><dd>{data.component?.name ?? 'Ungrouped'}</dd>
  <dt class="text-gray-600">Reference designators</dt><dd>{line.referenceDesignators ?? '—'}</dd>
  {#if line.partId !== null}
    <dt class="text-gray-600">Exact part</dt>
    <dd><a href="/parts/{line.partId}" class="text-blue-700 hover:underline">{line.partName}</a></dd>
  {:else}
    <dt class="text-gray-600">Category</dt><dd>{line.categoryName ?? '—'}</dd>
    <dt class="text-gray-600">Identifier</dt>
    <dd>{[line.manufacturer, line.partNumber].filter(Boolean).join(' ') || '—'}</dd>
  {/if}
  <dt class="text-gray-600">Constraints</dt>
  <dd>{line.constraints.map(describeConstraint).join('; ') || '—'}</dd>
  {#if line.notes}<dt class="text-gray-600">Notes</dt><dd>{line.notes}</dd>{/if}
</dl>

{#if data.missingRequired.length > 0}
  <p class="mb-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm">
    This requirement does not specify {data.missingRequired.map((m) => m.label).join(', ')}, which
    {data.missingRequired.length === 1 ? 'is' : 'are'} required for its category. No part can match
    until you <a href="/projects/{data.project.id}/lines/{line.id}/edit" class="text-blue-700 underline">add
    {data.missingRequired.length === 1 ? 'it' : 'them'}</a>.
  </p>
{/if}

{#if feedback}<p class="mb-3 {feedback.ok ? 'text-green-700' : 'text-red-700'}">{feedback.text}</p>{/if}

<section class="mb-6">
  <h2 class="mb-2 font-semibold">Approved parts</h2>
  {#if line.choices.length === 0}
    <p class="text-sm text-gray-600">None yet. Approving a part does not reserve stock.</p>
  {:else}
    <ul class="space-y-1 text-sm">
      {#each line.choices as choice (choice.id)}
        <li class="flex flex-wrap items-center gap-2">
          <a href="/parts/{choice.partId}" class="text-blue-700 hover:underline">{choice.partName}</a>
          {#if choice.substitute}<span class="rounded bg-amber-100 px-1 text-xs">substitute</span>{/if}
          {#if choice.note}<span class="text-gray-600">{choice.note}</span>{/if}
          <form method="POST" action="?/removeChoice" use:enhance>
            <input type="hidden" name="choice_id" value={choice.id} />
            <button class="text-red-700 hover:underline">Remove</button>
          </form>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<section class="mb-6">
  <h2 class="mb-1 font-semibold">Candidates</h2>
  <p class="mb-2 text-sm text-gray-600">
    Suggestions only. A part that is not a confirmed match can be approved only as a substitute with
    a note.
  </p>
  {#if data.candidates.length === 0}
    <p class="text-sm text-gray-600">
      No candidates. Add a category, an identifier, or constraints, or approve a substitute below.
    </p>
  {/if}
  {#each data.candidates as candidate (candidate.part.id)}
    <article class="mb-3 rounded border p-3 text-sm">
      <div class="mb-1 flex flex-wrap items-center gap-2">
        <a href="/parts/{candidate.part.id}" class="font-semibold text-blue-700 hover:underline">
          {candidate.part.name}
        </a>
        <span class="rounded px-1 text-xs {STATUS_STYLES[candidate.status]}">{STATUS_LABELS[candidate.status]}</span>
        <span class="text-gray-500">found by {candidate.sourceLabel}</span>
        {#if candidate.choice}
          <span class="rounded bg-blue-100 px-1 text-xs">
            approved{candidate.choice.substitute ? ' as substitute' : ''}
          </span>
        {/if}
      </div>
      {#if candidate.choice?.note}<p class="mb-1 text-gray-600">Approval note: {candidate.choice.note}</p>{/if}
      <ul class="mb-2 list-disc pl-5">
        {#each candidate.conflicts as reason (reason)}<li class="text-red-700">{reason}</li>{/each}
        {#each candidate.unresolved as reason (reason)}<li class="text-amber-700">{reason}</li>{/each}
        {#each candidate.evidence as reason (reason)}<li class="text-gray-700">{reason}</li>{/each}
      </ul>
      {#if !candidate.choice}
        <form method="POST" action="?/approve" use:enhance class="flex flex-wrap items-end gap-2">
          <input type="hidden" name="part_id" value={candidate.part.id} />
          {#if candidate.status === 'match'}
            <label class="flex items-center gap-1">
              <input type="checkbox" name="substitute" /> Substitute
            </label>
          {:else}
            <input type="hidden" name="substitute" value="on" />
          {/if}
          <input
            name="note"
            placeholder={candidate.status === 'match' ? 'Note (optional)' : 'Why is this substitute acceptable?'}
            required={candidate.status !== 'match'}
            class="rounded border border-gray-300 px-2 py-1"
          />
          <button class="btn-secondary">
            {candidate.status === 'match' ? 'Approve' : 'Approve as substitute'}
          </button>
        </form>
      {/if}
    </article>
  {/each}
</section>

<form method="POST" action="?/approve" use:enhance class="max-w-xl space-y-2 rounded border p-3 text-sm">
  <h2 class="font-semibold">Approve another part as a substitute</h2>
  <input type="hidden" name="substitute" value="on" />
  <select name="part_id" required class="input">
    <option value="">Choose a part</option>
    {#each data.parts as part (part.id)}
      <option value={part.id}>{part.name} — {part.baseUnit}</option>
    {/each}
  </select>
  <input name="note" required placeholder="Why is this substitute acceptable?" class="input" />
  <button class="btn-secondary">Approve substitute</button>
</form>
