// What needs the shopkeeper's attention: items expiring soon (or already
// expired) and items running low.

import type { Product } from './billing';

/** Expiry warnings start this many days ahead. */
export const EXPIRY_WARNING_DAYS = 7;

export interface ExpiryAlert {
  product: Product;
  /** Negative when already expired. */
  daysLeft: number;
}

export interface Alerts {
  expiring: ExpiryAlert[];
  lowStock: Product[];
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function daysUntil(isoDate: string, today: Date): number {
  const [y, m, d] = isoDate.split('-').map(Number);
  return Math.round((new Date(y, m - 1, d).getTime() - startOfDay(today)) / 86_400_000);
}

/**
 * A product is low when stock is at or below its own alert level, or has run
 * out when it has no alert level set.
 */
export function isLowStock(p: Product): boolean {
  return p.lowStockAt !== undefined ? p.stock <= p.lowStockAt : p.stock <= 0;
}

export function findAlerts(products: Product[], today: Date): Alerts {
  const expiring = products
    .filter((p) => p.expiry && p.stock > 0)
    .map((p) => ({ product: p, daysLeft: daysUntil(p.expiry!, today) }))
    .filter((a) => a.daysLeft <= EXPIRY_WARNING_DAYS)
    .sort((a, b) => a.daysLeft - b.daysLeft);
  const lowStock = products.filter(isLowStock).sort((a, b) => a.stock - b.stock);
  return { expiring, lowStock };
}

export function alertCount(a: Alerts): number {
  return a.expiring.length + a.lowStock.length;
}
