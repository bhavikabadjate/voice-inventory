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
- **Khata (udhaar)**: by voice, "Ramesh ke khate mein 200 likho", "Ramesh ne 100
  jama kiye", "Ramesh ka kitna baki hai", "sabse zyada udhaar kiska hai", or right
  after a bill, "isko Ramesh ke khate mein daalo". The Khata tab lists who owes
  what, each customer's history, and sends a WhatsApp reminder with a UPI pay link.
  Entries are never edited or deleted; a mistake is fixed with an entry the other way.
- **Cloud backup and staff** (Shop tab): the owner signs in with a code sent to
  their email; the shop's products, stock and sales are then backed up and come
  back on a new phone. Staff join with the shop's 6-digit code. The owner decides
  per staff member whether they see cost price and whether they may delete
  products. Everything still works offline and syncs when the internet is back.

## Run it

Voice input uses `expo-speech-recognition`, which is not part of Expo Go, so the app
needs a development build:

```bash
npm install
npx expo run:android   # or: npx expo run:ios (macOS with Xcode)
```

Or build in the cloud with EAS: `npx eas-cli@latest login`, then `npx eas-cli@latest build --profile preview --platform android` gives an APK to install on any Android phone.

### In a browser

The same app runs on the web:

```bash
npx expo start --web                 # try it locally
npx expo export --platform web       # build the site into dist/
npx eas-cli@latest deploy --prod     # put it online with EAS Hosting
```

The local database needs two response headers, `Cross-Origin-Embedder-Policy: credentialless`
and `Cross-Origin-Opener-Policy: same-origin`. The dev server and EAS Hosting take them from
`app.json`; any other host has to send them itself.

On the web, voice input works in Chrome and Edge, a bill opens the print dialog (print it or
save as PDF) instead of sharing, and the shop's data lives in that browser and syncs once the
owner or staff member signs in.

## Cloud setup (Supabase, once)

1. In the Supabase SQL editor, run `supabase/migrations/20261010000000_shop_sync.sql`.
2. Authentication → Sign In / Providers: turn on **Anonymous sign-ins** (staff) and
   keep **Email** on (owner).
3. Authentication → Emails: in the **Magic link** and **Confirm signup** templates, include `{{ .Token }}` so the
   email carries a 6-digit code.

The project URL and publishable key are in `src/config.ts` (or set
`EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_KEY`). Never put the
service_role key in the app.

## Checks

```bash
npm test            # unit tests for pricing, units, names and parsing
npm run typecheck
supabase/tests/run.sh   # cloud access rules, against a local Postgres
```

## Code map

- `src/core/` — plain TypeScript, no React: units, spoken numbers, name matching
  across spellings and scripts, pricing and bills, the question parser and answers.
- `src/core/sync.ts` — how phones sync: outbox, stock as movements, cost only for
  people allowed to see it.
- `src/data/` — SQLite storage on the phone, and `cloud.ts` for Supabase.
- `supabase/` — cloud tables and access rules, with tests.
- `src/app/` — screens (Expo Router).
