// The back-and-forth with the shopkeeper. Each thing they say goes through
// `converse`, which returns what to say back, the new conversation state and,
// once they confirm, an Action for the app to save.
//
//   You: Milk add karo          App: Milk कितना आया? जैसे 20 लीटर।
//   You: 20 litre               App: खरीद का रेट कितना है, प्रति लीटर?
//   You: 48                     App: बेचने का रेट कितना है, प्रति लीटर?
//   You: 56                     App: एक्सपायरी डेट बतानी है? ...
//   You: nahi                   App: Milk, 20 लीटर, खरीद ₹48, बिक्री ₹56। सेव करूँ?
//   You: haan                   App: सेव हो गया।          → Action: create
//
// Cost price is only ever spoken back while the shopkeeper is entering it.

import { findAlerts } from './alerts';
import { answer, qtyText, resolve, unknownAnswer } from './assistant';
import { Bill, BillLine, formatRupees, makeBill, Product } from './billing';
import { findProducts } from './names';
import { parseNumberWord } from './numbers';
import { Command, ItemRequest, parseCommand, tokenize } from './parse';
import { convert, Lang, parseUnit, Unit, unitLabel } from './units';

export type Action =
  | { type: 'create'; product: Omit<Product, 'id'> }
  | { type: 'restock'; items: { productId: string; qty: number }[]; sellPaise?: number }
  | { type: 'sell'; lines: { productId: string; qty: number; sellPaise: number; amountPaise: number }[] }
  | { type: 'setPrice'; productId: string; sellPaise: number };

interface NewProduct {
  name: string;
  qty?: number;
  unit?: Unit;
  costPaise?: number;
  sellPaise?: number;
}

type Flow =
  | { step: 'idle' }
  | { step: 'newQty'; draft: NewProduct }
  | { step: 'newUnit'; draft: NewProduct }
  | { step: 'newCost'; draft: NewProduct }
  | { step: 'newSell'; draft: NewProduct }
  | { step: 'newExpiry'; draft: NewProduct }
  | { step: 'restockQty'; product: Product }
  | { step: 'keepPrice'; product: Product; qty: number }
  | { step: 'newPrice'; product: Product; qty: number }
  | { step: 'confirm'; action: Action };

export interface ConversationState {
  lang: Lang;
  flow: Flow;
  /** Last bill quoted, so "bill pakka karo" can turn it into a sale. */
  lastBill: Bill | null;
  /** False for staff who may not see cost prices: the cost question is skipped. */
  askCost?: boolean;
}

export const initialState: ConversationState = { lang: 'hi', flow: { step: 'idle' }, lastBill: null };

export interface Turn {
  say: string;
  lang: Lang;
  state: ConversationState;
  action?: Action;
  bill?: Bill | null;
}

