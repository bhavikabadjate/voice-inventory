# Dukaan Voice

A voice assistant for shopkeepers, for Android and iOS. Ask "dudh kitne ka hai?" or
"1 litre milk aur 2 kilo cheeni ka kitna hua?" and the app answers with the selling
price or the bill total, in Hindi, Marathi or English. Cost price is never spoken.

The product plan lives in the project files (`plans/voice-inventory-plan.md`).

## What works so far

- **Products tab**: add and edit products with several names in any language
  (Milk, dudh, दूध), a unit (litre, kg, piece, dozen, packet...), selling and cost
  price, stock and an optional expiry date. Stored on the phone, works offline.
- **Ask tab**: tap the mic (or type) and talk. When the app asks a question it
  listens for the answer by itself.
  - Prices: "milk kitne ka hai", quantities ("2 ltr milk"), part units ("150 g ragi"
    from the per-kg price), number words ("aadha kilo") and several items with a total.
  - Bills: after a multi-item price, "bill pakka karo" (or the button) records the sale.
  - Add a product: "paneer add karo" → asks quantity, cost, selling price, expiry.
    For a product you already have it only asks the quantity and confirms the
    selling price.
  - Restock "10 kilo cheeni aayi", sell "2 litre dudh becha", change price
    "dudh ka rate 58 kar do", stock "cheeni kitni bachi hai".
  - Every change is confirmed with a yes/no before it's saved. Cost price is
    never spoken except while you're entering it.

- **Bills**: any bill on the Ask tab can be sent as a PDF (WhatsApp or any app)
  with the shop's name, the items, the total and a UPI QR code for that amount.
- **Shop tab**: items expiring within 7 days and items running low (at or below a
  level you set per product, or out of stock). Also by voice: "kya expire hone
  wala hai", "kya khatam ho raha hai". Shop name, phone and UPI ID for bills.

## Run it

Voice input uses `expo-speech-recognition`, which is not part of Expo Go, so the app
needs a development build:

```bash
npm install
npx expo run:android   # or: npx expo run:ios (macOS with Xcode)
```

Or build in the cloud with EAS: `npx eas-cli@latest login`, then `npx eas-cli@latest build --profile preview --platform android` gives an APK to install on any Android phone.

## Checks

```bash
npm test            # unit tests for pricing, units, names and parsing
npm run typecheck
```

## Code map

- `src/core/` — plain TypeScript, no React: units, spoken numbers, name matching
  across spellings and scripts, pricing and bills, the question parser and answers.
- `src/data/` — SQLite storage on the phone.
- `src/app/` — screens (Expo Router).
