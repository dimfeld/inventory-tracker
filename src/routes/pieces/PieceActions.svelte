<script lang="ts" module>
  export type PieceActionKind = 'cut' | 'scrap' | 'use';
</script>

<script lang="ts">
  import {
    calculateCut,
    checkSplit,
    formatArea,
    formatLength,
    formatSize,
    parsePieceLength,
    type PieceDisplayUnit,
  } from '#lib/pieces.ts';
  import { cutPiece, retirePiece, splitPiece } from './cut.remote';

  interface Props {
    kind: PieceActionKind;
    piece: {
      id: number;
      lengthMm: number;
      widthMm: number | null;
      locationId: number;
      locationName: string;
      kerfMm: number;
      minOffcutMm: number;
      displayUnit: PieceDisplayUnit;
    };
    /** Storage locations that a kept piece can go to. */
    locations: { id: number; name: string }[];
    operationId: string;
    today: string;
    oncancel: () => void;
  }

  let { kind, piece, locations, operationId, today, oncancel }: Props = $props();

  const unit = $derived(piece.displayUnit);
  const size = $derived(formatSize(piece, unit));
  const keepHere = $derived(String(piece.locationId));
  const issuesOf = (f: { fields: { allIssues(): { message: string }[] | undefined } }) =>
    f.fields.allIssues()?.map((issue) => issue.message).join('. ');

  let rowCount = $state(1);

  /** Lengths in mm of the non-empty inputs, and whether any of them is not a length. */
  function readLengths(values: (string | undefined)[]) {
    const lengths: number[] = [];
    let unreadable = false;
    for (const value of values) {
      if (!value?.trim()) continue;
      const mm = parsePieceLength(value, unit);
      if (mm === null || mm <= 0) unreadable = true;
      else lengths.push(mm);
    }
    return { lengths, unreadable };
  }

  // 1D cut: the remainder updates as the cut lengths are entered.
  const cutLengths = $derived(
    readLengths(Array.from({ length: rowCount }, (_, i) => cutPiece.fields.cuts[i].length.value()))
  );
  const cut = $derived(calculateCut(piece, piece, cutLengths.lengths));
  // The remainder is scrapped when it is under the minimum offcut, unless the user chooses.
  let remainderChoice = $state<string | null>(null);
  const remainderDestination = $derived(remainderChoice ?? (cut.underMinimum ? 'scrap' : keepHere));

  // 2D split: the area and dimension checks update as the sizes are entered.
  // One size per row, or null for a row that is not complete.
  const splitRows = $derived.by(() => {
    const rows: ({ lengthMm: number; widthMm: number } | null)[] = [];
    let unreadable = false;
    for (let i = 0; i < rowCount; i += 1) {
      const row = splitPiece.fields.outputs[i];
      const { lengths, unreadable: bad } = readLengths([row.length.value(), row.width.value()]);
      if (bad || lengths.length === 1) unreadable = true;
      rows.push(lengths.length === 2 ? { lengthMm: lengths[0], widthMm: lengths[1] } : null);
    }
    return { rows, sizes: rows.filter((r) => r !== null), unreadable };
  });
  const parentSize = $derived(piece.widthMm === null ? null : { lengthMm: piece.lengthMm, widthMm: piece.widthMm });
  const split = $derived(parentSize && checkSplit(parentSize, splitRows.sizes));
  /** True when the row's piece does not fit in the parent's dimensions, even rotated. */
  const oversized = (index: number) => {
    const row = splitRows.rows[index];
    return parentSize !== null && row != null && checkSplit(parentSize, [row]).oversized.length > 0;
  };
</script>