const T = {
  askQty: {
    en: (n: string) => `How much ${n} came in? For example, 20 litre.`,
    hi: (n: string) => `${n} कितना आया? जैसे 20 लीटर।`,
    mr: (n: string) => `${n} किती आलं? उदा. 20 लिटर.`,
  },
  askUnit: {
    en: () => 'In what unit? Litre, kilo or piece?',
    hi: () => 'किस में? लीटर, किलो या नग?',
    mr: () => 'कशात? लिटर, किलो की नग?',
  },
  askCost: {
    en: (u: string) => `What is the cost price per ${u}?`,
    hi: (u: string) => `खरीद का रेट कितना है, प्रति ${u}?`,
    mr: (u: string) => `खरेदीचा दर किती, प्रति ${u}?`,
  },
  askSell: {
    en: (u: string) => `What is the selling price per ${u}?`,
    hi: (u: string) => `बेचने का रेट कितना है, प्रति ${u}?`,
    mr: (u: string) => `विक्रीचा दर किती, प्रति ${u}?`,
  },
  askExpiry: {
    en: () => 'Any expiry date? Say "no" to skip.',
    hi: () => 'एक्सपायरी डेट बतानी है? नहीं तो "नहीं" बोलिए।',
    mr: () => 'एक्सपायरी तारीख सांगायची आहे? नसेल तर "नाही" म्हणा.',
  },
  confirmNew: {
    en: (d: string) => `${d}. Shall I save it?`,
    hi: (d: string) => `${d}। सेव करूँ?`,
    mr: (d: string) => `${d}. सेव करू?`,
  },
  cost: { en: 'cost', hi: 'खरीद', mr: 'खरेदी' },
  sell: { en: 'selling', hi: 'बिक्री', mr: 'विक्री' },
  expiry: { en: 'expiry', hi: 'एक्सपायरी', mr: 'एक्सपायरी' },
  exists: {
    en: (n: string, p: string, u: string) => `${n} is already there at ${p} per ${u}. How much came in?`,
    hi: (n: string, p: string, u: string) => `${n} पहले से है, ${p} प्रति ${u}। कितना आया?`,
    mr: (n: string, p: string, u: string) => `${n} आधीच आहे, ${p} प्रति ${u}. किती आलं?`,
  },
  keepPrice: {
    en: (p: string) => `Keep the selling price at ${p}?`,
    hi: (p: string) => `बेचने का रेट ${p} ही रहेगा?`,
    mr: (p: string) => `विक्रीचा दर ${p} च ठेवायचा?`,
  },
  askNewPrice: {
    en: () => 'Tell me the new selling price.',
    hi: () => 'नया बेचने का रेट बोलिए।',
    mr: () => 'नवीन विक्री दर सांगा.',
  },
  confirmRestock: {
    en: (l: string) => `Add ${l} to stock?`,
    hi: (l: string) => `${l} स्टॉक में जोड़ूँ?`,
    mr: (l: string) => `${l} स्टॉकमध्ये जोडू?`,
  },
  confirmSell: {
    en: (l: string, t: string) => `${l}. Total ${t}. Save the sale?`,
    hi: (l: string, t: string) => `${l}। कुल ${t}। बिक्री सेव करूँ?`,
    mr: (l: string, t: string) => `${l}. एकूण ${t}. विक्री सेव करू?`,
  },
  lowStock: {
    en: (n: string, q: string) => `Note: only ${q} of ${n} in stock.`,
    hi: (n: string, q: string) => `ध्यान दें, ${n} का स्टॉक सिर्फ़ ${q} है।`,
    mr: (n: string, q: string) => `लक्षात घ्या, ${n} चा स्टॉक फक्त ${q} आहे.`,
  },
  confirmPrice: {
    en: (n: string, a: string, b: string) => `Change ${n} from ${a} to ${b}?`,
    hi: (n: string, a: string, b: string) => `${n} का रेट ${a} से ${b} करूँ?`,
    mr: (n: string, a: string, b: string) => `${n} चा दर ${a} वरून ${b} करू?`,
  },
  stock: {
    en: (n: string, q: string) => `${n}: ${q} left.`,
    hi: (n: string, q: string) => `${n}: ${q} बचा है।`,
    mr: (n: string, q: string) => `${n}: ${q} शिल्लक आहे.`,
  },
  saved: { en: 'Saved.', hi: 'सेव हो गया।', mr: 'सेव झालं.' },
  cancelled: { en: 'OK, cancelled.', hi: 'ठीक है, रद्द कर दिया।', mr: 'ठीक आहे, रद्द केलं.' },
  needNumber: { en: 'Sorry, please say a number.', hi: 'माफ़ कीजिए, नंबर बोलिए।', mr: 'माफ करा, आकडा सांगा.' },
  yesOrNo: { en: 'Please say yes or no.', hi: 'हाँ या नहीं बोलिए।', mr: 'हो की नाही ते सांगा.' },
  billSaved: {
    en: (t: string) => `Bill confirmed. Sale of ${t} saved.`,
    hi: (t: string) => `बिल पक्का। ${t} की बिक्री सेव हो गई।`,
    mr: (t: string) => `बिल पक्कं. ${t} ची विक्री सेव झाली.`,
  },
  noBill: {
    en: () => 'Make a bill first, like "1 litre milk and 2 kg sugar".',
    hi: () => 'पहले बिल बनाइए, जैसे "1 लीटर दूध और 2 किलो चीनी"।',
    mr: () => 'आधी बिल बनवा, उदा. "1 लिटर दूध आणि 2 किलो साखर".',
  },
  needQty: {
    en: (n: string) => `How much ${n}?`,
    hi: (n: string) => `कितना ${n}?`,
    mr: (n: string) => `किती ${n}?`,
  },
};

