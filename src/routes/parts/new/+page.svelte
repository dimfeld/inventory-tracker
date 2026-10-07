<script lang="ts">
  import PartForm from '#lib/components/PartForm.svelte';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
</script>

<svelte:head>
  <title>New part</title>
</svelte:head>

<h1 class="page-title mb-4">New part</h1>
{#if data.copy}
  <p class="mb-4 text-sm text-gray-600">
    A copy of {data.copy.fromName}. Change the name and the attributes that are different. The part
    number, aliases, and supplier references are not copied.
  </p>
{/if}
<PartForm
  categories={data.categories}
  attributeOptions={data.attributeOptions}
  initial={data.copy?.initial}
  message={form && 'message' in form ? form.message : undefined}
  errors={form && 'errors' in form ? form.errors : undefined}
  submitLabel="Create part"
/>
