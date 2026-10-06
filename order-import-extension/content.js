(() => {
  "use strict";

  const clean = (value) =>
    String(value ?? "")
      .replace(/\s+/g, " ")
      .trim();
  const text = (element) => clean(element?.textContent);
  const first = (root, selectors) => {
    for (const selector of selectors) {
      const found = root?.querySelector?.(selector);
      if (found) return found;
    }
    return null;
  };
  const firstText = (root, selectors) => text(first(root, selectors));
  // Product links without tracking parameters. Amazon links become /dp/ASIN.
  const absoluteUrl = (value) => {
    if (!value) return "";
    try {
      const url = new URL(value, location.href);
      const asin = url.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?]|$)/i)?.[1];
      if (asin && /(^|\.)amazon\./i.test(url.hostname)) return `${url.origin}/dp/${asin}`;
      url.search = "";
      url.hash = "";
      return url.href;
    } catch {
      return "";
    }
  };
  const MONTHS = [
    "jan",
    "feb",
    "mar",
    "apr",
    "may",
    "jun",
    "jul",
    "aug",
    "sep",
    "oct",
    "nov",
    "dec",
  ];
  // YYYY-MM-DD, or "" when the displayed date is not clear (such as 03/04/2026).
  const isoDate = (value) => {
    const parts = (year, month, day) => {
      const date = new Date(Date.UTC(year, month - 1, day));
      if (date.getUTCFullYear() !== year || date.getUTCDate() !== day) return "";
      return date.toISOString().slice(0, 10);
    };
    const v = clean(value);
    let m = v.match(/^((?:19|20)\d{2})[-/.](\d{1,2})[-/.](\d{1,2})$/);
    if (m) return parts(+m[1], +m[2], +m[3]);
    m = v.match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+((?:19|20)\d{2})$/);
    if (m && MONTHS.includes(m[1].toLowerCase()))
      return parts(+m[3], MONTHS.indexOf(m[1].toLowerCase()) + 1, +m[2]);
    m = v.match(/^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?,?\s+((?:19|20)\d{2})$/);
    if (m && MONTHS.includes(m[2].toLowerCase()))
      return parts(+m[3], MONTHS.indexOf(m[2].toLowerCase()) + 1, +m[1]);
    m = v.match(/^(\d{1,2})[-/.](\d{1,2})[-/.]((?:19|20)\d{2})$/);
    if (m && +m[1] > 12) return parts(+m[3], +m[2], +m[1]);
    if (m && +m[2] > 12) return parts(+m[3], +m[1], +m[2]);
    return "";
  };
  const matchText = (value, patterns) => {
    for (const pattern of patterns) {
      const match = clean(value).match(pattern);
      if (match?.[1]) return clean(match[1]);
    }
    return "";
  };
  const nodesForFirstSelector = (root, selectors) => {
    for (const selector of selectors) {
      const nodes = [...root.querySelectorAll(selector)];
      if (nodes.length) return nodes;
    }
    return [];
  };
  const topLevel = (nodes) =>
    nodes.filter((node) => !nodes.some((other) => other !== node && other.contains(node)));
  const money = (value) => {
    const original = clean(value);
    const currency =
      original
        .match(/\b(USD|CAD|AUD|EUR|GBP|JPY|CNY|INR|MXN|BRL|AED|SAR|SGD|NZD)\b/i)?.[1]
        ?.toUpperCase() ||
      ({ $: "USD", US$: "USD", C$: "CAD", A$: "AUD", "€": "EUR", "£": "GBP", "¥": "JPY" }[
        original.match(/US\$|C\$|A\$|[$€£¥]/)?.[0]
      ] ??
        "");
    const numeric = original.match(/-?\d[\d.,]*(?:\s\d+)?/)?.[0] ?? "";
    if (!numeric) return { amount: "", currency };
    let amount = numeric.replace(/\s/g, "");
    const lastComma = amount.lastIndexOf(",");
    const lastDot = amount.lastIndexOf(".");
    if (lastComma > lastDot) amount = amount.replaceAll(".", "").replace(",", ".");
    else amount = amount.replaceAll(",", "");
    return { amount, currency };
  };
  const quantity = (value) =>
    matchText(value, [
      /(?:quantity|qty)\s*[:#]?\s*(\d+(?:\.\d+)?)/i,
      /(?:^|\s)[x×]\s*(\d+(?:\.\d+)?)(?:\s|$)/i,
      /(\d+(?:\.\d+)?)\s*[x×](?:\s|$)/i,
    ]);
  const orderReference = (value) =>
    matchText(value, [
      /(?:order\s*(?:id|number|no\.?|#))\s*[:#]?\s*([A-Z0-9]+(?:-[A-Z0-9]+)+|\d+)/i,
      /\b(\d{3}-\d{7}-\d{7})\b/,
    ]);
  const orderDate = (value) =>
    matchText(value, [
      /(?:order\s+placed|ordered(?:\s+on|\s+date)?|order\s+date|placed)\s*:?\s*((?:19|20)\d{2}[-/.]\d{1,2}[-/.]\d{1,2})/i,
      /(?:order\s+placed|ordered(?:\s+on|\s+date)?|order\s+date|placed)\s*:?\s*([A-Z][a-z]+\s+\d{1,2},\s+(?:19|20)\d{2})/i,
      /(?:order\s+placed|ordered(?:\s+on|\s+date)?|order\s+date|placed)\s*:?\s*(\d{1,2}\s+[A-Z][a-z]+\s+(?:19|20)\d{2})/i,
      /(?:order\s+placed|ordered(?:\s+on|\s+date)?|order\s+date|placed)\s*:?\s*(\d{1,2}[-/.]\d{1,2}[-/.](?:19|20)\d{2})/i,
      /\b((?:19|20)\d{2}[-/.]\d{1,2}[-/.]\d{1,2})\b/,
      /\b([A-Z][a-z]+\s+\d{1,2},\s+(?:19|20)\d{2})\b/,
    ]);
  const skuFromUrl = (url) => matchText(url, [/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?]|$)/i]);
  const aliItemId = (url) => matchText(url, [/\/item\/(\d+)(?:\.html)?(?:[/?]|$)/i]);
  // The order date has its own column; baseRow adds it to the notes only when it is not clear.
  const lineNotes = ({ productUrl, extra = "" }) =>
    [extra, productUrl && `Product: ${productUrl}`].filter(Boolean).join("; ");

  function baseRow(supplier, sourceUrl, values) {
    const displayedDate = clean(values.order_date);
    const date = isoDate(displayedDate);
    const notes = [!date && displayedDate && `Ordered: ${displayedDate}`, values.notes]
      .filter(Boolean)
      .join("; ");
    return {
      supplier,
      order_reference: "",
      description: "",
      quantity: "",
      purchase_unit: "",
      pack_quantity: "",
      unit: "",
      manufacturer: "",
      part_number: "",
      supplier_sku: "",
      unit_price: "",
      currency: "",
      product_url: "",
      source_url: sourceUrl,
      ...values,
      order_date: date,
      notes,
    };
  }

  function dedupe(rows) {
    const seen = new Set();
    return rows.filter((row) => {
      if (!row.description) return false;
      const key = [
        row.order_reference,
        row.supplier_sku,
        row.description,
        row.quantity,
        row.product_url,
        row.notes,
      ].join("\u001f");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // The order list shows only images for an order with several items, so the extension reads
  // each order's details page. On the list, return the details links for the background worker.
  // The status of a cancelled order is "Canceled".
  const CANCELLED = /cancel/i;

  function aliExpressDetailUrls() {
    const cards = [...document.querySelectorAll(".order-item")];
    const open = cards.filter(
      (card) => !CANCELLED.test(firstText(card, [".order-item-header-status-text"]))
    );
    const links = open.flatMap((card) => [
      ...card.querySelectorAll('a[href*="order/detail.html"]'),
    ]);
    return {
      urls: [...new Set(links.map((link) => link.href))],
      cancelled: cards.length - open.length,
    };
  }

  function extractAliExpressDetails() {
    const info = (label) =>
      text([...document.querySelectorAll(".info-row")].find((row) => label.test(text(row))));
    const reference =
      matchText(info(/ref\. number/i), [/(\d{6,})/]) ||
      matchText(location.href, [/[?&]orderId=(\d+)/i]);
    const date = matchText(info(/order placed on/i), [/order placed on:?\s*(.+)$/i]);
    const rows = [];

    for (const store of document.querySelectorAll(".order-detail-item")) {
      const storeName = firstText(store, [".store-name"]);
      for (const item of store.querySelectorAll(".order-detail-item-content")) {
        const link = first(item, [".item-title a", 'a[href*="/item/"]']);
        const productUrl = absoluteUrl(link?.getAttribute("href"));
        const option = firstText(item, [".item-sku-attr"]);
        const parsedMoney = money(firstText(item, [".item-price > div", ".item-price"]));
        rows.push(
          baseRow("AliExpress", location.href, {
            order_reference: reference,
            order_date: date,
            supplier_sku: aliItemId(productUrl),
            description: firstText(item, [".item-title"]) || text(link),
            quantity: quantity(firstText(item, [".item-price-quantity"])) || "1",
            unit_price: parsedMoney.amount,
            currency: parsedMoney.currency,
            product_url: productUrl,
            notes: lineNotes({
              productUrl,
              extra: [option && `Option: ${option}`, storeName && `Store: ${storeName}`]
                .filter(Boolean)
                .join("; "),
            }),
          })
        );
      }
    }
    return dedupe(rows);
  }

  // The order details page labels its fields with data-component attributes.
  function extractAmazonDetails(items) {
    const component = (root, name) => root.querySelector(`[data-component="${name}"]`);
    const reference =
      orderReference(text(component(document, "orderId"))) ||
      text(component(document, "orderId")) ||
      matchText(location.href, [/[?&]orderID=([A-Z0-9-]+)/i]);
    const date = text(component(document, "orderDate"));

    return dedupe(
      items.map((item) => {
        const link = first(component(item, "itemTitle"), ["a"]);
        const productUrl = absoluteUrl(link?.getAttribute("href"));
        const priceElement = component(item, "unitPrice");
        const parsedMoney = money(
          text(first(priceElement, [".a-offscreen"])) || text(priceElement)
        );
        const quantityText = text(component(item, "quantity"));
        const imageText = text(component(item, "itemImage"));
        const variation = text(component(item, "purchasedVariationDetails"));
        return baseRow("Amazon", location.href, {
          order_reference: reference,
          order_date: date,
          supplier_sku: skuFromUrl(productUrl),
          description: text(link) || text(component(item, "itemTitle")),
          quantity:
            quantity(quantityText) ||
            quantityText.match(/^\d+$/)?.[0] ||
            imageText.match(/^\d+$/)?.[0] ||
            "1",
          unit_price: parsedMoney.amount,
          currency: parsedMoney.currency,
          product_url: productUrl,
          notes: lineNotes({
            productUrl,
            extra: variation && `Option: ${variation}`,
          }),
        });
      })
    );
  }

  function extractAmazon() {
    // A purchasedItems block is one shipment group and can hold several items. Each item is
    // the largest ancestor of its title that holds no other title.
    const titles = [
      ...document.querySelectorAll(
        '[data-component="purchasedItems"] [data-component="itemTitle"]'
      ),
    ];
    if (titles.length) {
      const itemTitles = '[data-component="itemTitle"]';
      const items = titles.map((title) => {
        let item = title;
        while (item.parentElement && item.parentElement.querySelectorAll(itemTitles).length === 1)
          item = item.parentElement;
        return item;
      });
      return extractAmazonDetails(items);
    }

    const sourceUrl = location.href;
    let cards = topLevel(
      nodesForFirstSelector(document, [
        '[data-csa-c-slot-id*="yourorders.order-card"]',
        ".order-card",
        ".js-order-card",
        "[data-order-id]",
      ])
    );
    if (!cards.length && /order-details|order-summary|print\.html/i.test(location.href))
      cards = [document.body];
    const rows = [];

    for (const card of cards) {
      const cardText = text(card);
      const reference = amazonOrderId(card);
      const date = orderDate(cardText);
      const productLinks = [
        ...card.querySelectorAll(
          '.yohtmlc-product-title a, a[href*="/dp/"], a[href*="/gp/product/"], [data-component="ordered-item"] a'
        ),
      ].filter((link) => {
        const label = clean(link.getAttribute("title")) || text(link);
        return (
          label.length > 2 && !/buy it again|view item|write a review|product page/i.test(label)
        );
      });
      const seenLinks = new Set();

      for (const link of productLinks) {
        const productUrl = absoluteUrl(link.getAttribute("href"));
        const identity = skuFromUrl(productUrl) || productUrl || text(link);
        if (seenLinks.has(identity)) continue;
        seenLinks.add(identity);

        const container =
          link.closest("[data-component='ordered-item'], .a-fixed-left-grid, .shipment, li") ||
          link.parentElement ||
          card;
        const containerText = text(container);
        const priceText = firstText(container, [
          ".a-price",
          ".a-color-price",
          "[class*=item-price]",
        ]);
        const parsedMoney = money(priceText);
        rows.push(
          baseRow("Amazon", sourceUrl, {
            order_reference: reference,
            order_date: date,
            supplier_sku: skuFromUrl(productUrl),
            description: clean(link.getAttribute("title")) || text(link),
            quantity: quantity(containerText) || "1",
            unit_price: parsedMoney.amount,
            currency: parsedMoney.currency,
            product_url: productUrl,
            notes: lineNotes({ productUrl }),
          })
        );
      }
    }
    return dedupe(rows);
  }

  try {
    const host = location.hostname;
    if (/aliexpress\./i.test(host)) {
      if (document.querySelector(".order-detail-item")) {
        if (CANCELLED.test(firstText(document, [".order-status .order-block-title"])))
          return { ok: false, error: "This order is cancelled, so it has nothing to import." };
        return { ok: true, supplier: "AliExpress", rows: extractAliExpressDetails() };
      }
      const { urls, cancelled } = aliExpressDetailUrls();
      return { ok: true, supplier: "AliExpress", rows: [], detailUrls: urls, cancelled };
    }
    if (/(^|\.)amazon\./i.test(host))
      return { ok: true, supplier: "Amazon", rows: extractAmazon() };
    return { ok: false, error: "Open an AliExpress or Amazon order page first." };
  } catch (error) {
    return {
      ok: false,
      error: `The page could not be read: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
})();
