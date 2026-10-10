// Local parser for what a shopkeeper says, e.g.
//   "2 ltr milk kitne ka hai"            price question
//   "1ltr milk and 2kg sugar ka kitna hua" bill quote
//   "milk add karo"                      start adding a product
//   "10 kilo cheeni aayi"                 restock
//   "2 litre dudh becha"                  sale
//   "dudh ka rate 58 kar do"              change selling price
//   "cheeni kitni bachi hai"              stock question
// Anything it doesn't recognise is returned as `unknown`.

import { parseNumberWord, toAsciiDigits } from './numbers';
import { Lang, parseUnit, Unit } from './units';

export interface ItemRequest {
  /** Product name as the person said it. */
  name: string;
  qty: number | null;
  unit: Unit | null;
}

export type Command =
  | { kind: 'price'; lang: Lang; items: ItemRequest[] }
  | { kind: 'add'; lang: Lang; item: ItemRequest }
  | { kind: 'restock'; lang: Lang; items: ItemRequest[] }
  | { kind: 'sell'; lang: Lang; items: ItemRequest[] }
  | { kind: 'setPrice'; lang: Lang; name: string; rupees: number }
  | { kind: 'stock'; lang: Lang; name: string }
  | { kind: 'confirmBill'; lang: Lang }
  | { kind: 'yes'; lang: Lang }
  | { kind: 'no'; lang: Lang }
  | { kind: 'unknown'; lang: Lang; text: string };

const SEPARATORS = new Set(['and', 'aur', 'ani', 'aani', 'और', 'आणि', 'plus', ',', 'तथा']);

// Question words and fillers that are never part of a product name.
const STOPWORDS = new Set([
  // English
  'how', 'much', 'is', 'the', 'of', 'what', 'price', 'rate', 'cost', 'for', 'a', 'an', 'total',
  'tell', 'me', 'please', 'give', 'will', 'it', 'be', 'does',
  // Hindi (romanised)
  'kitne', 'kitna', 'kitni', 'ka', 'ki', 'ke', 'hai', 'hain', 'hua', 'hue', 'huye', 'kya', 'kaa',
  'bhav', 'bhaav', 'daam', 'dam', 'bata', 'batao', 'batana', 'bataiye', 'bolo', 'de', 'do', 'dena', 'ko', 'me',
  'mein', 'sab', 'milake', 'milakar', 'ab', 'rupaye', 'rupay', 'ji', 'bhai', 'bhaiya',
  // Hindi (Devanagari)
  'कितने', 'कितना', 'कितनी', 'का', 'की', 'के', 'है', 'हैं', 'हुआ', 'हुए', 'क्या', 'भाव', 'दाम',
  'बताओ', 'बताइए', 'रेट', 'में', 'सब', 'मिलाकर', 'जी',
  // Marathi (romanised and Devanagari)
  'kiti', 'aahe', 'ahe', 'zhala', 'jhala', 'zale', 'jhale', 'cha', 'chi', 'che', 'la', 'sang',
  'sanga', 'किती', 'आहे', 'झाले', 'झाला', 'चा', 'ची', 'चे', 'ला', 'सांगा', 'एकूण', 'किंमत',
]);

