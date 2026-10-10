// The bill a customer receives: a printable page (turned into a PDF) with the
// shop's name, the items, the total and a UPI QR code for exactly that amount.
// Only selling prices appear here.

import qrcode from 'qrcode-generator';

import { Bill, formatRupees } from './billing';
import { Lang, unitLabel } from './units';

export interface Shop {
  name: string;
  /** e.g. "dukaan@okaxis". Without it the bill has no QR code. */
  upiId: string;
  phone: string;
}

export const emptyShop: Shop = { name: '', upiId: '', phone: '' };

/** UPI payment link that any UPI app (GPay, PhonePe, Paytm…) can open. */
export function upiLink(shop: Shop, amountPaise: number, note: string): string {
  const params = [
    ['pa', shop.upiId.trim()],
    ['pn', shop.name.trim() || 'Shop'],
    ['am', (amountPaise / 100).toFixed(2)],
    ['cu', 'INR'],
    ['tn', note],
  ];
  return `upi://pay?${params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;
}

export function qrSvg(text: string): string {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

const WORDS = {
  en: { bill: 'Bill', item: 'Item', qty: 'Qty', rate: 'Rate', amount: 'Amount', total: 'Total', scan: 'Scan to pay', thanks: 'Thank you!' },
  hi: { bill: 'बिल', item: 'सामान', qty: 'मात्रा', rate: 'रेट', amount: 'रकम', total: 'कुल', scan: 'स्कैन करके भुगतान करें', thanks: 'धन्यवाद!' },
  mr: { bill: 'बिल', item: 'वस्तू', qty: 'प्रमाण', rate: 'दर', amount: 'रक्कम', total: 'एकूण', scan: 'स्कॅन करून पैसे भरा', thanks: 'धन्यवाद!' },
};

export function billNumber(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear() % 100}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function dateText(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function billHtml(shop: Shop, bill: Bill, date: Date, lang: Lang = 'en'): string {
  const w = WORDS[lang];
  const number = billNumber(date);
  const rows = bill.lines
    .map(
      (l) => `<tr>
        <td>${escapeHtml(l.product.names[0])}</td>
        <td class="n">${Number(l.qty.toFixed(3))} ${escapeHtml(unitLabel(l.unit, lang))}</td>
        <td class="n">${formatRupees(l.product.sellPaise)}/${escapeHtml(unitLabel(l.product.unit, lang))}</td>
        <td class="n">${formatRupees(l.amountPaise)}</td>
      </tr>`,
    )
    .join('');
  const roundOff = bill.payablePaise - bill.totalPaise;
  const qr = shop.upiId.trim()
    ? `<div class="pay">${qrSvg(upiLink(shop, bill.payablePaise, `${w.bill} ${number}`))}
         <div>${w.scan}: <b>${formatRupees(bill.payablePaise)}</b><br>${escapeHtml(shop.upiId)}</div></div>`
    : '';
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { font-family: -apple-system, Roboto, 'Noto Sans Devanagari', sans-serif; margin: 24px; color: #111; }
  h1 { font-size: 22px; margin: 0; }
  .meta { color: #555; font-size: 13px; margin: 4px 0 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { padding: 6px 4px; border-bottom: 1px solid #ddd; text-align: left; }
  .n { text-align: right; white-space: nowrap; }
  .total td { font-weight: 700; font-size: 16px; border-bottom: none; }
  .pay { display: flex; gap: 16px; align-items: center; margin-top: 20px; }
  .pay svg { width: 140px; height: 140px; }
  .thanks { margin-top: 20px; color: #555; }
</style></head><body>
<h1>${escapeHtml(shop.name || w.bill)}</h1>
<div class="meta">${shop.phone ? `${escapeHtml(shop.phone)} · ` : ''}${w.bill} ${number} · ${dateText(date)}</div>
<table>
  <tr><th>${w.item}</th><th class="n">${w.qty}</th><th class="n">${w.rate}</th><th class="n">${w.amount}</th></tr>
  ${rows}
  ${roundOff ? `<tr><td colspan="3">Round off</td><td class="n">${roundOff > 0 ? '+' : '-'}${formatRupees(Math.abs(roundOff))}</td></tr>` : ''}
  <tr class="total"><td colspan="3">${w.total}</td><td class="n">${formatRupees(bill.payablePaise)}</td></tr>
</table>
${qr}
<div class="thanks">${w.thanks}</div>
</body></html>`;
}
