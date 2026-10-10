// Units a product can be sold in. Measured units (volume, mass, count) convert
// to their base unit; any other unit (packet, box...) is a "custom" unit that
// only matches itself.

export type BaseUnit = 'l' | 'kg' | 'piece';
export type Unit = BaseUnit | 'ml' | 'g' | 'dozen' | `custom:${string}`;

const FACTORS: Record<string, { base: BaseUnit; factor: number }> = {
  l: { base: 'l', factor: 1 },
  ml: { base: 'l', factor: 0.001 },
  kg: { base: 'kg', factor: 1 },
  g: { base: 'kg', factor: 0.001 },
  piece: { base: 'piece', factor: 1 },
  dozen: { base: 'piece', factor: 12 },
};

// Spoken and written forms in English, Hindi and Marathi.
const ALIASES: Record<string, Unit> = {
  l: 'l', ltr: 'l', ltrs: 'l', lt: 'l', litre: 'l', litres: 'l', liter: 'l', liters: 'l',
  litar: 'l', 'लीटर': 'l', 'लिटर': 'l',
  ml: 'ml', 'एमएल': 'ml', mili: 'ml', millilitre: 'ml', milliliter: 'ml',
  kg: 'kg', kgs: 'kg', kilo: 'kg', kilos: 'kg', kilogram: 'kg', 'किलो': 'kg',
  g: 'g', gm: 'g', gms: 'g', gram: 'g', grams: 'g', gramm: 'g', 'ग्राम': 'g', 'ग्रॅम': 'g',
  pc: 'piece', pcs: 'piece', piece: 'piece', pieces: 'piece', nag: 'piece', 'नग': 'piece',
  unit: 'piece', units: 'piece',
  dozen: 'dozen', darjan: 'dozen', 'दर्जन': 'dozen', 'डझन': 'dozen',
  packet: 'custom:packet', packets: 'custom:packet', pkt: 'custom:packet',
  'पैकेट': 'custom:packet', 'पाकीट': 'custom:packet', 'पॅकेट': 'custom:packet',
  box: 'custom:box', dabba: 'custom:box', 'डब्बा': 'custom:box',
  bottle: 'custom:bottle', 'बोतल': 'custom:bottle', 'बाटली': 'custom:bottle',
};

export function parseUnit(word: string): Unit | null {
  return ALIASES[word.trim().toLowerCase()] ?? null;
}

export function isUnitWord(word: string): boolean {
  return parseUnit(word) !== null;
}

/** Base unit a unit converts to, or the custom unit itself. */
export function baseOf(unit: Unit): Unit {
  return FACTORS[unit]?.base ?? unit;
}

/**
 * Convert `qty` of `unit` into the product's sell unit.
 * Returns null when the two can't be compared (e.g. kg of milk sold by litre).
 */
export function convert(qty: number, unit: Unit, sellUnit: Unit): number | null {
  if (unit === sellUnit) return qty;
  const from = FACTORS[unit];
  const to = FACTORS[sellUnit];
  if (!from || !to || from.base !== to.base) return null;
  return (qty * from.factor) / to.factor;
}

const LABELS: Record<string, { en: string; hi: string; mr: string }> = {
  l: { en: 'litre', hi: 'लीटर', mr: 'लिटर' },
  ml: { en: 'ml', hi: 'एमएल', mr: 'एमएल' },
  kg: { en: 'kg', hi: 'किलो', mr: 'किलो' },
  g: { en: 'gram', hi: 'ग्राम', mr: 'ग्रॅम' },
  piece: { en: 'piece', hi: 'नग', mr: 'नग' },
  dozen: { en: 'dozen', hi: 'दर्जन', mr: 'डझन' },
};

export type Lang = 'en' | 'hi' | 'mr';

export function unitLabel(unit: Unit, lang: Lang = 'en'): string {
  const label = LABELS[unit];
  if (label) return label[lang];
  return unit.replace(/^custom:/, '');
}
