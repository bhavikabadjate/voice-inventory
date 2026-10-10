// Browser version of share-bill.ts: open the bill in a new tab and bring up
// the print dialog, where it can be printed or saved as a PDF.

import { billHtml, type Shop } from '@/core/bill-document';
import type { Bill } from '@/core/billing';
import type { Lang } from '@/core/units';

export async function shareBill(shop: Shop, bill: Bill, lang: Lang, date: Date = new Date()) {
  const page = window.open('', '_blank');
  if (!page) throw new Error('Allow pop-ups for this site to print the bill');
  page.document.write(billHtml(shop, bill, date, lang));
  page.document.close();
  page.focus();
  page.print();
}
