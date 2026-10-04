<script lang="ts">
  import BomLineForm from '#lib/components/BomLineForm.svelte';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
</script>

<svelte:head>
  <title>Edit BOM row · {data.project.name}</title>
</svelte:head>

<p class="mb-2 text-sm">
  <a href="/projects/{data.project.id}" class="text-blue-700 hover:underline">← {data.project.name}</a>
</p>
<h1 class="mb-4 text-2xl font-semibold">Edit BOM row</h1>

<BomLineForm
  options={data.options}
  initial={data.initial}
  message={form && 'message' in form ? form.message : undefined}
  errors={form && 'errors' in form ? form.errors : undefined}
  submitLabel="Save row"
/>
