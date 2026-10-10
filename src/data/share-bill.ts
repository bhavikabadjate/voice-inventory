// Turn a bill into a PDF and open the share sheet, so it can go to the
// customer on WhatsApp (or anywhere else).

import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import { billHtml, type Shop } from '@/core/bill-document';
import type { Bill } from '@/core/billing';
import type { Lang } from '@/core/units';

export async function shareBill(shop: Shop, bill: Bill, lang: Lang, date: Date = new Date()) {
  const { uri } = await Print.printToFileAsync({ html: billHtml(shop, bill, date, lang) });
  await Sharing.shareAsync(uri, {
    mimeType: 'application/pdf',
    UTI: 'com.adobe.pdf',
    dialogTitle: shop.name || 'Bill',
  });
}