const A = {
  expiring: {
    en: (l: string) => `Expiring soon: ${l}.`,
    hi: (l: string) => `जल्दी एक्सपायर होने वाले: ${l}।`,
    mr: (l: string) => `लवकर एक्सपायर होणारे: ${l}.`,
  },
  expiredTag: { en: 'expired', hi: 'एक्सपायर हो गया', mr: 'एक्सपायर झालं' },
  daysTag: {
    en: (d: number) => (d === 0 ? 'today' : `${d} days`),
    hi: (d: number) => (d === 0 ? 'आज' : `${d} दिन`),
    mr: (d: number) => (d === 0 ? 'आज' : `${d} दिवस`),
  },
  low: {
    en: (l: string) => `Running low: ${l}.`,
    hi: (l: string) => `खत्म होने वाले: ${l}।`,
    mr: (l: string) => `संपत आलेले: ${l}.`,
  },
  allGood: {
    en: 'Nothing is expiring or running low.',
    hi: 'कुछ भी एक्सपायर या खत्म होने वाला नहीं है।',
    mr: 'काहीही एक्सपायर किंवा संपत आलेलं नाही.',
  },
};

const sep = { en: ', ', hi: ', ', mr: ', ' };

function qtyWithUnit(qty: number, unit: Unit, lang: Lang): string {
  return `${qtyText(qty)} ${unitLabel(unit, lang)}`;
}

/** First number in what was said, e.g. "56 rupaye" → 56. */
function firstNumber(text: string): number | null {
  for (const t of tokenize(text)) {
    const n = parseNumberWord(t);
    if (n !== null && t !== 'do') return n;
  }
  return null;
}

