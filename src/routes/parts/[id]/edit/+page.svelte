<script lang="ts">
  import PartForm from '#lib/components/PartForm.svelte';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
</script>

<svelte:head>
  <title>Edit {data.part.name}</title>
</svelte:head>

<p class="mb-2 text-sm"><a href="/parts/{data.part.id}" class="text-blue-700 hover:underline">← {data.part.name}</a></p>
<h1 class="mb-4 text-2xl font-semibold">Edit part</h1>
<PartForm
  categories={data.categories}
  initial={data.initial}
  baseUnitLocked={data.baseUnitLocked}
  message={form && 'message' in form ? form.message : undefined}
  errors={form && 'errors' in form ? form.errors : undefined}
  submitLabel="Save part"
/>
