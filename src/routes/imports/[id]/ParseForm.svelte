<script lang="ts">
  import { enhance } from '$app/forms';

  interface Props {
    parsed: boolean;
    parsingAvailable: boolean;
    hasCsv: boolean;
    /** True while this page waits for a parse request. It is not the stored parse state. */
    pending?: boolean;
  }

  let { parsed, parsingAvailable, hasCsv, pending = $bindable(false) }: Props = $props();
</script>

<form
  method="POST"
  action="?/parse"
  use:enhance={({ cancel }) => {
    if (pending) return cancel();
    pending = true;
    return async ({ update }) => {
      pending = false;
      await update();
    };
  }}
  class="flex flex-wrap items-center gap-3"
>
  <button class="btn" disabled={!parsingAvailable || pending}>
    {parsed ? 'Parse again' : 'Parse with GPT-6 Luna'}
  </button>
  {#if !pending}
    <span class="text-sm text-gray-600">
      {#if !parsingAvailable}
        OPENAI_API_KEY is not set. Enter lines by hand{hasCsv ? ' or map the CSV columns' : ''}.
      {:else}
        Sends the source to OpenAI and replaces the lines below.
      {/if}
    </span>
  {/if}
  <!-- The live region stays in the page so screen readers announce text added to it. -->
  <span role="status" class="flex items-center gap-2 text-sm">
    {#if pending}
      <span
        aria-hidden="true"
        class="inline-block size-4 animate-spin rounded-full border-2 border-gray-300 border-t-blue-700 motion-reduce:animate-none"
      ></span>
      Parsing with GPT-6 Luna… This can take a minute. Keep this page open.
    {/if}
  </span>
</form>
