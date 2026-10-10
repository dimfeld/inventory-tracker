import type { Database } from "bun:sqlite";
import { money, multiply, type Money } from "#lib/money.ts";
import { listSupplierParts } from "#lib/server/db/catalog.ts";
import { listLatestSkuPurchases, type PricedSkuPurchase } from "#lib/server/db/orders.ts";
import type { StockOption } from "#lib/stock-packing.ts";

/** A supplier SKU of a pieces part with a stock size, and the price of one stock piece. */
export interface StockSku {
  supplier: string;
  sku: string;
  lengthMm: number;
  widthMm: number | null;
  /** Price of one stock piece from the latest priced purchase of the SKU, or null. */
  price: Money | null;
  purchase: PricedSkuPurchase | null;
}

/**
 * The stock sizes that a pieces part can be bought in: its supplier SKUs with a stock size.
 * The price of a piece is the purchase unit price ÷ the pack size. Prices in different
 * currencies cannot be compared, so then no option has a price to compare and stock is chosen
 * by waste.
 */
export function listStockOptions(db: Database, partId: number): StockOption<StockSku>[] {
  const purchases = new Map(
    listLatestSkuPurchases(db, [partId]).map((p) => [`${p.supplier}\n${p.supplierSku}`, p])
  );
  const skus = listSupplierParts(db, partId).flatMap((sku): StockSku[] => {
    if (sku.stockLengthMm === null) return [];
    const purchase = purchases.get(`${sku.supplier}\n${sku.sku}`) ?? null;
    return [
      {
        supplier: sku.supplier,
        sku: sku.sku,
        lengthMm: sku.stockLengthMm,
        widthMm: sku.stockWidthMm,
        price: purchase
          ? multiply(money(purchase.unitPrice, purchase.currency), 1, purchase.packQuantity)
          : null,
        purchase,
      },
    ];
  });
  const currencies = new Set(skus.flatMap((sku) => (sku.price ? [sku.price.currency] : [])));
  return skus.map((stock) => ({
    stock,
    lengthMm: stock.lengthMm,
    widthMm: stock.widthMm,
    price:
      stock.price && currencies.size === 1
        ? Number(stock.price.amount.num) / Number(stock.price.amount.den)
        : null,
  }));
}
