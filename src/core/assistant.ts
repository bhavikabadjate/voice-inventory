// Turns a parsed price question into the spoken answer and, for several items
// or quantities, a bill. Replies in the language the question was asked in.

import { BillLine, formatRupees, makeBill, Bill, Product, quote } from './billing';
import { findProducts, soundKey } from './names';
import { Command, ItemRequest } from './parse';
import { Lang, unitLabel } from './units';

export type Answer =
  | { kind: 'price'; lang: Lang; text: string; bill: Bill | null }
  | { kind: 'clarify'; lang: Lang; text: string }
  | { kind: 'unknown'; lang: Lang; text: string };

const T = {
  perUnit: {
    en: (n: string, p: string, u: string) => `${n} is ${p} per ${u}.`,
    hi: (n: string, p: string, u: string) => `${n} ${p} प्रति ${u} है।`,
    mr: (n: string, p: string, u: string) => `${n} ${p} प्रति ${u} आहे.`,
  },
  line: {
    en: (q: string, n: string, p: string) => `${q} ${n} ${p}`,
    hi: (q: string, n: string, p: string) => `${q} ${n} ${p}`,
    mr: (q: string, n: string, p: string) => `${q} ${n} ${p}`,
  },
  total: { en: 'Total', hi: 'कुल', mr: 'एकूण' },
  notFound: {
    en: (n: string) => `I couldn't find ${n}.`,
    hi: (n: string) => `${n} नहीं मिला।`,
    mr: (n: string) => `${n} सापडलं नाही.`,
  },
  unitMismatch: {
    en: (n: string, u: string) => `${n} is sold per ${u}. How many ${u}?`,
    hi: (n: string, u: string) => `${n} ${u} में बिकता है। कितने ${u}?`,
    mr: (n: string, u: string) => `${n} ${u} मध्ये विकतो. किती ${u}?`,
  },
  which: {
    en: (opts: string) => `Which one: ${opts}?`,
    hi: (opts: string) => `कौन सा: ${opts}?`,
    mr: (opts: string) => `कोणता: ${opts}?`,
  },
  or: { en: ' or ', hi: ' या ', mr: ' की ' },
  unknown: {
    en: "Sorry, I didn't understand. Please say it again.",
    hi: 'माफ़ कीजिए, समझ नहीं आया। फिर से बोलिए।',
    mr: 'माफ करा, समजलं नाही. पुन्हा सांगा.',
  },
};

function qtyText(qty: number): string {
  return String(Number(qty.toFixed(3)));
}

type Resolved =
  | { ok: true; line: BillLine; spokenName: string; asked: ItemRequest }
  | { ok: false; text: string };

function resolve(item: ItemRequest, products: Product[], lang: Lang): Resolved {
  const matches = findProducts(item.name, products);
  if (!matches.length) return { ok: false, text: T.notFound[lang](item.name) };
  if (matches.length > 1) {
    const opts = matches.map((m) => m.product.names[0]).join(T.or[lang]);
    return { ok: false, text: T.which[lang](opts) };
  }
  const { product, exact } = matches[0];
  // Answer with the name the person used, spelled as it is saved.
  const spokenName = exact
    ? (product.names.find((n) => n.toLowerCase() === item.name) ??
      product.names.find((n) => soundKey(n) === soundKey(item.name)) ??
      item.name)
    : product.names[0];
  const q = quote(product, item.qty ?? 1, item.unit ?? product.unit);
  if (!q.ok) {
    return { ok: false, text: T.unitMismatch[lang](spokenName, unitLabel(product.unit, lang)) };
  }
  return { ok: true, line: q.line, spokenName, asked: item };
}

export function answer(command: Command, products: Product[]): Answer {
  const { lang } = command;
  if (command.kind === 'unknown') return { kind: 'unknown', lang, text: T.unknown[lang] };

  const resolved = command.items.map((item) => resolve(item, products, lang));
  const problem = resolved.find((r) => !r.ok);
  if (problem && !problem.ok) return { kind: 'clarify', lang, text: problem.text };
  const ok = resolved.filter((r): r is Extract<Resolved, { ok: true }> => r.ok);

  // "Milk kitne ka hai?" → the rate per unit, no bill.
  if (ok.length === 1 && ok[0].asked.qty === null) {
    const { line, spokenName } = ok[0];
    const text = T.perUnit[lang](
      spokenName,
      formatRupees(line.product.sellPaise),
      unitLabel(line.product.unit, lang),
    );
    return { kind: 'price', lang, text, bill: null };
  }

  const bill = makeBill(ok.map((r) => r.line));
  const parts = ok.map(({ line, spokenName }) =>
    T.line[lang](
      `${qtyText(line.qty)} ${unitLabel(line.unit, lang)}`,
      spokenName,
      formatRupees(line.amountPaise),
    ),
  );
  const text =
    ok.length === 1
      ? `${parts[0]}.`
      : `${parts.join(', ')}. ${T.total[lang]} ${formatRupees(bill.payablePaise)}.`;
  return { kind: 'price', lang, text, bill };
}