{#snippet destinationOptions()}
  {#each locations as location (location.id)}
    <option value={String(location.id)}>Keep in {location.name}</option>
  {/each}
  <option value="scrap">Scrap</option>
  <option value="use">Use outside a project</option>
{/snippet}

{#snippet reasonField(form: typeof cutPiece | typeof splitPiece)}
  <label class="block">
    Reason (required to use a piece outside a project)
    <input {...form.fields.reason.as('text')} placeholder="Repair of the shelf…" class="input" />
  </label>
{/snippet}

<div class="card mt-3 max-w-2xl text-sm">
  {#if kind === 'cut' && piece.widthMm === null}
    <form {...cutPiece} class="space-y-3">
      <h3 class="font-semibold">Cut {size} from {piece.locationName}</h3>
      <p class="text-gray-600">
        Enter the length of each cut piece in {unit}, or add a unit such as <code>mm</code> or <code>in</code>.
        Each cut loses a kerf of {formatLength(piece.kerfMm, unit)}.
      </p>
      <input {...cutPiece.fields.operationId.as('hidden', operationId)} />
      <input {...cutPiece.fields.occurredOn.as('hidden', today)} />
      <input {...cutPiece.fields.pieceId.as('hidden', piece.id)} />
      <input {...cutPiece.fields.unit.as('hidden', unit)} />
      {#each { length: rowCount }, index (index)}
        {@const row = cutPiece.fields.cuts[index]}
        <div class="flex flex-wrap items-end gap-2">
          <label class="block w-32">
            Cut {index + 1}
            <input {...row.length.as('text')} required={index === 0} placeholder={unit === 'mm' ? 'e.g. 415' : 'e.g. 16'} class="input" />
          </label>
          <label class="block grow">
            Label (optional)
            <input {...row.label.as('text')} class="input" />
          </label>
          <label class="block">
            Goes to
            <select {...row.destination.as('select', keepHere)} class="input">
              {@render destinationOptions()}
            </select>
          </label>
        </div>
      {/each}
      <button type="button" class="btn-secondary" onclick={() => (rowCount += 1)}>Add another cut</button>

      {#if cutLengths.unreadable}
        <p class="msg-error">Enter each length as a number, such as 300 or 12 in.</p>
      {:else if !cut.fits}
        <p class="msg-error">
          The cuts do not fit. They need {formatLength(-cut.remainderMm, unit)} more.
        </p>
      {:else if cutLengths.lengths.length === 0}
        <!-- No cuts yet, so there is no remainder to show. -->
      {:else if cut.remainderMm === 0}
        <p>The cuts use the whole piece. There is no remainder.</p>
      {:else}
        <div class="flex flex-wrap items-end gap-2">
          <p class="grow">
            Remainder: <strong>{formatLength(cut.remainderMm, unit)}</strong>
            {#if cut.underMinimum}
              <br /><span class="text-amber-700">
                Shorter than the minimum offcut of {formatLength(piece.minOffcutMm, unit)}. Scrap is proposed.
              </span>
            {/if}
          </p>
          <label class="block">
            Remainder goes to
            <select value={remainderDestination} onchange={(e) => (remainderChoice = e.currentTarget.value)} class="input">
              {@render destinationOptions()}
            </select>
          </label>
        </div>
      {/if}
      <input {...cutPiece.fields.remainderDestination.as('hidden', remainderDestination)} />
      {@render reasonField(cutPiece)}
      {#if issuesOf(cutPiece)}<p class="msg-error">{issuesOf(cutPiece)}</p>{/if}
      <div class="flex gap-2">
        <button class="btn" disabled={!cut.fits || cutLengths.unreadable || cutPiece.pending > 0}>Cut piece</button>
        <button type="button" class="btn-secondary" onclick={oncancel}>Cancel</button>
      </div>
    </form>
  {:else if kind === 'cut' && split}
    <form {...splitPiece} class="space-y-3">
      <h3 class="font-semibold">Split {size} from {piece.locationName}</h3>
      <p class="text-gray-600">
        Enter the piece you cut out and the leftover pieces you keep, in {unit}. The app does not calculate a layout.
      </p>
      <input {...splitPiece.fields.operationId.as('hidden', operationId)} />
      <input {...splitPiece.fields.occurredOn.as('hidden', today)} />
      <input {...splitPiece.fields.pieceId.as('hidden', piece.id)} />
      <input {...splitPiece.fields.unit.as('hidden', unit)} />
      {#each { length: rowCount }, index (index)}
        {@const row = splitPiece.fields.outputs[index]}
        <div class="flex flex-wrap items-end gap-2">
          <span class="w-20 pb-2 font-medium">{index === 0 ? 'Cut piece' : `Leftover ${index}`}</span>
          <label class="block w-24">
            Length
            <input {...row.length.as('text')} required={index === 0} class="input" />
          </label>
          <label class="block w-24">
            Width
            <input {...row.width.as('text')} required={index === 0} class="input" />
          </label>
          <label class="block grow">
            Label (optional)
            <input {...row.label.as('text')} class="input" />
          </label>
          <label class="block">
            Goes to
            <select {...row.destination.as('select', keepHere)} class="input">
              {@render destinationOptions()}
            </select>
          </label>
        </div>
        {#if oversized(index)}
          <p class="text-amber-700">This piece is larger than {size} in one dimension. Check the size.</p>
        {/if}
      {/each}
      <button type="button" class="btn-secondary" onclick={() => (rowCount += 1)}>Add a leftover piece</button>

      {#if splitRows.unreadable}
        <p class="msg-error">Enter the length and width of each piece, such as 6 or 150 mm.</p>
      {:else if !split.areaFits}
        <p class="msg-error">
          The pieces have a total area of {formatArea(split.outputAreaMm2, unit)}, more than the
          {formatArea(split.parentAreaMm2, unit)} of this piece.
        </p>
      {:else if splitRows.sizes.length > 0}
        <p class="text-gray-600">
          Pieces: {formatArea(split.outputAreaMm2, unit)} of {formatArea(split.parentAreaMm2, unit)}. The rest is waste.
        </p>
      {/if}
      {@render reasonField(splitPiece)}
      {#if issuesOf(splitPiece)}<p class="msg-error">{issuesOf(splitPiece)}</p>{/if}
      <div class="flex gap-2">
        <button class="btn" disabled={!split.areaFits || splitRows.unreadable || splitPiece.pending > 0}>Split piece</button>
        <button type="button" class="btn-secondary" onclick={oncancel}>Cancel</button>
      </div>
    </form>
  {:else}
    <form {...retirePiece} class="space-y-3">
      <h3 class="font-semibold">
        {kind === 'scrap' ? 'Scrap' : 'Use outside a project:'} {size} from {piece.locationName}
      </h3>
      <input {...retirePiece.fields.operationId.as('hidden', operationId)} />
      <input {...retirePiece.fields.occurredOn.as('hidden', today)} />
      <input {...retirePiece.fields.pieceId.as('hidden', piece.id)} />
      <input {...retirePiece.fields.kind.as('hidden', kind)} />
      <label class="block">
        Reason
        <input
          {...retirePiece.fields.reason.as('text')}
          required
          placeholder={kind === 'scrap' ? 'Too short, bent…' : 'Repair of the shelf…'}
          class="input"
        />
      </label>
      {#if kind === 'use'}
        <p class="text-gray-600">To use only part of the piece, cut it and choose “Use outside a project” for the used piece.</p>
      {/if}
      {#if issuesOf(retirePiece)}<p class="msg-error">{issuesOf(retirePiece)}</p>{/if}
      <div class="flex gap-2">
        <button class="btn-danger" disabled={retirePiece.pending > 0}>{kind === 'scrap' ? 'Scrap piece' : 'Use piece'}</button>
        <button type="button" class="btn-secondary" onclick={oncancel}>Cancel</button>
      </div>
    </form>
  {/if}
</div>
