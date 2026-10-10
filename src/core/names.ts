// Product names: turn any spelling or script of a name into a "sound key" so
// dudh, doodh, dhudh and दूध all match the same product.

const CONSONANTS: Record<string, string> = {
  'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'n',
  'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'n',
  'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n',
  'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n',
  'प': 'p', 'फ': 'ph', 'ब': 'b', 'भ': 'bh', 'म': 'm',
  'य': 'y', 'र': 'r', 'ल': 'l', 'ळ': 'l', 'व': 'v',
  'श': 'sh', 'ष': 'sh', 'स': 's', 'ह': 'h',
  'ड़': 'd', 'ढ़': 'dh', 'ज़': 'z', 'फ़': 'f', 'क़': 'k', 'ख़': 'kh', 'ग़': 'g',
};

const VOWELS: Record<string, string> = {
  'अ': 'a', 'आ': 'aa', 'इ': 'i', 'ई': 'ee', 'उ': 'u', 'ऊ': 'oo', 'ऋ': 'ri',
  'ए': 'e', 'ऐ': 'ai', 'ओ': 'o', 'औ': 'au', 'ॲ': 'e', 'ऑ': 'o',
};

const MATRAS: Record<string, string> = {
  'ा': 'aa', 'ि': 'i', 'ी': 'ee', 'ु': 'u', 'ू': 'oo', 'ृ': 'ri',
  'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au', 'ॅ': 'e', 'ॉ': 'o',
};

const VIRAMA = '्';
const NUKTA = '़';

/** Rough Devanagari → Latin transliteration, enough for matching names. */
export function transliterate(text: string): string {
  const chars = Array.from(text.normalize('NFC'));
  let out = '';
  for (let i = 0; i < chars.length; i++) {
    let ch = chars[i];
    if (chars[i + 1] === NUKTA) {
      ch += NUKTA;
      i++;
    }
    const consonant = CONSONANTS[ch];
    if (consonant !== undefined) {
      const next = chars[i + 1];
      if (next === VIRAMA) {
        out += consonant;
        i++;
      } else if (next !== undefined && MATRAS[next] !== undefined) {
        out += consonant + MATRAS[next];
        i++;
      } else {
        out += consonant + 'a';
      }
    } else if (VOWELS[ch] !== undefined) {
      out += VOWELS[ch];
    } else if (ch === 'ं' || ch === 'ँ') {
      out += 'n';
    } else if (ch === 'ः') {
      out += 'h';
    } else {
      out += ch;
    }
  }
  return out;
}

/** Sound key used to compare names across spellings and scripts. */
export function soundKey(name: string): string {
  let s = transliterate(name).toLowerCase().replace(/[^a-z]/g, '');
  s = s
    .replace(/ph/g, 'f')
    .replace(/w/g, 'v')
    .replace(/z/g, 'j')
    .replace(/sh/g, 's')
    .replace(/ee/g, 'i')
    .replace(/oo/g, 'u')
    .replace(/(?!^)h/g, '')
    .replace(/(.)\1+/g, '$1');
  // A trailing short "a" is usually silent (दूध → "dudha"), so drop it.
  if (s.length > 2) s = s.replace(/a$/, '');
  return s;
}

/** Edit distance between two short strings. */
export function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = temp;
    }
  }
  return prev[b.length];
}

export interface Named {
  id: string;
  names: string[];
}

export interface NameMatch<T extends Named> {
  product: T;
  exact: boolean;
}

/**
 * Products whose names match `query`. Exact sound-key matches win; otherwise
 * names one letter off (for words of 4+ letters) are returned as close matches.
 */
export function findProducts<T extends Named>(query: string, products: T[]): NameMatch<T>[] {
  const key = soundKey(query);
  if (!key) return [];
  const exact = products.filter((p) => p.names.some((n) => soundKey(n) === key));
  if (exact.length) return exact.map((product) => ({ product, exact: true }));
  if (key.length < 4) return [];
  return products
    .filter((p) => p.names.some((n) => editDistance(soundKey(n), key) <= 1))
    .map((product) => ({ product, exact: false }));
}
