# Boldstep

**AI-powered multi-client Meta Ads management system.**
Next.js 15 (App Router) · TypeScript · Tailwind · Firebase · GLM 5.3 with Claude fallback.

Boldstep pulls Meta Ads data for every client, has Hermes analyse it, and puts
each proposed change in front of you before it touches a live ad account.

---

## Run it in 60 seconds

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. **No credentials are needed to start.**

With no `.env.local`, the app runs in **mock mode**: a deterministic generated
dataset (4 clients, 10 campaigns, 90 days of daily insights) backs every screen.
Sign in, approve actions, upload creatives, export reports — all of it works.
The moment you fill in `.env.local`, the same code paths switch to real
services. No code changes.

### Demo access (mock mode only)

| Role | Credentials |
| --- | --- |
| Owner | `fadhil@boldstep.my` / `boldstep123` |
| Client — Nova Dental | `/auth/client/nova-dental` · PIN `123456` |
| Client — Zafran Property | `/auth/client/zafran-property` · PIN `234567` |
| Client — Kasih Tuition | `/auth/client/kasih-tuition` · PIN `345678` |

These exist **only** while Firebase credentials are absent, and mock mode is
hard-disabled in production. A deployed app with missing credentials refuses to
serve fabricated data rather than passing it off as real.

---

## Prerequisites

- **Node.js 18.18+** (developed on 24.x) — `node --version`
- npm 9+
- A Firebase project (Firestore + Storage) when you're ready for real data
- A Meta Ads access token with `ads_read` and `ads_management`

---

## Setup with real credentials

### 1. Create `.env.local`

```bash
cp .env.example .env.local     # macOS/Linux
```
```powershell
Copy-Item .env.example .env.local   # PowerShell
```

Every block in `.env.example` is optional. Anything you leave blank stays
mocked, so you can switch services on one at a time and verify each.

### 2. Generate your secrets

```bash
npm run hash -- --secrets
```

Prints `JWT_SECRET`, `ENCRYPTION_KEY` and `HERMES_API_KEY`. Paste them into
`.env.local`. Nothing is written to disk by the script.

### 3. Set your owner password

```bash
npm run hash -- "your-real-password"
```

Paste the resulting `OWNER_PASSWORD_HASH` into `.env.local` and set
`OWNER_EMAIL`. The plaintext password never appears in any file.

### 4. Connect Firebase

Firebase Console → Project Settings:

- **General → Your apps → Web app** → the six `NEXT_PUBLIC_FIREBASE_*` values
- **Service accounts → Generate new private key** → `FIREBASE_PROJECT_ID`,
  `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`

Paste the private key on **one line, in double quotes, keeping the literal
`\n`** exactly as it appears in the downloaded JSON:

```env
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEv…\n-----END PRIVATE KEY-----\n"
```

Then deploy the rules and indexes:

```bash
firebase deploy --only firestore:rules,firestore:indexes,storage
```

Restart `npm run dev` and check <http://localhost:3000/api/health> —
`mock_mode` should now be `false` and `firestore: true`.

> Firestore starts empty. You can add your first account straight from the
> dashboard — **Accounts → Add** in the sidebar — which writes the
> document and hashes the PIN for you. (To create one by hand instead, see
> [docs/SCHEMA.md](docs/SCHEMA.md) and `npm run hash -- --pin 123456`.)

### 5. Connect Meta, GLM, Telegram

Fill in `META_ACCESS_TOKEN` / `META_AD_ACCOUNT_ID`, `GLM_API_KEY`,
`TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID`. Each flips its own service from mock
to live independently — `/api/health` tells you which are which at any moment.

---

## Local test checklist

Run through this after `npm run dev`:

