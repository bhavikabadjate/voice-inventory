import { describe, expect, it } from 'vitest';

import { answer } from '../assistant';
import { makeBill, Product, quote } from '../billing';
import { findProducts, soundKey } from '../names';
import { parseCommand } from '../parse';
import { convert } from '../units';

const milk: Product = {
  id: 'milk', names: ['Milk', 'dudh', 'दूध'], unit: 'l', sellPaise: 5600, costPaise: 4800, stock: 20,
};
const sugar: Product = {
  id: 'sugar', names: ['Sugar', 'cheeni', 'sakhar', 'साखर'], unit: 'kg', sellPaise: 4400, costPaise: 4000, stock: 50,
};
const ragi: Product = {
  id: 'ragi', names: ['Ragi', 'nachni', 'नाचणी'], unit: 'kg', sellPaise: 8000, costPaise: 6500, stock: 10,
};
const biscuit: Product = {
  id: 'parle', names: ['Parle-G'], unit: 'custom:packet', sellPaise: 1000, costPaise: 850, stock: 40,
};
const products = [milk, sugar, ragi, biscuit];

const ask = (text: string) => answer(parseCommand(text), products);

describe('units', () => {
  it('converts within the same kind of unit', () => {
    expect(convert(500, 'ml', 'l')).toBe(0.5);
    expect(convert(150, 'g', 'kg')).toBeCloseTo(0.15);
    expect(convert(1, 'dozen', 'piece')).toBe(12);
  });
  it('refuses to convert between kinds', () => {
    expect(convert(2, 'kg', 'l')).toBeNull();
    expect(convert(2, 'custom:packet', 'kg')).toBeNull();
  });
});

describe('names', () => {
  it('gives every spelling and script of milk the same key', () => {
    const key = soundKey('dudh');
    for (const n of ['doodh', 'dhudh', 'दूध', 'Dudh']) expect(soundKey(n)).toBe(key);
  });
  it('matches across scripts', () => {
    expect(soundKey('साखर')).toBe(soundKey('sakhar'));
    expect(soundKey('चीनी')).toBe(soundKey('cheeni'));
  });
  it('finds a product by any of its names', () => {
    expect(findProducts('doodh', products)[0].product.id).toBe('milk');
    expect(findProducts('nachni', products)[0].product.id).toBe('ragi');
  });
  it('allows a one-letter slip on longer names', () => {
    const m = findProducts('sakkar', products);
    expect(m[0].product.id).toBe('sugar');
  });
});

describe('pricing', () => {
  it('prices part of a unit', () => {
    const q = quote(ragi, 150, 'g');
    expect(q.ok && q.line.amountPaise).toBe(1200);
  });
  it('bills several items and rounds only the total', () => {
    const lines = [quote(milk, 1, 'l'), quote(sugar, 2, 'kg'), quote(ragi, 125, 'g')].map((q) => {
      if (!q.ok) throw new Error('quote failed');
      return q.line;
    });
    const bill = makeBill(lines);
    expect(bill.totalPaise).toBe(5600 + 8800 + 1000);
    const odd = makeBill([{ ...lines[0], amountPaise: 1250 }]);
    expect(odd.payablePaise).toBe(1300);
  });
});

describe('parsing', () => {
  it('reads quantity and unit stuck to the number', () => {
    const c = parseCommand('1ltr milk and 2kg sugar ka kitna hua');
    expect(c).toMatchObject({
      kind: 'price',
      lang: 'hi',
      items: [
        { name: 'milk', qty: 1, unit: 'l' },
        { name: 'sugar', qty: 2, unit: 'kg' },
      ],
    });
  });
  it('reads number words and fractions', () => {
    const c = parseCommand('aadha kilo cheeni kitne ka');
    expect(c).toMatchObject({ kind: 'price', items: [{ name: 'cheeni', qty: 0.5, unit: 'kg' }] });
    const d = parseCommand('do litre dudh ka rate bata do');
    expect(d).toMatchObject({ kind: 'price', items: [{ name: 'dudh', qty: 2, unit: 'l' }] });
  });
  it('detects Marathi', () => {
    expect(parseCommand('दूध किती आहे').lang).toBe('mr');
  });
  it('recognises stock changes and questions', () => {
    expect(parseCommand('milk add karo')).toMatchObject({ kind: 'add', item: { name: 'milk' } });
    expect(parseCommand('10 kilo cheeni aayi')).toMatchObject({
      kind: 'restock', items: [{ name: 'cheeni', qty: 10, unit: 'kg' }],
    });
    expect(parseCommand('2 litre dudh bik gaya')).toMatchObject({
      kind: 'sell', items: [{ name: 'dudh', qty: 2, unit: 'l' }],
    });
    expect(parseCommand('dudh ka rate 58 kar do')).toMatchObject({ kind: 'setPrice', name: 'dudh', rupees: 58 });
    expect(parseCommand('cheeni kitni bachi hai')).toMatchObject({ kind: 'stock', name: 'cheeni' });
    expect(parseCommand('bill pakka karo').kind).toBe('confirmBill');
    expect(parseCommand('haan ji').kind).toBe('yes');
    expect(parseCommand('नाही').kind).toBe('no');
  });
});

describe('answers', () => {
  it('gives the selling price per unit and never the cost', () => {
    const a = ask('Milk kitne ka hai?');
    expect(a.text).toBe('Milk ₹56 प्रति लीटर है।');
    expect(a.text).not.toContain('48');
  });
  it('answers in English', () => {
    expect(ask('how much is milk').text).toBe('Milk is ₹56 per litre.');
  });
  it('answers in Marathi', () => {
    expect(ask('दूध किती आहे').text).toBe('दूध ₹56 प्रति लिटर आहे.');
  });
  it('prices a quantity', () => {
    expect(ask('2 ltr milk kitne ka hai').text).toBe('2 लीटर Milk ₹112.');
    expect(ask('500 ml dudh kitne ka').text).toBe('500 एमएल dudh ₹28.');
  });
  it('prices part of a kilo', () => {
    expect(ask('150g ragi how much').text).toBe('150 gram Ragi ₹12.');
  });
  it('makes a bill with a total', () => {
    const a = ask('1ltr milk and 2kg sugar ka kitna hua');
    expect(a.text).toBe('1 लीटर Milk ₹56, 2 किलो Sugar ₹88. कुल ₹144.');
    expect(a.kind === 'price' && a.bill?.payablePaise).toBe(14400);
  });
  it('asks when the unit does not fit the product', () => {
    expect(ask('2 kilo milk kitne ka').kind).toBe('clarify');
  });
  it('says when a product is missing', () => {
    expect(ask('paneer kitne ka hai').text).toBe('paneer नहीं मिला।');
  });
  it('prices custom units like packets', () => {
    expect(ask('3 packet parle-g how much').text).toBe('3 packet Parle-G ₹30.');
  });
});