// Words that pick what the person wants to do. They are never part of a name.
const ADD_WORDS = new Set([
  'add', 'jodo', 'jod', 'joddo', 'new', 'naya', 'nayi', 'जोड़ो', 'जोडो', 'जोडा', 'नया', 'ऐड', 'ॲड', 'ऍड', 'एड',
]);
const RESTOCK_WORDS = new Set([
  'aaya', 'aayi', 'aaye', 'aya', 'ayi', 'aye', 'mila', 'mili', 'received', 'came', 'arrived', 'restock',
  'aale', 'aala', 'aali', 'आया', 'आई', 'आए', 'आये', 'मिला', 'आले', 'आला', 'आली',
]);
const SELL_WORDS = new Set([
  'becha', 'bechi', 'beche', 'bik', 'bika', 'biki', 'bike', 'sold', 'sell', 'vikla', 'vikli', 'vikle',
  'बेचा', 'बेची', 'बेचे', 'बिका', 'बिकी', 'बिके', 'विकला', 'विकली', 'विकले',
]);
const RATE_WORDS = new Set(['rate', 'price', 'bhav', 'bhaav', 'daam', 'dam', 'रेट', 'भाव', 'दाम', 'किंमत', 'kimat']);
const CHANGE_WORDS = new Set([
  'kar', 'karo', 'karde', 'kardo', 'set', 'change', 'badlo', 'badal', 'update', 'make', 'kara',
  'कर', 'करो', 'करदो', 'बदलो', 'करा', 'ठेवा',
]);
const STOCK_WORDS = new Set([
  'bacha', 'bachi', 'bache', 'stock', 'left', 'remaining', 'shillak', 'उरला', 'बचा', 'बची', 'बचे',
  'स्टॉक', 'शिल्लक',
]);
const YES_WORDS = new Set([
  'haan', 'han', 'ha', 'haa', 'yes', 'yeah', 'ok', 'okay', 'theek', 'thik', 'sahi', 'pakka', 'ho', 'hoy',
  'barobar', 'save', 'confirm', 'हाँ', 'हां', 'हा', 'ठीक', 'सही', 'पक्का', 'हो', 'होय', 'बरोबर',
]);
const NO_WORDS = new Set(['nahi', 'nahin', 'nai', 'na', 'no', 'nope', 'nako', 'cancel', 'नहीं', 'नही', 'ना', 'नाही', 'नको']);
const FILLERS = new Set(['hai', 'ji', 'bhai', 'karo', 'kar', 'do', 'है', 'जी', 'करो', 'please', 'it', 'is']);
const BILL_WORDS = new Set(['bill', 'बिल']);
const FINALISE_WORDS = new Set(['pakka', 'confirm', 'save', 'final', 'bana', 'banao', 'पक्का', 'बनाओ', 'बनवा']);

// Fillers that come with actions ("2 litre dudh bik gaya", "rate kar do").
const ACTION_FILLERS = new Set([
  'gaya', 'gayi', 'gaye', 'gya', 'liya', 'diya', 'hai', 'hain', 'ho', 'karo', 'kar', 'do', 'de', 'dena',
  'abhi', 'aaj', 'stock', 'me', 'mein', 'में', 'गया', 'गई', 'गए', 'दिया', 'लिया', 'दो', 'करो', 'कर',
  'आज', 'अभी', 'झाला', 'झाले', 'करा', 'टाका', 'daalo', 'dalo', 'डालो',
]);

const MARATHI_HINTS = ['kiti', 'aahe', 'ahe', 'zhala', 'jhala', 'ani', 'aani', 'kara', 'aale', 'aala', 'vikla', 'vikle', 'shillak', 'nako', 'hoy', 'किती', 'आहे', 'झाले', 'झाला', 'आणि', 'एकूण', 'सांगा'];
const HINDI_HINTS = ['kitne', 'kitna', 'kitni', 'hai', 'hua', 'aur', 'kya', 'ka', 'bata', 'batao', 'karo', 'kar', 'aaya', 'aayi', 'aya', 'ayi', 'becha', 'bechi', 'bika', 'biki', 'gaya', 'bacha', 'bachi', 'nahi', 'haan', 'pakka', 'कितने', 'कितना', 'है', 'हुआ', 'और', 'क्या'];

export function detectLang(tokens: string[]): Lang {
  if (tokens.some((t) => MARATHI_HINTS.includes(t))) return 'mr';
  if (tokens.some((t) => HINDI_HINTS.includes(t))) return 'hi';
  if (tokens.some((t) => /[ऀ-ॿ]/.test(t))) return 'hi';
  return 'en';
}

