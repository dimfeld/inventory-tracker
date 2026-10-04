# Inventory Order Import browser extension

This unpacked Manifest V3 extension reads visible order lines from AliExpress, DigiKey, and Amazon order pages. It creates CSV and copies it to the clipboard for the inventory app's paste import.

## Install in Chrome or Edge

1. Open `chrome://extensions` in Chrome or `edge://extensions` in Edge.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Select this `order-import-extension` directory.

## Use

1. Sign in to a supported store.
2. Open an order history or order details page. Make sure the order lines that you need are visible. Expand collapsed orders when applicable.
3. Select the extension icon.
4. Select **Extract and copy CSV**.
5. Review the CSV preview.
6. Paste the CSV into the inventory app's order import field.

The extension reads only the active tab after you select its button. It does not store data or send data over the network.

## CSV columns

| Column            | Meaning                                                |
| ----------------- | ------------------------------------------------------ |
| `supplier`        | AliExpress, DigiKey, or Amazon                         |
| `order_reference` | Store order number                                     |
| `description`     | Product title or description                           |
| `quantity`        | Number of purchase units                               |
| `purchase_unit`   | How the supplier sells the item, when known            |
| `pack_quantity`   | Base units in one purchase unit; blank when ambiguous  |
| `unit`            | Base unit, when known                                  |
| `manufacturer`    | Manufacturer, when shown                               |
| `part_number`     | Manufacturer part number, when shown                   |
| `supplier_sku`    | Store SKU, DigiKey part number, or Amazon ASIN         |
| `unit_price`      | Numeric price for one purchased line unit when shown   |
| `currency`        | ISO currency code inferred from the displayed price    |
| `notes`           | Displayed order date, product options, and product URL |

## Expected limitations

- Store markup changes often. The extractors use current selectors and text fallbacks, but a site update can require selector changes in `content.js`.
- The extension reads the current page only. Use each site's pagination or filters to expose other orders.
- A CSV can contain several order references. The app creates a separate import for each new order and skips references that already exist.
- Amazon order history does not always show a per-item price. That field stays blank when the card does not contain one.
- A store can localize labels and date formats. The extension preserves displayed date text so the app can review it during import.
- Always review the preview. Product bundles and option text can make pack quantity ambiguous, so the extension does not guess it.