- [ ] `/api/health` responds and reports which services are live
- [ ] Owner login works; a wrong password shows a clear error
- [ ] Client link + PIN works; a wrong PIN is rejected
- [ ] Account dashboard shows spend, leads, CPL, CTR
- [ ] Owner dashboard shows all three sections (Accounts / Main Account / Hermes)
- [ ] Switching accounts in the sidebar reloads that account's data
- [ ] **Add** in the sidebar creates an account; the link auto-fills from the name
- [ ] The new account can log in with the PIN you set
- [ ] **Edit** renames an account without invalidating its existing PIN
- [ ] **Delete** stays disabled until you type the account's exact name
- [ ] After deleting, that account's data and login are gone
- [ ] Campaign table sorts by clicking a column header
- [ ] Trend chart renders and switches between Spend/Leads, CPL and CTR
- [ ] Date range 7D / 14D / 30D / 90D changes the numbers
- [ ] Hermes chat returns a response with real context for the selected client
- [ ] Pending approvals list shows suggestions
- [ ] Approve → confirmation dialog → status becomes `executed`
- [ ] Deciding the same action twice is refused
- [ ] Creative upload accepts an image; a `.txt` is rejected
- [ ] Creative library lists the upload and downloads it back
- [ ] Manual entry form saves and appears in Entry History
- [ ] PDF export downloads a real PDF
- [ ] CSV export downloads and opens in Excel
- [ ] Responsive at 375px — no horizontal page scroll
- [ ] No console errors

Verify the whole API surface at once with:

```bash
npm run typecheck && npm run build
```

---

## How it fits together

```
Browser ──► Next.js API routes ──► lib/firestore.ts ──┬──► Firestore (credentials present)
                                                      └──► in-memory mock store (absent)
                     │
                     ├──► lib/meta-api.ts     → Meta Graph API  │ or generated rows
                     ├──► lib/glm-client.ts   → GLM 5.3 → Claude │ or [MOCK] heuristic
                     ├──► lib/telegram.ts     → Telegram Bot     │ or console log
                     └──► lib/storage.ts      → Cloud Storage    │ or in-memory bytes
```

**Nothing reads Firestore from the browser.** Every screen calls the REST API,
so the dashboard and a third-party integration go through identical auth,
scoping and validation. That is what makes the system API-first rather than
API-shaped.

The fallback lives in one place per service, behind a single `isConfigured`
check — which is why "fill in `.env.local` and it becomes real" holds without a
single code change.

### Project layout

```
src/
├─ app/
│  ├─ api/            All REST endpoints (App Router route handlers)
│  ├─ auth/           Owner login, client link+PIN
│  ├─ dashboard/      Owner dashboard, client report
│  └─ docs/           In-app API reference
├─ components/
│  ├─ auth/  common/  creatives/  dashboard/  hermes/  manual-entry/  reports/
├─ constants/         Theme, endpoints, form options
├─ hooks/             useAuth, useFirestore, useClientData, usePendingApprovals
├─ lib/               Data layer, auth, Meta/GLM/Telegram/Storage clients, export
└─ types/             Shared TypeScript contracts
docs/
├─ API.md             Full API reference with examples
└─ SCHEMA.md          Firestore collections, indexes, rules
```

### A note on the API route layout

The brief lists routes as `login.ts`, `chat.ts`, `upload.ts` — the Pages Router
convention. This project uses the **App Router**, where a route lives at
`app/api/<path>/route.ts` and exports `GET` / `POST` / `PUT`. Every endpoint URL
in the brief is unchanged; only the file that implements it moved. For example
`POST /api/auth/login` lives at `src/app/api/auth/login/route.ts`.

---

## Security

- **No secrets in code.** Every credential is read through `src/lib/env.ts`;
  nothing else touches `process.env` for a secret.
- **`.env*` is git-ignored** (`.env.example` excepted).
- **Passwords** use scrypt with a per-password salt — no native build step.
- **PINs** are SHA-256 hashed, matching the schema in the brief, and rate
  limited to 8 attempts per minute per link+IP.
- **Meta tokens** are encrypted at rest with AES-256-GCM.
- **API keys** are stored as SHA-256 hashes; the plaintext is shown once.
- **Client sessions are scoped server-side.** Editing the URL to another
  client's id returns 403 — the session, not the URL, decides what loads.
- **Secrets are stripped from responses**: `access_pin_hash`,
  `access_token_encrypted` and webhook signing secrets never leave the server.
- **CSV formula injection** is neutralised in every generated CSV.
- **Mock mode cannot run in production** unless you set
  `BOLDSTEP_ALLOW_MOCK=true` deliberately.

---

## Deploy to Vercel

1. Push to GitHub.
2. vercel.com → **Import Project** → select the repo.
3. **Settings → Environment Variables** → add every value from `.env.local`.
   Set `NEXT_PUBLIC_APP_URL` to your production URL (it's what Telegram
   approval links point at).
4. Deploy, then check `https://<your-app>/api/health`.
5. Point `boldstep.my` at the deployment.

`JWT_SECRET` is **required** in production — the app refuses to start without
it, rather than silently signing sessions with a throwaway key.

