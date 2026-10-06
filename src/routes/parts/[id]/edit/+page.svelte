<script lang="ts">
  import PartForm from '#lib/components/PartForm.svelte';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
</script>

<svelte:head>
  <title>Edit {data.part.name}</title>
</svelte:head>

<a href="/parts/{data.part.id}" class="back-link">← {data.part.name}</a>
<h1 class="page-title mb-4">Edit part</h1>
<PartForm
  categories={data.categories}
  attributeOptions={data.attributeOptions}
  initial={data.initial}
  baseUnitLocked={data.baseUnitLocked}
  message={form && 'message' in form ? form.message : undefined}
  errors={form && 'errors' in form ? form.errors : undefined}
  submitLabel="Save part"
/>
