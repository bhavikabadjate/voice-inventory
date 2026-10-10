// Quantities as people say them: digits ("2", "1.5", "२"), number words in
// English, Hindi and Marathi ("do", "don", "दो"), and fractions ("aadha",
// "dedh", "paav").

const WORDS: Record<string, number> = {
  // fractions
  half: 0.5, aadha: 0.5, adha: 0.5, aadhaa: 0.5, ardha: 0.5, 'आधा': 0.5, 'अर्धा': 0.5,
  quarter: 0.25, paav: 0.25, pav: 0.25, pao: 0.25, 'पाव': 0.25,
  sawa: 1.25, sava: 1.25, 'सवा': 1.25,
  dedh: 1.5, derh: 1.5, didh: 1.5, 'डेढ़': 1.5, 'डेढ': 1.5, 'दीड': 1.5,
  dhai: 2.5, adhai: 2.5, 'ढाई': 2.5, 'अडीच': 2.5,
  // English
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, fifty: 50, hundred: 100,
  // Hindi (romanised and Devanagari)
  ek: 1, do: 2, teen: 3, tin: 3, char: 4, chaar: 4, paanch: 5, panch: 5, chhe: 6, chah: 6,
  saat: 7, sat: 7, aath: 8, nau: 9, das: 10, gyarah: 11, barah: 12, pandrah: 15, bees: 20,
  pachaas: 50, pachas: 50, sau: 100,
  'एक': 1, 'दो': 2, 'तीन': 3, 'चार': 4, 'पांच': 5, 'पाँच': 5, 'छह': 6, 'सात': 7, 'आठ': 8,
  'नौ': 9, 'दस': 10, 'बीस': 20, 'पचास': 50, 'सौ': 100,
  // Marathi
  don: 2, saha: 6, daha: 10, 'दोन': 2, 'पाच': 5, 'सहा': 6, 'नऊ': 9, 'दहा': 10, 'वीस': 20,
  'पन्नास': 50, 'शंभर': 100,
};

const DEVANAGARI_DIGITS = '०१२३४५६७८९';

export function toAsciiDigits(text: string): string {
  return text.replace(/[०-९]/g, (d) => String(DEVANAGARI_DIGITS.indexOf(d)));
}

/** Parse one word as a number, or null if it isn't one. */
export function parseNumberWord(word: string): number | null {
  const w = toAsciiDigits(word.trim().toLowerCase());
  if (/^\d+(\.\d+)?$/.test(w)) return Number(w);
  if (/^\d+\/\d+$/.test(w)) {
    const [a, b] = w.split('/').map(Number);
    return b ? a / b : null;
  }
  return WORDS[w] ?? null;
}
