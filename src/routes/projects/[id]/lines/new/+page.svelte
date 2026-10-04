<script lang="ts">
  import BomLineForm from '#lib/components/BomLineForm.svelte';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
</script>

<svelte:head>
  <title>Add BOM row · {data.project.name}</title>
</svelte:head>

<p class="mb-2 text-sm">
  <a href="/projects/{data.project.id}" class="text-blue-700 hover:underline">← {data.project.name}</a>
</p>
<h1 class="mb-4 text-2xl font-semibold">Add BOM row</h1>

<BomLineForm
  options={data.options}
  initial={{
    description: '',
    amount: '',
    unit: 'pcs',
    componentId: data.componentId,
    referenceDesignators: null,
    notes: null,
    partId: null,
    categoryId: null,
    manufacturer: null,
    partNumber: null,
    constraints: [],
  }}
  message={form && 'message' in form ? form.message : undefined}
  errors={form && 'errors' in form ? form.errors : undefined}
  submitLabel="Add row"
/>
