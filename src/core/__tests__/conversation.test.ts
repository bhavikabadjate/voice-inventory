import { describe, expect, it } from 'vitest';

import type { Product } from '../billing';
import { converse, initialState, parseExpiry, type ConversationState, type Turn } from '../conversation';

const milk: Product = {
  id: 'milk', names: ['Milk', 'dudh', 'दूध'], unit: 'l', sellPaise: 5600, costPaise: 4800, stock: 20,
};
const sugar: Product = {
  id: 'sugar', names: ['Sugar', 'cheeni'], unit: 'kg', sellPaise: 4400, costPaise: 4000, stock: 1,
};
const products = [milk, sugar];
const today = new Date(2026, 9, 10);

/** Say each line in turn and return every reply. */
function talk(lines: string[], start: ConversationState = initialState): Turn[] {
  let state = start;
  return lines.map((line) => {
    const t = converse(line, state, products, today);
    state = t.state;
    return t;
  });
}

describe('adding a new product', () => {
  it('asks for each detail, then saves', () => {
    const turns = talk(['Paneer add karo', '2 kilo', '300', '360', 'nahi', 'haan']);
    expect(turns.map((t) => t.say)).toEqual([
      'Paneer कितना आया? जैसे 20 लीटर।',
      'खरीद का रेट कितना है, प्रति किलो?',
      'बेचने का रेट कितना है, प्रति किलो?',
      'एक्सपायरी डेट बतानी है? नहीं तो "नहीं" बोलिए।',
      'Paneer, 2 किलो, खरीद ₹300, बिक्री ₹360। सेव करूँ?',
      'सेव हो गया।',
    ]);
    expect(turns[5].action).toEqual({
      type: 'create',
      product: { names: ['Paneer'], unit: 'kg', stock: 2, costPaise: 30000, sellPaise: 36000 },
    });
  });

  it('asks for a unit when none is given and keeps an expiry date', () => {
    const turns = talk(['add bread', '10', 'packet', '30', '35', '15/10', 'yes']);
    expect(turns[1].say).toBe('In what unit? Litre, kilo or piece?');
    expect(turns[5].say).toContain('expiry 15/10/2026');
    expect(turns[6].action).toMatchObject({ type: 'create', product: { unit: 'custom:packet', expiry: '2026-10-15' } });
  });

  it('never asks or says the cost to staff who may not see it', () => {
    const turns = talk(['Paneer add karo', '2 kilo', '360', 'nahi', 'haan'], { ...initialState, askCost: false });
    expect(turns[1].say).toBe('बेचने का रेट कितना है, प्रति किलो?');
    expect(turns[3].say).toBe('Paneer, 2 किलो, बिक्री ₹360। सेव करूँ?');
    expect(turns[4].action).toMatchObject({ type: 'create', product: { costPaise: 0, sellPaise: 36000 } });
  });

  it('can be cancelled', () => {
    const turns = talk(['Paneer add karo', 'nahi']);
    expect(turns[1].say).toBe('ठीक है, रद्द कर दिया।');
    expect(turns[1].state.flow.step).toBe('idle');
  });
});

describe('adding stock to an existing product', () => {
  it('only confirms the selling price, never says cost', () => {
    const turns = talk(['Milk add karo', '10 litre', 'haan']);
    expect(turns[0].say).toBe('Milk पहले से है, ₹56 प्रति लीटर। कितना आया?');
    expect(turns[1].say).toBe('बेचने का रेट ₹56 ही रहेगा?');
    expect(turns[2].action).toEqual({ type: 'restock', items: [{ productId: 'milk', qty: 10 }] });
    expect(turns.map((t) => t.say).join(' ')).not.toContain('48');
  });

  it('takes a new selling price', () => {
    const turns = talk(['20 litre dudh aaya', 'nahi', '58']);
    expect(turns[2].action).toEqual({ type: 'restock', items: [{ productId: 'milk', qty: 20 }], sellPaise: 5800 });
  });

  it('converts units, e.g. 500 ml of milk', () => {
    const turns = talk(['500 ml dudh aaya', 'haan']);
    expect(turns[1].action).toEqual({ type: 'restock', items: [{ productId: 'milk', qty: 0.5 }] });
  });

  it('treats stock for an unknown product as a new product', () => {
    const turns = talk(['5 kilo besan aaya']);
    expect(turns[0].say).toBe('खरीद का रेट कितना है, प्रति किलो?');
  });
});

describe('selling', () => {
  it('confirms a sale and warns when stock is short', () => {
    const turns = talk(['2 litre dudh aur 2 kilo cheeni becha', 'haan']);
    expect(turns[0].say).toBe(
      'ध्यान दें, Sugar का स्टॉक सिर्फ़ 1 किलो है। 2 लीटर Milk ₹112, 2 किलो Sugar ₹88। कुल ₹200। बिक्री सेव करूँ?',
    );
    expect(turns[1].action).toEqual({
      type: 'sell',
      lines: [
        { productId: 'milk', qty: 2, sellPaise: 5600, amountPaise: 11200 },
        { productId: 'sugar', qty: 2, sellPaise: 4400, amountPaise: 8800 },
      ],
    });
  });

  it('turns the last bill into a sale with "bill pakka karo"', () => {
    const turns = talk(['1 litre milk aur 1 kilo sugar ka kitna hua', 'bill pakka karo']);
    expect(turns[1].say).toBe('बिल पक्का। ₹100 की बिक्री सेव हो गई।');
    expect(turns[1].action).toMatchObject({ type: 'sell', lines: [{ productId: 'milk' }, { productId: 'sugar' }] });
    expect(turns[1].state.lastBill).toBeNull();
  });

  it('closes the open bill once a sale is saved', () => {
    const turns = talk(['1 litre milk ka kitna hua', '1 litre milk becha', 'haan', 'bill pakka karo']);
    expect(turns[2].state.lastBill).toBeNull();
    expect(turns[3].action).toBeUndefined();
  });

  it('asks for a bill first when there is none', () => {
    expect(talk(['bill pakka karo'])[0].say).toBe('पहले बिल बनाइए, जैसे "1 लीटर दूध और 2 किलो चीनी"।');
  });
});

describe('prices and stock', () => {
  it('changes a selling price after confirming', () => {
    const turns = talk(['dudh ka rate 58 kar do', 'haan']);
    expect(turns[0].say).toBe('Milk का रेट ₹56 से ₹58 करूँ?');
    expect(turns[1].action).toEqual({ type: 'setPrice', productId: 'milk', sellPaise: 5800 });
  });

  it('answers stock questions in Marathi', () => {
    expect(talk(['दूध किती शिल्लक आहे'])[0].say).toBe('Milk: 20 लिटर शिल्लक आहे.');
  });

  it('a new command replaces a pending confirmation', () => {
    const turns = talk(['dudh ka rate 58 kar do', 'cheeni kitne ka hai']);
    expect(turns[1].say).toBe('cheeni ₹44 प्रति किलो है।');
    expect(turns[1].action).toBeUndefined();
  });
});

describe('expiry dates', () => {
  it('reads common forms', () => {
    expect(parseExpiry('2026-11-02', today)).toBe('2026-11-02');
    expect(parseExpiry('31/10/26', today)).toBe('2026-10-31');
    expect(parseExpiry('5 november', today)).toBe('2026-11-05');
    expect(parseExpiry('10 din', today)).toBe('2026-10-20');
    expect(parseExpiry('kal', today)).toBeNull();
  });
});