function firstUnit(text: string): Unit | null {
  for (const t of tokenize(text)) {
    const u = parseUnit(t);
    if (u) return u;
  }
  return null;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Expiry date from "2026-10-31", "31/10", "31 october", "10 din" (in 10 days).
 * Returns null when no date could be read.
 */
export function parseExpiry(text: string, today: Date): string | null {
  const t = text.toLowerCase().trim();
  let m = t.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return iso(new Date(+m[1], +m[2] - 1, +m[3]));
  m = t.match(/(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?/);
  if (m) {
    const year = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : today.getFullYear();
    return iso(new Date(year, +m[2] - 1, +m[1]));
  }
  m = t.match(/(\d{1,2})\s*([a-z]{3,})\s*(\d{4})?/);
  if (m) {
    const month = MONTHS.indexOf(m[2].slice(0, 3));
    if (month >= 0) return iso(new Date(m[3] ? +m[3] : today.getFullYear(), month, +m[1]));
  }
  m = t.match(/(\d+)\s*(din|days?|दिन|दिवस|divas)/);
  if (m) {
    const d = new Date(today);
    d.setDate(d.getDate() + +m[1]);
    return iso(d);
  }
  return null;
}

function displayDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
}

function turn(state: ConversationState, lang: Lang, say: string, extra: Partial<Turn> = {}): Turn {
  return { say, lang, state: { ...state, lang }, ...extra };
}

function idle(state: ConversationState, lang: Lang): ConversationState {
  return { ...state, lang, flow: { step: 'idle' } };
}

function withFlow(state: ConversationState, lang: Lang, flow: Flow): ConversationState {
  return { ...state, lang, flow };
}

function newProductSummary(d: Required<NewProduct>, expiry: string | null, lang: Lang, showCost: boolean): string {
  const parts = [d.name, qtyWithUnit(d.qty, d.unit, lang)];
  if (showCost) parts.push(`${T.cost[lang]} ${formatRupees(d.costPaise)}`);
  parts.push(`${T.sell[lang]} ${formatRupees(d.sellPaise)}`);
  if (expiry) parts.push(`${T.expiry[lang]} ${displayDate(expiry)}`);
  return parts.join(sep[lang]);
}

/** Ask for whatever the new product is still missing. */
function nextNewStep(state: ConversationState, lang: Lang, draft: NewProduct): Turn {
  if (draft.qty === undefined) {
    return turn(withFlow(state, lang, { step: 'newQty', draft }), lang, T.askQty[lang](draft.name));
  }
  if (draft.unit === undefined) {
    return turn(withFlow(state, lang, { step: 'newUnit', draft }), lang, T.askUnit[lang]());
  }
  const u = unitLabel(draft.unit, lang);
  if (draft.costPaise === undefined && state.askCost === false) draft = { ...draft, costPaise: 0 };
  if (draft.costPaise === undefined) {
    return turn(withFlow(state, lang, { step: 'newCost', draft }), lang, T.askCost[lang](u));
  }
  if (draft.sellPaise === undefined) {
    return turn(withFlow(state, lang, { step: 'newSell', draft }), lang, T.askSell[lang](u));
  }
  return turn(withFlow(state, lang, { step: 'newExpiry', draft }), lang, T.askExpiry[lang]());
}

function confirmNewProduct(state: ConversationState, lang: Lang, draft: NewProduct, expiry: string | null): Turn {
  const d = draft as Required<NewProduct>;
  const action: Action = {
    type: 'create',
    product: {
      names: [d.name],
      unit: d.unit,
      stock: d.qty,
      costPaise: d.costPaise,
      sellPaise: d.sellPaise,
      ...(expiry ? { expiry } : {}),
    },
  };
  return turn(withFlow(state, lang, { step: 'confirm', action }), lang,
    T.confirmNew[lang](newProductSummary(d, expiry, lang, state.askCost !== false)));
}

/** A single product the person named, or what to say if there isn't exactly one. */
function pickOne(name: string, products: Product[], lang: Lang): { product: Product } | { say: string } {
  const matches = findProducts(name, products);
  if (matches.length === 1) return { product: matches[0].product };
  // Reuse the price answer's wording for "not found" and "which one".
  const r = resolve({ name, qty: null, unit: null }, products, lang);
  return { say: r.ok ? '' : r.text };
}

/** Restock quantity in the product's own unit, or null if the unit doesn't fit. */
function inProductUnit(product: Product, qty: number, unit: Unit | null): number | null {
  return convert(qty, unit ?? product.unit, product.unit);
}

function startAdd(state: ConversationState, lang: Lang, item: ItemRequest, products: Product[]): Turn {
  const matches = findProducts(item.name, products);
  if (matches.length === 1 && matches[0].exact) {
    const product = matches[0].product;
    if (item.qty !== null) {
      const qty = inProductUnit(product, item.qty, item.unit);
      if (qty !== null) return askKeepPrice(state, lang, product, qty);
    }
    return turn(withFlow(state, lang, { step: 'restockQty', product }), lang,
      T.exists[lang](product.names[0], formatRupees(product.sellPaise), unitLabel(product.unit, lang)));
  }
  // Speech comes back lower-case; save "paneer" as "Paneer".
  const name = item.name.replace(/\b[a-z]/g, (c) => c.toUpperCase());
  const draft: NewProduct = { name };
  if (item.qty !== null) draft.qty = item.qty;
  if (item.unit !== null) draft.unit = item.unit;
  return nextNewStep(state, lang, draft);
}

function askKeepPrice(state: ConversationState, lang: Lang, product: Product, qty: number): Turn {
  return turn(withFlow(state, lang, { step: 'keepPrice', product, qty }), lang,
    T.keepPrice[lang](formatRupees(product.sellPaise)));
}

function startRestock(state: ConversationState, lang: Lang, items: ItemRequest[], products: Product[]): Turn {
  if (items.length === 1) {
    const item = items[0];
    const matches = findProducts(item.name, products);
    // Stock for a product the shop doesn't have yet: add it as new.
    if (!matches.length) return startAdd(state, lang, item, products);
    if (item.qty === null) {
      const pick = pickOne(item.name, products, lang);
      if ('say' in pick) return turn(idle(state, lang), lang, pick.say);
      return turn(withFlow(state, lang, { step: 'restockQty', product: pick.product }), lang,
        T.needQty[lang](pick.product.names[0]));
    }
  }
  const restock: { productId: string; qty: number }[] = [];
  const said: string[] = [];
  for (const item of items) {
    const pick = pickOne(item.name, products, lang);
    if ('say' in pick) return turn(idle(state, lang), lang, pick.say);
    if (item.qty === null) return turn(idle(state, lang), lang, T.needQty[lang](pick.product.names[0]));
    const qty = inProductUnit(pick.product, item.qty, item.unit);
    if (qty === null) {
      const r = resolve(item, products, lang);
      return turn(idle(state, lang), lang, r.ok ? '' : r.text);
    }
    if (items.length === 1) return askKeepPrice(state, lang, pick.product, qty);
    restock.push({ productId: pick.product.id, qty });
    said.push(`${qtyWithUnit(qty, pick.product.unit, lang)} ${pick.product.names[0]}`);
  }
  const action: Action = { type: 'restock', items: restock };
  return turn(withFlow(state, lang, { step: 'confirm', action }), lang,
    T.confirmRestock[lang](said.join(sep[lang])));
}

function confirmSale(state: ConversationState, lang: Lang, lines: BillLine[]): Turn {
  const bill = makeBill(lines);
  const action = billToSale(bill);
  const said = lines
    .map((l) => `${qtyWithUnit(l.qty, l.unit, lang)} ${l.product.names[0]} ${formatRupees(l.amountPaise)}`)
    .join(sep[lang]);
  const warnings = lines
    .filter((l) => l.qtyInProductUnit > l.product.stock)
    .map((l) => T.lowStock[lang](l.product.names[0], qtyWithUnit(l.product.stock, l.product.unit, lang)));
  const say = [...warnings, T.confirmSell[lang](said, formatRupees(bill.payablePaise))].join(' ');
  return turn(withFlow(state, lang, { step: 'confirm', action }), lang, say, { bill });
}

function startSell(state: ConversationState, lang: Lang, items: ItemRequest[], products: Product[]): Turn {
  const lines: BillLine[] = [];
  for (const item of items) {
    if (item.qty === null) {
      const pick = pickOne(item.name, products, lang);
      return turn(idle(state, lang), lang, 'say' in pick ? pick.say : T.needQty[lang](pick.product.names[0]));
    }
    const r = resolve(item, products, lang);
    if (!r.ok) return turn(idle(state, lang), lang, r.text);
    lines.push(r.line);
  }
  return confirmSale(state, lang, lines);
}

function startCommand(command: Command, state: ConversationState, products: Product[], today: Date): Turn {
  const { lang } = command;
  switch (command.kind) {
    case 'price': {
      const a = answer(command, products);
      const bill = a.kind === 'price' ? a.bill : null;
      return turn({ ...idle(state, lang), lastBill: bill ?? state.lastBill }, lang, a.text, { bill });
    }
    case 'confirmBill': {
      const bill = state.lastBill;
      if (!bill) return turn(idle(state, lang), lang, T.noBill[lang]());
      return turn({ ...idle(state, lang), lastBill: null }, lang,
        T.billSaved[lang](formatRupees(bill.payablePaise)), { action: billToSale(bill), bill });
    }
    case 'add':
      return startAdd(state, lang, command.item, products);
    case 'restock':
      return startRestock(state, lang, command.items, products);
    case 'sell':
      return startSell(state, lang, command.items, products);
    case 'setPrice': {
      const pick = pickOne(command.name, products, lang);
      if ('say' in pick) return turn(idle(state, lang), lang, pick.say);
      const sellPaise = Math.round(command.rupees * 100);
      const action: Action = { type: 'setPrice', productId: pick.product.id, sellPaise };
      return turn(withFlow(state, lang, { step: 'confirm', action }), lang,
        T.confirmPrice[lang](pick.product.names[0], formatRupees(pick.product.sellPaise), formatRupees(sellPaise)));
    }
    case 'stock': {
      const pick = pickOne(command.name, products, lang);
      if ('say' in pick) return turn(idle(state, lang), lang, pick.say);
      const p = pick.product;
      return turn(idle(state, lang), lang, T.stock[lang](p.names[0], qtyWithUnit(p.stock, p.unit, lang)));
    }
    case 'alerts':
      return turn(idle(state, lang), lang, alertsText(command.which, products, lang, today));
    default:
      return turn(idle(state, lang), lang, unknownAnswer(lang).text);
  }
}

function alertsText(which: 'expiry' | 'low' | 'all', products: Product[], lang: Lang, today: Date): string {
  const { expiring, lowStock } = findAlerts(products, today);
  const parts: string[] = [];
  if (which !== 'low' && expiring.length) {
    const list = expiring.map((a) =>
      `${a.product.names[0]} (${a.daysLeft < 0 ? A.expiredTag[lang] : A.daysTag[lang](a.daysLeft)})`);
    parts.push(A.expiring[lang](list.join(sep[lang])));
  }
  if (which !== 'expiry' && lowStock.length) {
    const list = lowStock.map((p) => `${p.names[0]} ${qtyWithUnit(Math.max(p.stock, 0), p.unit, lang)}`);
    parts.push(A.low[lang](list.join(sep[lang])));
  }
  return parts.length ? parts.join(' ') : A.allGood[lang];
}

/** Handle one thing the shopkeeper said. `today` is only used for expiry dates. */
export function converse(
  text: string,
  state: ConversationState,
  products: Product[],
  today: Date = new Date(),
): Turn {
  const command = parseCommand(text);
  const flow = state.flow;
  // Keep the language the conversation started in unless they clearly switch.
  const lang = command.kind === 'unknown' || command.kind === 'yes' || command.kind === 'no' ? state.lang : command.lang;
  const cancel = () => turn(idle(state, lang), lang, T.cancelled[lang]);
  const number = firstNumber(text);

  switch (flow.step) {
    case 'idle':
      return startCommand(command, state, products, today);

    case 'confirm':
      if (command.kind === 'yes') {
        // A recorded sale closes any bill that was open, so it can't be saved twice.
        const lastBill = flow.action.type === 'sell' ? null : state.lastBill;
        return turn({ ...idle(state, lang), lastBill }, lang, T.saved[lang], { action: flow.action });
      }
      if (command.kind === 'no') return cancel();
      if (command.kind === 'unknown') return turn(state, lang, T.yesOrNo[lang]);
      // Something new: drop the pending change and handle it.
      return startCommand(command, { ...state, flow: { step: 'idle' } }, products, today);

    case 'newQty': {
      if (command.kind === 'no') return cancel();
      if (number === null) return turn(state, lang, T.needNumber[lang]);
      const unit = firstUnit(text) ?? flow.draft.unit;
      return nextNewStep(state, lang, { ...flow.draft, qty: number, ...(unit ? { unit } : {}) });
    }
    case 'newUnit': {
      if (command.kind === 'no') return cancel();
      const unit = firstUnit(text);
      if (!unit) return turn(state, lang, T.askUnit[lang]());
      return nextNewStep(state, lang, { ...flow.draft, unit });
    }
    case 'newCost':
      if (command.kind === 'no') return cancel();
      if (number === null) return turn(state, lang, T.needNumber[lang]);
      return nextNewStep(state, lang, { ...flow.draft, costPaise: Math.round(number * 100) });
    case 'newSell':
      if (command.kind === 'no') return cancel();
      if (number === null) return turn(state, lang, T.needNumber[lang]);
      return nextNewStep(state, lang, { ...flow.draft, sellPaise: Math.round(number * 100) });
    case 'newExpiry': {
      if (command.kind === 'no') return confirmNewProduct(state, lang, flow.draft, null);
      const expiry = parseExpiry(text, today);
      if (!expiry) return turn(state, lang, T.askExpiry[lang]());
      return confirmNewProduct(state, lang, flow.draft, expiry);
    }

    case 'restockQty': {
      if (command.kind === 'no') return cancel();
      if (number === null) return turn(state, lang, T.needNumber[lang]);
      const qty = inProductUnit(flow.product, number, firstUnit(text));
      if (qty === null) {
        return turn(state, lang, T.needQty[lang](`${unitLabel(flow.product.unit, lang)} ${flow.product.names[0]}`));
      }
      return askKeepPrice(state, lang, flow.product, qty);
    }
    case 'keepPrice':
      if (command.kind === 'yes') {
        return turn(idle(state, lang), lang, T.saved[lang], {
          action: { type: 'restock', items: [{ productId: flow.product.id, qty: flow.qty }] },
        });
      }
      if (command.kind === 'no') {
        return turn(withFlow(state, lang, { step: 'newPrice', product: flow.product, qty: flow.qty }), lang,
          T.askNewPrice[lang]());
      }
      if (number !== null) {
        return turn(idle(state, lang), lang, T.saved[lang], {
          action: {
            type: 'restock',
            items: [{ productId: flow.product.id, qty: flow.qty }],
            sellPaise: Math.round(number * 100),
          },
        });
      }
      return turn(state, lang, T.yesOrNo[lang]);
    case 'newPrice':
      if (number === null) return turn(state, lang, T.needNumber[lang]);
      return turn(idle(state, lang), lang, T.saved[lang], {
        action: {
          type: 'restock',
          items: [{ productId: flow.product.id, qty: flow.qty }],
          sellPaise: Math.round(number * 100),
        },
      });
  }
}

/** Turn the bill on screen into a sale (the "Confirm sale" button). */
export function billToSale(bill: Bill): Action {
  return {
    type: 'sell',
    lines: bill.lines.map((l) => ({
      productId: l.product.id,
      qty: l.qtyInProductUnit,
      sellPaise: l.product.sellPaise,
      amountPaise: l.amountPaise,
    })),
  };
}


/** The "Confirm sale" button: same as saying "bill pakka karo". */
export function confirmLastBill(state: ConversationState, products: Product[]): Turn {
  return startCommand({ kind: 'confirmBill', lang: state.lang }, state, products, new Date());
}

/** True while the app is waiting for a yes or no. */
export function awaitingYesNo(state: ConversationState): boolean {
  return state.flow.step === 'confirm' || state.flow.step === 'keepPrice';
}