---

## What's not in Phase 1

Deliberately out of scope, per the brief:

- **The Hermes agent itself** — a separate process. This app provides the API it
  calls: `POST /api/meta/sync`, `POST /api/approvals`, `POST /api/hermes/execute`,
  authenticated with `HERMES_API_KEY`.
- **Scheduled Meta pulling** — Hermes' cron drives it; the endpoint is ready.
- **Outbound webhook delivery** — registration, payload shape and HMAC signing
  are fixed and documented; flip `WEBHOOK_DISPATCH_ENABLED` in
  `src/lib/webhooks.ts` in Phase 2.
- **Full OAuth2**, video editing, Google/TikTok Ads — Phases 2–3.

`POST /api/hermes/chat` does call GLM directly when `GLM_API_KEY` is set, so the
chat panel is useful before the agent exists.

---

## Phase 2: Hermes agent + webhook delivery

Phase 2 turns the Phase 1 foundations on:

### Hermes agent (`hermes/agent.mjs`)

A standalone Node.js process, separate from the app, that talks to it over REST
only — the same API any integration uses. Each cycle it:

1. pulls fresh Meta insights for every client (`POST /api/meta/sync`)
2. analyses the last 7 days per campaign (GLM 5.3 when `GLM_API_KEY` is set; a
   deterministic local heuristic otherwise — CPL up ≥40% suggests pause, down
   ≥25% suggests a 20% scale)
3. files worthwhile suggestions as pending actions (`POST /api/approvals`) —
   which sends the Telegram approval notification
4. auto-executes them only if `auto_execute` is on in Hermes settings

The schedule honours the frequency set in the dashboard's Hermes settings
(6h / 12h / 24h); `HERMES_INTERVAL_HOURS` overrides it.

```bash
# one cycle now (great for testing)
npm run hermes

# scheduled, honours dashboard frequency
npm run hermes:watch
```

Both need `HERMES_API_KEY` in the agent's environment — the same value the app
has in `.env.local` (see `.env.example` for how to generate it).

### Webhook delivery

Set `WEBHOOK_DISPATCH_ENABLED=true` and registered webhooks are actually
delivered: HMAC-SHA256-signed POSTs (`X-Boldstep-Signature: sha256=…`) with
exponential-backoff retries (1s / 5s / 30s), a 10s delivery timeout, and
per-hook failure tracking. A hook that accumulates 10 consecutive failures is
disabled so a dead endpoint cannot stall the pipeline; re-register or set
`active` back to true to re-enable. With the flag unset, events are recorded
but not sent, exactly as in Phase 1.

### Still out of scope

- **Real Meta Ads pulling** — works the moment `META_ACCESS_TOKEN` is set; the
  agent already calls the same sync endpoint.
- **CRM connectors** (Pipedrive, HubSpot) — the sync endpoints are live; the
  connectors themselves are Phase 2b.
- **Video editing** (Runway API), **full OAuth2**, Google/TikTok Ads — Phase 3.

---

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server on :3000 |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm run hermes` | Hermes agent — one analysis cycle now |
| `npm run hermes:watch` | Hermes agent — scheduled cycles |
| `npm run typecheck` | TypeScript, no emit |
| `npm run lint` | ESLint |
| `npm run hash -- --secrets` | Generate JWT/encryption/Hermes secrets |
| `npm run hash -- "password"` | Hash an owner password |
| `npm run hash -- --pin 123456` | Hash a client PIN |

---

## Troubleshooting

**Everything 401s after a while in development.**
Set `JWT_SECRET` in `.env.local`. Without it a development key is generated and
cached at `.next/cache/boldstep-dev-secret`; deleting `.next` invalidates
existing sessions. Log in again.

**`mock_mode` is still `true` after adding Firebase credentials.**
Restart the dev server — environment variables are read at boot. Then check the
server console: a malformed `FIREBASE_PRIVATE_KEY` logs a specific error and
falls back. The usual cause is missing double quotes or unescaped newlines.

**"The query requires an index."**
Run `firebase deploy --only firestore:indexes`, or click the link Firestore
prints in the error.

**Meta sync returns `"mode": "mock"`.**
`META_ACCESS_TOKEN` isn't set, or is a placeholder. `/api/health` confirms.

**PDF export is slow on the first call.**
The PDF library is loaded on demand; the first request compiles it. Subsequent
exports are fast.
