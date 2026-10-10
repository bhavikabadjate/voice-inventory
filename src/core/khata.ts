// Customer khata (udhaar ledger). Every entry is kept forever: a mistake is
// fixed with a new entry the other way, so the history can't be quietly
// changed. A positive amount is udhaar given (the customer owes more), a
// negative amount is a payment received.

import { upiLink, type Shop } from './bill-document';
import { formatRupees } from './billing';
import { findProducts } from './names';
import type { Lang } from './units';

export interface Customer {
  id: string;
  name: string;
  phone: string;
  /** What the customer owes now, in paise. Negative means the shop owes them. */
  balancePaise: number;
}

export interface KhataEntry {
  id: string;
  customerId: string;
  amountPaise: number;
  note: string;
  /** The bill this udhaar came from, if any. */
  billId: string | null;
  at: string;
}

/**
 * Customers matching a spoken name. A full name ("Ramesh Patil") picks that
 * customer; a first name alone ("Ramesh") finds everyone called Ramesh.
 */
export function findCustomers(query: string, customers: Customer[]): Customer[] {
  const named = customers.map((c) => ({ id: c.id, names: [c.name], customer: c }));
  const full = findProducts(query, named);
  const fullExact = full.filter((m) => m.exact).map((m) => m.product.customer);
  const words = query.trim().split(/\s+/);
  if (words.length > 1 && fullExact.length) return fullExact;
  const byFirst = findProducts(
    words[0] ?? '',
    named.map((n) => ({ ...n, names: [n.customer.name.trim().split(/\s+/)[0] ?? ''] })),
  )
    .filter((m) => m.exact)
    .map((m) => m.product.customer);
  const exact = new Set([...fullExact, ...byFirst]);
  return exact.size ? customers.filter((c) => exact.has(c)) : full.map((m) => m.product.customer);
}

/** Customers who owe something, biggest first. */
export function owing(customers: Customer[]): Customer[] {
  return customers.filter((c) => c.balancePaise > 0).sort((a, b) => b.balancePaise - a.balancePaise);
}

/** "Ramesh" → "Ramesh", "ramesh patil" → "Ramesh Patil". */
export function nameCase(name: string): string {
  return name.trim().replace(/(^|\s)([a-z])/g, (_, s: string, c: string) => s + c.toUpperCase());
}

/** Digits of an Indian mobile number with the country code, for a WhatsApp link. */
export function whatsappNumber(phone: string): string | null {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return digits;
  if (digits.length === 11 && digits.startsWith('0')) return `91${digits.slice(1)}`;
  return null;
}

const REMINDER = {
  en: (n: string, shop: string, amt: string) => `Hello ${n}, your pending amount at ${shop} is ${amt}.`,
  hi: (n: string, shop: string, amt: string) => `नमस्ते ${n} जी, ${shop} में आपका ${amt} बाकी है।`,
  mr: (n: string, shop: string, amt: string) => `नमस्कार ${n}, ${shop} मध्ये तुमचे ${amt} बाकी आहेत.`,
};

const PAY = {
  en: (id: string) => `Pay by UPI to ${id}:`,
  hi: (id: string) => `UPI से भुगतान करें: ${id}`,
  mr: (id: string) => `UPI ने पैसे भरा: ${id}`,
};

const THANKS = { en: 'Thank you!', hi: 'धन्यवाद!', mr: 'धन्यवाद!' };

/** The WhatsApp message reminding a customer what they owe, with a UPI pay link. */
export function reminderText(shop: Shop, customer: Customer, lang: Lang): string {
  const amount = formatRupees(customer.balancePaise);
  const lines = [REMINDER[lang](customer.name, shop.name.trim() || 'our shop', amount)];
  if (shop.upiId.trim()) {
    lines.push(PAY[lang](shop.upiId.trim()));
    lines.push(upiLink(shop, customer.balancePaise, `Khata ${customer.name}`));
  }
  lines.push(THANKS[lang]);
  return lines.join('\n');
}

/** Link that opens WhatsApp with the reminder ready to send, or null without a usable phone number. */
export function reminderLink(shop: Shop, customer: Customer, lang: Lang): string | null {
  const number = whatsappNumber(customer.phone);
  if (!number) return null;
  return `https://wa.me/${number}?text=${encodeURIComponent(reminderText(shop, customer, lang))}`;
}
