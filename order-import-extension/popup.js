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
  [/digikey\./i, "DigiKey"],
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
    if (result.rows.length === 0) {
      throw new Error(
        `No order lines were found on this ${result.supplier} page. Open an order history or order details page and make sure the orders are visible.`
      );
    }
    csvText.value = toCsv(result.rows);
    preview.hidden = false;
    await copyCsv();
    setStatus(
      `${result.rows.length} order ${result.rows.length === 1 ? "line" : "lines"} copied from ${result.supplier}. Review the preview before you import it.`,
      "success"
    );
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), "error");
  } finally {
    extractButton.disabled = false;
  }
}

extractButton.addEventListener("click", extract);
copyButton.addEventListener("click", () => {
  copyCsv().catch((error) => setStatus(error.message, "error"));
});

activeTab()
  .then((tab) => {
    const host = tab?.url ? new URL(tab.url).hostname : "";
    const match = SUPPORTED_HOSTS.find(([pattern]) => pattern.test(host));
    siteText.textContent = match ? `${match[1]} page detected` : "Unsupported page";
    extractButton.disabled = !match;
    if (!match) {
      setStatus("Open an AliExpress, DigiKey, or Amazon order page first.", "error");
    }
  })
  .catch(() => {
    siteText.textContent = "Page access is not available";
    extractButton.disabled = true;
  });
