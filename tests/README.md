# Tests

All of these run on a laptop with no Supabase account and no internet.

| Run | What it covers |
| --- | --- |
| `node tests/chat.test.js` | 120 spoken and typed sentences in Hindi, Marathi and English: what the app replies and what it saves. |
| `node tests/db.test.js` | The app running as several phones against a real Postgres with the shop's migrations (`tests/schema`): saving and reading back, two phones, staff permissions, offline work, dropped connections, expired sign-ins, older database setups, device storage, and the database used inside Claude. |
| `node tests/cloud.test.js` | Older, smaller khata sync checks against a hand-written fake. |
| `node tests/ui.test.js` | The page in a real browser: guide, forms, bill, khata, shop details, reload, dark mode, five screen sizes. |
| `node tests/browser-db.test.js` | The page in a real browser with the real `supabase-js` client; its network calls are answered by the same local Postgres. Sign-in, create shop, the Database check button, a staff phone, offline with the app closed and reopened, sign out and back in. |

Setup: `npm i @electric-sql/pglite playwright`. The two browser suites need this folder served first:
`python3 -m http.server 8765`.

`tests/pgfake.js` is the shared stand-in for Supabase. It applies the real migration files, runs every request
under the signed-in user's database role so row-level security is enforced by Postgres itself, and caps reads at
1000 rows the way Supabase does.

What these cannot cover: the live Supabase project itself (run **Database check** in the Shop tab of the hosted
site for that), real email delivery of the sign-in code, the microphone, and the Claude functions.