export function tokenize(text: string): string[] {
  return toAsciiDigits(text.toLowerCase())
    .replace(/[?!.।|"“”]/g, ' ')
    .replace(/,/g, ' , ')
    // "2kg" → "2 kg", "150g" → "150 g", "1ltr" → "1 ltr"
    .replace(/(\d)([^\d\s.,/])/g, '$1 $2')
    .split(/\s+/)
    .filter(Boolean);
}

function parseItem(tokens: string[]): ItemRequest | null {
  let qty: number | null = null;
  let unit: Unit | null = null;
  const nameParts: string[] = [];
  for (const t of tokens) {
    const n = parseNumberWord(t);
    // "do" is both "two" and a filler ("bata do"); only count it before a unit or name.
    if (n !== null && !(t === 'do' && nameParts.length > 0)) {
      qty = qty === null ? n : qty * n;
      continue;
    }
    const u = parseUnit(t);
    if (u !== null) {
      unit = u;
      continue;
    }
    if (!STOPWORDS.has(t)) nameParts.push(t);
  }
  if (!nameParts.length) return null;
  if (unit !== null && qty === null) qty = 1;
  return { name: nameParts.join(' '), qty, unit };
}

function splitSegments(tokens: string[]): string[][] {
  const segments: string[][] = [[]];
  for (const t of tokens) {
    if (SEPARATORS.has(t)) segments.push([]);
    else segments[segments.length - 1].push(t);
  }
  return segments;
}

function parseItems(tokens: string[], drop: Set<string>): ItemRequest[] {
  const kept = tokens.filter((t) => !drop.has(t) && !ACTION_FILLERS.has(t));
  return splitSegments(kept)
    .map(parseItem)
    .filter((i): i is ItemRequest => i !== null);
}

const has = (tokens: string[], words: Set<string>) => tokens.some((t) => words.has(t));

export function parseCommand(text: string): Command {
  const tokens = tokenize(text);
  const lang = detectLang(tokens);
  if (!tokens.length) return { kind: 'unknown', lang, text };

  // Short answers in a conversation: "haan", "nahi ji".
  const core = tokens.filter((t) => !FILLERS.has(t));
  if (core.length && core.length <= 2) {
    if (core.every((t) => YES_WORDS.has(t))) return { kind: 'yes', lang };
    if (core.every((t) => NO_WORDS.has(t))) return { kind: 'no', lang };
  }

  if (has(tokens, BILL_WORDS) && has(tokens, FINALISE_WORDS)) return { kind: 'confirmBill', lang };

  if (has(tokens, STOCK_WORDS) && !has(tokens, RESTOCK_WORDS)) {
    const item = parseItem(tokens.filter((t) => !STOCK_WORDS.has(t) && !ACTION_FILLERS.has(t)));
    if (item) return { kind: 'stock', lang, name: item.name };
  }

  if (has(tokens, RATE_WORDS) && has(tokens, CHANGE_WORDS)) {
    // "kar do": here "do" means "do it", not two.
    const numbers = tokens
      .filter((t) => t !== 'do')
      .map(parseNumberWord)
      .filter((n): n is number => n !== null);
    const name = tokens
      .filter((t) => parseNumberWord(t) === null && parseUnit(t) === null)
      .filter((t) => !RATE_WORDS.has(t) && !CHANGE_WORDS.has(t) && !ACTION_FILLERS.has(t))
      .filter((t) => !STOPWORDS.has(t) && !['rs', 'rupees', 'rupaye', 'रुपये', 'to', 'per', 'prati'].includes(t))
      .join(' ');
    if (numbers.length && name) return { kind: 'setPrice', lang, name, rupees: numbers[numbers.length - 1] };
  }

  if (has(tokens, ADD_WORDS)) {
    const [item] = parseItems(tokens, ADD_WORDS);
    if (item) return { kind: 'add', lang, item };
  }
  if (has(tokens, SELL_WORDS)) {
    const items = parseItems(tokens, SELL_WORDS);
    if (items.length) return { kind: 'sell', lang, items };
  }
  if (has(tokens, RESTOCK_WORDS)) {
    const items = parseItems(tokens, RESTOCK_WORDS);
    if (items.length) return { kind: 'restock', lang, items };
  }

  const items = splitSegments(tokens)
    .map(parseItem)
    .filter((i): i is ItemRequest => i !== null);
  if (!items.length) return { kind: 'unknown', lang, text };
  return { kind: 'price', lang, items };
}
