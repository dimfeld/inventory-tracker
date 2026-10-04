<script lang="ts">
  import PartForm from '#lib/components/PartForm.svelte';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
</script>

<svelte:head>
  <title>New part</title>
</svelte:head>

<h1 class="mb-4 text-2xl font-semibold">New part</h1>
<PartForm
  categories={data.categories}
  attributeOptions={data.attributeOptions}
  message={form && 'message' in form ? form.message : undefined}
  errors={form && 'errors' in form ? form.errors : undefined}
  submitLabel="Create part"
/>
