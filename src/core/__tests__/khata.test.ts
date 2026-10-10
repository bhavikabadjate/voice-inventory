import { describe, expect, it } from 'vitest';

import type { Product } from '../billing';
import { converse, initialState, type ConversationState, type Turn } from '../conversation';
import { findCustomers, owing, reminderLink, reminderText, whatsappNumber, type Customer } from '../khata';
import { parseCommand } from '../parse';

const milk: Product = { id: 'milk', names: ['Milk', 'dudh'], unit: 'l', sellPaise: 5600, costPaise: 4800, stock: 20 };
const sugar: Product = { id: 'sugar', names: ['Sugar', 'cheeni'], unit: 'kg', sellPaise: 4400, costPaise: 4000, stock: 10 };
const products = [milk, sugar];

const ramesh: Customer = { id: 'c1', name: 'Ramesh Patil', phone: '98765 43210', balancePaise: 30000 };
const suresh: Customer = { id: 'c2', name: 'Suresh', phone: '', balancePaise: 20000 };
const sunita: Customer = { id: 'c3', name: 'Sunita', phone: '', balancePaise: 0 };
const customers = [ramesh, suresh, sunita];
const today = new Date(2026, 9, 10);

function talk(lines: string[], start: ConversationState = initialState): Turn[] {
  let state = start;
  return lines.map((line) => {
    const t = converse(line, state, products, today, customers);
    state = t.state;
    return t;
  });
}

describe('understanding udhaar', () => {
  it.each([
    ['Ramesh ke khate mein 200 likho', 'gave', 'ramesh', 200],
    ['Ramesh ko 200 udhaar diya', 'gave', 'ramesh', 200],
    ['add 200 to Ramesh khata', 'gave', 'ramesh', 200],
    ['Ramesh ne 100 jama kiye', 'got', 'ramesh', 100],
    ['Ramesh ne 100 diye', 'got', 'ramesh', 100],
    ['Ramesh se 100 mile', 'got', 'ramesh', 100],
    ['Ramesh paid 100', 'got', 'ramesh', 100],
    ['रमेश के खाते में 200 लिखो', 'gave', 'रमेश', 200],
    ['Ramesh chya khatyat 200 liha', 'gave', 'ramesh', 200],
    ['रमेशच्या खात्यात 200 लिहा', 'gave', 'रमेश', 200],
    ['रमेशकडून 100 जमा', 'got', 'रमेश', 100],
  ])('"%s"', (text, direction, name, rupees) => {
    expect(parseCommand(text)).toMatchObject({ kind: 'khataAdd', direction, name, rupees });
  });

  it('asks about one customer or everyone', () => {
    expect(parseCommand('Ramesh ka kitna baki hai')).toMatchObject({ kind: 'khataBalance', name: 'ramesh' });
    expect(parseCommand('Ramesh ka udhaar kitna hai')).toMatchObject({ kind: 'khataBalance', name: 'ramesh' });
    expect(parseCommand('sabse zyada udhaar kiska hai')).toMatchObject({ kind: 'khataList' });
    expect(parseCommand('who owes')).toMatchObject({ kind: 'khataList' });
  });

  it('leaves products alone', () => {
    expect(parseCommand('2 kilo cheeni ka kitna hua')).toMatchObject({ kind: 'price' });
    expect(parseCommand('10 kilo cheeni aayi')).toMatchObject({ kind: 'restock' });
  });
});

