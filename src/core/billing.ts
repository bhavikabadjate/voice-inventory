// Prices and bills. Money is kept in paise (integers) so totals never pick up
// floating-point errors. Only selling price is used here: cost price never
// reaches a quote or a bill.

import { convert, Unit } from './units';

export interface Product {
  id: string;
  names: string[];
  /** Unit the selling price is quoted per, e.g. 'l' for ₹56 per litre. */
  unit: Unit;
  sellPaise: number;
  costPaise: number;
  /** Stock on hand, in `unit`. */
  stock: number;
  expiry?: string;
}

export interface BillLine {
  product: Product;
  qty: number;
  unit: Unit;
  /** Quantity converted to the product's unit. */
  qtyInProductUnit: number;
  amountPaise: number;
}

export type QuoteResult =
  | { ok: true; line: BillLine }
  | { ok: false; reason: 'unit_mismatch'; product: Product; unit: Unit };

/** Price of `qty` `unit` of a product, e.g. 150 g of ragi priced per kg. */
export function quote(product: Product, qty: number, unit: Unit = product.unit): QuoteResult {
  const qtyInProductUnit = convert(qty, unit, product.unit);
  if (qtyInProductUnit === null) return { ok: false, reason: 'unit_mismatch', product, unit };
  return {
    ok: true,
    line: {
      product,
      qty,
      unit,
      qtyInProductUnit,
      amountPaise: Math.round(product.sellPaise * qtyInProductUnit),
    },
  };
}

export interface Bill {
  lines: BillLine[];
  totalPaise: number;
  /** Total rounded to the nearest rupee, the amount the customer pays. */
  payablePaise: number;
}

export function makeBill(lines: BillLine[]): Bill {
  const totalPaise = lines.reduce((sum, l) => sum + l.amountPaise, 0);
  return { lines, totalPaise, payablePaise: Math.round(totalPaise / 100) * 100 };
}

/** "₹12", "₹12.50". */
export function formatRupees(paise: number): string {
  const rupees = paise / 100;
  return `₹${Number.isInteger(rupees) ? rupees : rupees.toFixed(2)}`;
}
