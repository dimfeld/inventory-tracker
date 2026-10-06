<script lang="ts">
  import BomLineForm from '#lib/components/BomLineForm.svelte';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
</script>

<svelte:head>
  <title>Add BOM row · {data.project.name}</title>
</svelte:head>

<a href="/projects/{data.project.id}" class="back-link">← {data.project.name}</a>
<h1 class="page-title mb-4">Add BOM row</h1>

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