describe('khata by voice', () => {
  it('writes udhaar for a known customer by first name', () => {
    const [t1, t2] = talk(['Ramesh ke khate mein 200 likho', 'haan']);
    expect(t1.say).toBe('Ramesh Patil के खाते में ₹200 उधार लिखूँ? कुल ₹500 बाकी होगा।');
    expect(t2.action).toEqual({ type: 'khata', customerId: 'c1', name: 'Ramesh Patil', amountPaise: 20000 });
  });

  it('records a payment', () => {
    const [t1, t2] = talk(['Ramesh ne 100 jama kiye', 'haan']);
    expect(t1.say).toBe('Ramesh Patil से ₹100 जमा करूँ? ₹200 बाकी रहेगा।');
    expect(t2.action).toMatchObject({ type: 'khata', customerId: 'c1', amountPaise: -10000 });
  });

  it('opens a khata for a new customer', () => {
    const [t1, t2] = talk(['add 150 to Mohan khata', 'yes']);
    expect(t1.say).toBe('Mohan is a new customer. Open a khata and write ₹150 udhaar?');
    expect(t2.action).toEqual({ type: 'khata', customerId: null, name: 'Mohan', amountPaise: 15000 });
  });

  it("won't take a payment from someone without a khata", () => {
    expect(talk(['Mohan ne 100 diye'])[0].say).toBe('Mohan का कोई खाता नहीं है।');
  });

  it('asks which customer when the name fits several', () => {
    const many = [...customers, { id: 'c4', name: 'Ramesh Shah', phone: '', balancePaise: 0 }];
    const t = converse('Ramesh ka kitna baki hai', initialState, products, today, many);
    expect(t.say).toBe('कौन से? Ramesh Patil, Ramesh Shah।');
  });

  it('asks for the amount when none was said', () => {
    const [t1, t2, t3] = talk(['Suresh ka udhaar likho', '50', 'haan']);
    expect(t1.say).toBe('Suresh का कितना?');
    expect(t2.say).toBe('Suresh के खाते में ₹50 उधार लिखूँ? कुल ₹250 बाकी होगा।');
    expect(t3.action).toMatchObject({ type: 'khata', customerId: 'c2', amountPaise: 5000 });
  });

  it('puts the bill just quoted on a khata and records the sale', () => {
    const turns = talk(['1 litre dudh aur 2 kilo cheeni ka kitna hua', 'isko Suresh ke khate mein daalo', 'haan']);
    expect(turns[1].say).toBe('यह ₹144 का बिल Suresh के खाते में डालूँ? कुल ₹344 बाकी होगा।');
    expect(turns[2].action).toMatchObject({
      type: 'sell',
      lines: [{ productId: 'milk', qty: 1 }, { productId: 'sugar', qty: 2 }],
      credit: { customerId: 'c2', name: 'Suresh', amountPaise: 14400 },
    });
    // The bill is closed, so it can't be recorded twice.
    expect(turns[2].state.lastBill).toBeNull();
  });

  it('answers what someone owes and who owes most', () => {
    expect(talk(['Ramesh ka kitna baki hai'])[0].say).toBe('Ramesh Patil का ₹300 बाकी है।');
    expect(talk(['Sunita ka kitna baki hai'])[0].say).toBe('Sunita का कुछ बाकी नहीं है।');
    expect(talk(['cheeni kitni baki hai'])[0].say).toBe('Sugar: 10 किलो बचा है।');
    expect(talk(['sabse zyada udhaar kiska hai'])[0].say).toBe('उधार: Ramesh Patil ₹300, Suresh ₹200। कुल ₹500।');
  });
});

describe('khata helpers', () => {
  it('matches names across scripts and by first name', () => {
    expect(findCustomers('रमेश', customers).map((c) => c.id)).toEqual(['c1']);
    expect(findCustomers('ramesh patil', customers).map((c) => c.id)).toEqual(['c1']);
    expect(findCustomers('mohan', customers)).toEqual([]);
  });

  it('lists only people who owe, biggest first', () => {
    expect(owing(customers).map((c) => c.id)).toEqual(['c1', 'c2']);
  });

  it('builds a WhatsApp reminder with a UPI link', () => {
    expect(whatsappNumber('98765 43210')).toBe('919876543210');
    expect(whatsappNumber('+91 98765-43210')).toBe('919876543210');
    expect(whatsappNumber('12345')).toBeNull();
    const shop = { name: 'Sharma Kirana', upiId: 'sharma@okaxis', phone: '' };
    const text = reminderText(shop, ramesh, 'hi');
    expect(text).toContain('नमस्ते Ramesh Patil जी, Sharma Kirana में आपका ₹300 बाकी है।');
    expect(text).toContain('upi://pay?pa=sharma%40okaxis&pn=Sharma%20Kirana&am=300.00');
    expect(reminderLink(shop, ramesh, 'hi')).toMatch(/^https:\/\/wa\.me\/919876543210\?text=/);
    expect(reminderLink(shop, suresh, 'hi')).toBeNull();
  });
});
