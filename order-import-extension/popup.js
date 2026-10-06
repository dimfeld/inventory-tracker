const COLUMNS = [
  "supplier",
  "order_reference",
  "order_date",
  "description",
  "quantity",
  "purchase_unit",
  "pack_quantity",
  "unit",
  "manufacturer",
  "part_number",
  "supplier_sku",
  "unit_price",
  "currency",
  "notes",
];

const SUPPORTED_HOSTS = [
  [/aliexpress\./i, "AliExpress"],
  [/(^|\.)amazon\./i, "Amazon"],
];

const extractButton = document.querySelector("#extract");
const copyButton = document.querySelector("#copy");
const siteText = document.querySelector("#site");
const statusText = document.querySelector("#status");
const preview = document.querySelector("#preview");
const csvText = document.querySelector("#csv");

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(rows) {
  return [COLUMNS, ...rows.map((row) => COLUMNS.map((column) => row[column] ?? ""))]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");
}

function setStatus(message, state = "") {
  statusText.textContent = message;
  statusText.className = state;
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function copyCsv() {
  await navigator.clipboard.writeText(csvText.value);
  setStatus("CSV copied to the clipboard.", "success");
}

const STATE_KEY = "collect";
// A run whose worker stopped (for example, the browser closed) no longer updates its state.
const STALE_MS = 90_000;

function showRows(rows, supplier, extra = "") {
  csvText.value = toCsv(rows);
  preview.hidden = false;
  return `${rows.length} order ${rows.length === 1 ? "line" : "lines"} from ${supplier}.${extra}`;
}

/** Progress or result of a background run of AliExpress details pages. */
async function showRun(state, { copy }) {
  const stale = state.running && Date.now() - state.updatedAt > STALE_MS;
  if (state.running && !stale) {
    extractButton.disabled = true;
    setStatus(`Reading order ${Math.min(state.done + 1, state.total)} of ${state.total}…`);
    return;
  }
  extractButton.disabled = false;
  const failed = state.errors.length
    ? ` ${state.errors.length} of ${state.total} orders could not be read: ${state.errors
        .map((e) => `${e.url.match(/orderId=(\d+)/)?.[1] ?? e.url} (${e.error})`)
        .join("; ")}`
    : "";
  const stopped = stale ? " The run stopped before the end." : "";
  if (state.rows.length === 0) {
    setStatus(`No order lines were read.${failed}${stopped}`, "error");
    return;
  }
  const message = showRows(state.rows, state.supplier, `${failed}${stopped}`);
  if (copy) await navigator.clipboard.writeText(csvText.value);
  setStatus(
    `${message} ${copy ? "Copied to the clipboard. " : "Select Copy again to copy it. "}Review the preview before you import it.`,
    failed || stopped ? "error" : "success"
  );
}

async function extract() {
  extractButton.disabled = true;
  setStatus("Reading the visible page…");

  try {
    const tab = await activeTab();
    if (!tab?.id) throw new Error("The active tab is not available.");

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"],
    });

    if (!result?.ok) throw new Error(result?.error || "This page is not supported.");
    if (result.detailUrls) {
      if (result.detailUrls.length === 0) {
        throw new Error("No orders were found. Make sure the order list is visible.");
      }
      const response = await chrome.runtime.sendMessage({
        type: "collect",
        supplier: result.supplier,
        urls: result.detailUrls,
      });
      if (!response?.started) throw new Error(response?.error || "The run did not start.");
      setStatus(`Reading order 1 of ${result.detailUrls.length}…`);
      return;
    }
    if (result.rows.length === 0) {
      throw new Error(
        `No order lines were found on this ${result.supplier} page. Open an order details page and make sure the order lines are visible.`
      );
    }
    const message = showRows(result.rows, result.supplier);
    await copyCsv();
    setStatus(
      `${message} Copied to the clipboard. Review the preview before you import it.`,
      "success"
    );
    extractButton.disabled = false;
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), "error");
    extractButton.disabled = false;
  }
}

// While the popup is open, follow the run and copy the result when it ends.
chrome.storage.session.onChanged.addListener((changes) => {
  const state = changes[STATE_KEY]?.newValue;
  if (!state) return;
  showRun(state, { copy: !state.running }).catch((error) => setStatus(error.message, "error"));
});

extractButton.addEventListener("click", extract);
copyButton.addEventListener("click", () => {
  copyCsv().catch((error) => setStatus(error.message, "error"));
});

async function init() {
  const tab = await activeTab();
  const host = tab?.url ? new URL(tab.url).hostname : "";
  const match = SUPPORTED_HOSTS.find(([pattern]) => pattern.test(host));
  siteText.textContent = match ? `${match[1]} page detected` : "Unsupported page";
  extractButton.disabled = !match;
  if (!match) setStatus("Open an AliExpress or Amazon order page first.", "error");
  if (match?.[1] === "AliExpress") {
    extractButton.textContent = "Read all loaded orders and copy CSV";
    setStatus(
      "On the order list, the extension opens each loaded order in a background tab. Select View orders first to load more."
    );
  }

  // A run that is in progress or that ended while the popup was closed.
  const { [STATE_KEY]: state } = await chrome.storage.session.get(STATE_KEY);
  if (state?.supplier === match?.[1]) await showRun(state, { copy: false });
}

init().catch(() => {
  siteText.textContent = "Page access is not available";
  extractButton.disabled = true;
});
