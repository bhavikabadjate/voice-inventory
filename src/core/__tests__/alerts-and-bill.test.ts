import { describe, expect, it } from 'vitest';

import { findAlerts } from '../alerts';
import { billHtml, upiLink, type Shop } from '../bill-document';
import { makeBill, quote, type Product } from '../billing';
import { converse, initialState } from '../conversation';

const today = new Date(2026, 9, 10);
const milk: Product = {
  id: 'milk', names: ['Milk', 'dudh'], unit: 'l', sellPaise: 5600, costPaise: 4800, stock: 20, expiry: '2026-10-12',
};
const bread: Product = {
  id: 'bread', names: ['Bread'], unit: 'custom:packet', sellPaise: 3500, costPaise: 3000, stock: 4, expiry: '2026-10-09',
};
const sugar: Product = {
  id: 'sugar', names: ['Sugar'], unit: 'kg', sellPaise: 4400, costPaise: 4000, stock: 3, lowStockAt: 5,
};
const rice: Product = { id: 'rice', names: ['Rice'], unit: 'kg', sellPaise: 6000, costPaise: 5000, stock: 0 };
const atta: Product = { id: 'atta', names: ['Atta'], unit: 'kg', sellPaise: 4200, costPaise: 3600, stock: 40, expiry: '2027-01-01' };
const products = [milk, bread, sugar, rice, atta];

describe('alerts', () => {
  it('lists items expiring within a week, soonest first', () => {
    const { expiring } = findAlerts(products, today);
    expect(expiring.map((a) => [a.product.id, a.daysLeft])).toEqual([['bread', -1], ['milk', 2]]);
  });
  it('lists items at their alert level, or out of stock', () => {
    expect(findAlerts(products, today).lowStock.map((p) => p.id)).toEqual(['rice', 'sugar']);
  });
  it('ignores expiry on items with no stock left', () => {
    expect(findAlerts([{ ...milk, stock: 0 }], today).expiring).toEqual([]);
  });
  it('answers by voice', () => {
    const ask = (text: string) => converse(text, initialState, products, today).say;
    expect(ask('kya expire hone wala hai')).toBe(
      'जल्दी एक्सपायर होने वाले: Bread (एक्सपायर हो गया), Milk (2 दिन)।',
    );
    expect(ask('kya khatam ho raha hai')).toBe('खत्म होने वाले: Rice 0 किलो, Sugar 3 किलो।');
    expect(converse('alerts', initialState, [atta], today).say).toBe('Nothing is expiring or running low.');
  });
});

describe('bill document', () => {
  const shop: Shop = { name: 'Sharma Kirana', upiId: 'sharma@okaxis', phone: '98765 43210' };
  const lines = [quote(milk, 1, 'l'), quote(sugar, 250, 'g')].map((q) => {
    if (!q.ok) throw new Error('quote failed');
    return q.line;
  });
  const bill = makeBill(lines);

  it('makes a UPI link for the rounded total', () => {
    expect(upiLink(shop, bill.payablePaise, 'Bill 1')).toBe(
      'upi://pay?pa=sharma%40okaxis&pn=Sharma%20Kirana&am=67.00&cu=INR&tn=Bill%201',
    );
  });
  it('shows items, selling prices, total and a QR code, never cost', () => {
    const html = billHtml(shop, bill, new Date(2026, 9, 10, 18, 30), 'en');
    expect(html).toContain('Sharma Kirana');
    expect(html).toContain('₹56/litre');
    expect(html).toContain('<td class="n">₹67</td>');
    expect(html).toContain('<svg');
    expect(html).not.toContain('₹48');
    expect(html).not.toContain('₹40');
  });
  it('leaves out the QR code without a UPI ID', () => {
    expect(billHtml({ ...shop, upiId: '' }, bill, today, 'hi')).not.toContain('<svg');
  });
  it('escapes shop details', () => {
    expect(billHtml({ ...shop, name: '<b>A&B</b>' }, bill, today)).toContain('&#60;b&#62;A&#38;B');
  });
});
