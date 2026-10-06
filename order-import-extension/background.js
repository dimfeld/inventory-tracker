// Reads AliExpress order details pages one at a time in inactive tabs. The popup starts a run
// and shows its progress from session storage, so the run continues when the popup closes.

const STATE_KEY = "collect";
const DETAIL_ITEMS = ".order-detail-item-content";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let running = false;

async function saveState(state) {
  await chrome.storage.session.set({ [STATE_KEY]: { ...state, updatedAt: Date.now() } });
}

async function waitFor(check, timeoutMs, message) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await check()) return;
    await delay(500);
  }
  throw new Error(message);
}

async function readDetails(url) {
  const tab = await chrome.tabs.create({ url, active: false });
  try {
    await waitFor(
      async () => (await chrome.tabs.get(tab.id)).status === "complete",
      30_000,
      "The page did not load"
    );
    // The page renders its items after it loads. A sign-in or verification page never does.
    await waitFor(
      async () => {
        const [{ result }] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (selector) => document.querySelectorAll(selector).length,
          args: [DETAIL_ITEMS],
        });
        return result > 0;
      },
      20_000,
      "No items appeared. Open the order to check for a sign-in or verification prompt."
    );
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"],
    });
    if (!result?.ok) throw new Error(result?.error || "The page could not be read");
    return result.rows;
  } finally {
    await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function collect(supplier, urls) {
  running = true;
  const state = { running: true, supplier, done: 0, total: urls.length, rows: [], errors: [] };
  await saveState(state);
  try {
    for (const url of urls) {
      try {
        state.rows.push(...(await readDetails(url)));
      } catch (error) {
        state.errors.push({ url, error: error instanceof Error ? error.message : String(error) });
      }
      state.done++;
      await saveState(state);
      // Space out the requests so the store does not see a burst of page loads.
      await delay(800);
    }
  } finally {
    running = false;
    await saveState({ ...state, running: false });
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "collect") return;
  if (running) {
    sendResponse({ started: false, error: "A run is already in progress." });
    return;
  }
  collect(message.supplier, message.urls);
  sendResponse({ started: true });
});
