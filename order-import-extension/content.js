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
      ].join("\u001f");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function extractAliExpress() {
    const sourceUrl = location.href;
    const blocks = topLevel(
      nodesForFirstSelector(document, [
        ".order-item",
        ".order-item-wraper",
        "[data-pl=order-card]",
        "[class*=order--card]",
      ])
    );
    const rows = [];

    for (const block of blocks) {
      const blockText = text(block);
      const reference =
        orderReference(blockText) ||
        matchText(first(block, ['a[href*="orderId="]'])?.href, [/[?&]orderId=(\d+)/i]);
      const date = orderDate(blockText);
      const items = nodesForFirstSelector(block, [
        ".order-item-content-body",
        ".product-right",
        "[class*=order-item-content-item]",
        "[class*=order--item]",
      ]);

      for (const item of items.length ? topLevel(items) : [block]) {
        const itemText = text(item);
        const link = first(item, [
          ".order-item-content-info-name a",
          'a[href*="/item/"]',
          'a[href*="/product/"]',
        ]);
        const description =
          firstText(item, [
            ".order-item-content-info-name [title]",
            ".baobei-name[title]",
            ".order-item-content-info-name",
            "[class*=item-title]",
            "[class*=product-title]",
          ]) ||
          clean(link?.getAttribute("title")) ||
          text(link);
        const skuText = firstText(item, [
          ".order-item-content-info-sku",
          "[class*=item-sku]",
          "[class*=sku-info]",
        ]);
        const priceText = firstText(item, [
          ".order-item-content-info-number > div:first-child",
          ".product-amount span:first-child",
          "[class*=item-price]",
          "[class*=price]",
        ]);
        const parsedMoney = money(priceText);
        const productUrl = absoluteUrl(link?.getAttribute("href"));
        rows.push(
          baseRow("AliExpress", sourceUrl, {
            order_reference: reference,
            order_date: date,
            supplier_sku: aliItemId(productUrl),
            description,
            quantity:
              quantity(
                firstText(item, [
                  ".order-item-content-info-number-quantity",
                  ".product-amount",
                  "[class*=quantity]",
                ])
              ) ||
              quantity(itemText) ||
              "1",
            unit_price: parsedMoney.amount,
            currency: parsedMoney.currency,
            product_url: productUrl,
            notes: lineNotes({
              productUrl,
              extra: skuText && `Option: ${skuText.replace(/^(?:sku|variation)\s*:?\s*/i, "")}`,
            }),
          })
        );
      }
    }
    return dedupe(rows);
  }

  function amazonOrderId(card) {
    const slot =
      card.getAttribute("data-csa-c-slot-id") || card.getAttribute("data-order-id") || "";
    return (
      matchText(slot, [/order-card[.:]([A-Z0-9-]{10,})$/i]) ||
      orderReference(text(card)) ||
      matchText(first(card, ['a[href*="orderID="]'])?.href, [/[?&]orderID=([A-Z0-9-]+)/i])
    );
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
    const detailItems = [...document.querySelectorAll('[data-component="purchasedItems"]')];
    if (detailItems.length) return extractAmazonDetails(detailItems);

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

  function normalizedHeader(value) {
    return clean(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function columnIndex(headers, names) {
    return headers.findIndex((header) =>
      names.some((name) => header === name || header.includes(name))
    );
  }

  function extractDigiKeyTable(table, order) {
    const headerRow =
      table.querySelector("thead tr") ||
      [...table.querySelectorAll("tr")].find((row) => row.querySelector("th"));
    if (!headerRow) return [];
    const headers = [...headerRow.children].map((cell) => normalizedHeader(cell.textContent));
    const columns = {
      quantity: columnIndex(headers, ["quantity", "qty ordered", "qty"]),
      sku: columnIndex(headers, ["digikey part number", "digi key part number", "part number"]),
      mpn: columnIndex(headers, ["manufacturer part number", "manufacturer pn", "mfr part"]),
      description: columnIndex(headers, ["description", "product description"]),
      price: columnIndex(headers, ["unit price", "price each"]),
      reference: columnIndex(headers, ["customer reference", "reference"]),
    };
    if (columns.description < 0 || (columns.sku < 0 && columns.mpn < 0)) return [];

    const rows = [];
    for (const tr of table.querySelectorAll("tbody tr")) {
      const cells = [...tr.children];
      const cell = (index) => (index >= 0 ? text(cells[index]) : "");
      const link = first(tr, ['a[href*="/en/products/detail/"]', 'a[href*="/product-detail/"]']);
      const parsedMoney = money(cell(columns.price));
      const customerReference = cell(columns.reference);
      const description = [
        cell(columns.description),
        customerReference && `Customer reference: ${customerReference}`,
      ]
        .filter(Boolean)
        .join(" — ");
      const productUrl = absoluteUrl(link?.getAttribute("href"));
      rows.push(
        baseRow("DigiKey", location.href, {
          ...order,
          supplier_sku: cell(columns.sku),
          part_number: cell(columns.mpn),
          description,
          quantity: cell(columns.quantity).match(/\d+(?:\.\d+)?/)?.[0] || "",
          purchase_unit: "each",
          pack_quantity: "1",
          unit: "pcs",
          unit_price: parsedMoney.amount,
          currency: parsedMoney.currency,
          product_url: productUrl,
          notes: lineNotes({ productUrl }),
        })
      );
    }
    return rows;
  }

  function extractDigiKey() {
    const pageText = text(document.body);
    const order = {
      order_reference: orderReference(pageText),
      order_date: orderDate(pageText),
    };
    const tableRows = [...document.querySelectorAll("table")].flatMap((table) =>
      extractDigiKeyTable(table, order)
    );
    if (tableRows.length) return dedupe(tableRows);

    const rows = [];
    const items = topLevel(
      nodesForFirstSelector(document, [
        '[data-testid*="line-item"]',
        "[class*=order-line-item]",
        "[class*=orderLineItem]",
      ])
    );
    for (const item of items) {
      const itemText = text(item);
      const link = first(item, ['a[href*="/en/products/detail/"]', 'a[href*="/product-detail/"]']);
      const price = money(
        firstText(item, ["[class*=unit-price]", "[data-testid*=unit-price]", "[class*=price]"])
      );
      const productUrl = absoluteUrl(link?.getAttribute("href"));
      rows.push(
        baseRow("DigiKey", location.href, {
          ...order,
          supplier_sku: firstText(item, ["[data-testid*=part-number]", "[class*=part-number]"]),
          part_number: firstText(item, [
            "[data-testid*=manufacturer-part]",
            "[class*=manufacturer-part]",
          ]),
          description:
            firstText(item, ["[data-testid*=description]", "[class*=description]"]) || text(link),
          quantity: quantity(itemText),
          purchase_unit: "each",
          pack_quantity: "1",
          unit: "pcs",
          unit_price: price.amount,
          currency: price.currency,
          product_url: productUrl,
          notes: lineNotes({ productUrl }),
        })
      );
    }
    return dedupe(rows);
  }

  try {
    const host = location.hostname;
    if (/aliexpress\./i.test(host))
      return { ok: true, supplier: "AliExpress", rows: extractAliExpress() };
    if (/digikey\./i.test(host)) return { ok: true, supplier: "DigiKey", rows: extractDigiKey() };
    if (/(^|\.)amazon\./i.test(host))
      return { ok: true, supplier: "Amazon", rows: extractAmazon() };
    return { ok: false, error: "Open an AliExpress, DigiKey, or Amazon order page first." };
  } catch (error) {
    return {
      ok: false,
      error: `The page could not be read: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
})();
