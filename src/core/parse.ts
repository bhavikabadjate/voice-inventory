// Local parser for price questions and bill quotes, e.g.
//   "2 ltr milk kitne ka hai"
//   "150g ragi how much"
//   "1ltr milk and 2kg sugar ka kitna hua"
//   "दूध किती आहे"
// Anything it doesn't recognise (adding stock, selling, changing prices) is
// returned as `unknown` so the AI conversation can handle it.

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

// Words that mean the person wants to change something, not ask a price.
const ACTION_WORDS = new Set([
  'add', 'karo', 'kar', 'jodo', 'daalo', 'dalo', 'aaya', 'aayi', 'aya', 'ayi', 'becha', 'bechi',
  'bik', 'bika', 'biki', 'sold', 'sell', 'update', 'change', 'badlo', 'set', 'delete', 'hatao',
  'करो', 'जोड़ो', 'डालो', 'आया', 'आई', 'बेचा', 'बिका', 'कर', 'करा', 'टाका', 'विकले', 'आले',
]);

const MARATHI_HINTS = ['kiti', 'aahe', 'ahe', 'zhala', 'jhala', 'ani', 'aani', 'किती', 'आहे', 'झाले', 'झाला', 'आणि', 'एकूण', 'सांगा'];
const HINDI_HINTS = ['kitne', 'kitna', 'kitni', 'hai', 'hua', 'aur', 'kya', 'ka', 'bata', 'batao', 'कितने', 'कितना', 'है', 'हुआ', 'और', 'क्या'];

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

export function parseCommand(text: string): Command {
  const tokens = tokenize(text);
  const lang = detectLang(tokens);
  if (!tokens.length || tokens.some((t) => ACTION_WORDS.has(t))) {
    return { kind: 'unknown', lang, text };
  }
  const segments: string[][] = [[]];
  for (const t of tokens) {
    if (SEPARATORS.has(t)) segments.push([]);
    else segments[segments.length - 1].push(t);
  }
  const items = segments.map(parseItem).filter((i): i is ItemRequest => i !== null);
  if (!items.length) return { kind: 'unknown', lang, text };
  return { kind: 'price', lang, items };
}
