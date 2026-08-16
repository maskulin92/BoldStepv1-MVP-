# Boldstep API

Version `1.0.0` · Base URL `http://localhost:3000` locally, `https://boldstep.my` in production.

Boldstep is built API-first: the dashboard is simply the first consumer of these
endpoints. Anything the UI can do, an integration can do with an API key.

---

## Contents

1. [Getting started](#getting-started)
2. [Response format](#response-format)
3. [Authentication](#authentication)
4. [Rate limiting](#rate-limiting)
5. [Error codes](#error-codes)
6. [Endpoints](#endpoints)
   - [Auth](#auth) · [Clients](#clients) · [Campaigns](#campaigns) · [Insights](#insights)
   - [Approvals](#approvals) · [Hermes](#hermes) · [Creatives](#creatives)
   - [Manual entry](#manual-entry) · [Reports](#reports) · [Integrations](#integrations)
7. [Webhooks](#webhooks)
8. [Integration recipes](#integration-recipes)

---

## Getting started

Check what is live and what is mocked:

```bash
curl http://localhost:3000/api/health
```

```json
{
  "success": true,
  "data": {
    "status": "ok",
    "mock_mode": true,
    "environment": "development",
    "services": {
      "firestore": false, "storage": false, "meta_ads": false,
      "glm": false, "claude": false, "telegram": false
    }
  },
  "meta": { "timestamp": "2026-08-16T12:00:00.000Z", "request_id": "…", "version": "1.0.0" }
}
```

`mock_mode: true` means Firebase credentials are absent and the API is serving a
generated dataset. Every endpoint behaves identically either way.

Then sign in and call something:

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"fadhil@boldstep.my","password":"boldstep123"}' \
  | python -c "import sys,json; print(json.load(sys.stdin)['data']['token'])")

curl http://localhost:3000/api/clients -H "Authorization: Bearer $TOKEN"
```

---

## Response format

Every endpoint returns one of three envelopes.

**Success**

```json
{
  "success": true,
  "data": { },
  "meta": { "timestamp": "ISO-8601", "request_id": "uuid", "version": "1.0.0" }
}
```

**List** (adds pagination)

```json
{
  "success": true,
  "data": [ ],
  "pagination": { "page": 1, "per_page": 50, "total": 4, "total_pages": 1 },
  "meta": { "timestamp": "ISO-8601", "request_id": "uuid", "version": "1.0.0" }
}
```

**Error**

```json
{
  "success": false,
  "error": {
    "code": "INVALID_CLIENT_ID",
    "message": "No client with id \"acme\".",
    "details": { }
  },
  "meta": { "timestamp": "ISO-8601", "request_id": "uuid", "version": "1.0.0" }
}
```

Always branch on `success`, not on the HTTP status. `request_id` appears in the
server log for the same request — quote it when reporting a problem.

List endpoints accept `?page=` and `?per_page=` (max 200, default varies by
endpoint).

---

## Authentication

Three credential types, all sent as `Authorization: Bearer <token>`.

| Type | Obtained from | Lifetime | Reaches |
| --- | --- | --- | --- |
| Owner JWT | `POST /api/auth/login` | 7 days | Everything |
| Client JWT | `POST /api/auth/verify-pin` | 30 days | Read-only, that client only |
| API key | `POST /api/integrations/auth/generate-key` | Configurable (default 365d) | `/api/integrations/*` |

Login also sets an `httpOnly` `boldstep_session` cookie. That is what makes
authenticated file downloads work from a plain `<a href>` — the browser sends
the cookie where it cannot send a header.

**Scoping.** A client JWT can only ever read its own client. Passing another
client's id returns `403 FORBIDDEN`; this is enforced server-side on every
client-scoped route, not in the UI.

**Hermes.** Set `HERMES_API_KEY` in the environment and the agent authenticates
with it directly, before any key has been minted through the UI. It carries
`read`, `write` and `execute`.

---

## Rate limiting

100 requests per minute per credential by default. Expensive endpoints have
their own smaller budgets, each in a **separate bucket** — using up your
`/api/clients` allowance does not block report generation.

| Scope | Limit / min |
| --- | --- |
| Default (`api`) | 100 |
| `POST /api/auth/login`, `/api/auth/verify-pin` | 10 / 8 per IP |
| `hermes-chat` | 40 |
| `meta-sync`, `hermes-execute`, `creatives-upload` | 30 |
| `reports`, `api-keys` | 20 |

Exceeding a budget returns `429` with `RATE_LIMIT_EXCEEDED` and
`details.retry_after_seconds`.

> The limiter is in-memory and per-instance — correct for a single Vercel
> instance or local development. A shared store (Redis/Upstash) is Phase 3.

---

## Error codes

| Code | HTTP | Meaning |
| --- | --- | --- |
| `UNAUTHORIZED` | 401 | Missing or invalid token |
| `INVALID_CREDENTIALS` | 401 | Wrong email or password |
| `INVALID_PIN` | 401 | Wrong access code for that link |
| `INVALID_API_KEY` | 401 | Endpoint requires an API key, not a JWT |
| `FORBIDDEN` | 403 | Authenticated, but not for this resource |
| `INSUFFICIENT_PERMISSIONS` | 403 | Credential lacks `read`/`write`/`execute` |
| `NOT_FOUND` | 404 | No such resource |
| `INVALID_CLIENT_ID` | 404 | No such client |
| `INVALID_CAMPAIGN_ID` | 404 | No such campaign for that client |
| `ACTION_NOT_FOUND` | 404 | No such pending action |
| `CREATIVE_NOT_FOUND` | 404 | No such creative |
| `ACTION_ALREADY_RESOLVED` | 409 | That action was already decided |
| `FILE_TOO_LARGE` | 413 | Upload over 50 MB |
| `UNSUPPORTED_FILE_TYPE` | 415 | Not an accepted creative format |
| `VALIDATION_ERROR` | 422 | Bad input — see `details` per field |
| `RATE_LIMIT_EXCEEDED` | 429 | Slow down |
| `NOT_CONFIGURED` | 501 | Feature needs a credential that isn't set |
| `UPSTREAM_ERROR` | 502 | Meta / GLM / Telegram failed |
| `INTERNAL_ERROR` | 500 | Unexpected — check the server log for `request_id` |

`VALIDATION_ERROR` names the offending fields:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "One or more fields are invalid.",
    "details": { "pin": "PIN must be exactly 6 digits" }
  }
}
```

---

## Endpoints

### Auth

#### `POST /api/auth/login`

```json
{ "email": "fadhil@boldstep.my", "password": "…" }
```

```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiJ9…",
    "refreshToken": "eyJhbGciOiJIUzI1NiJ9…",
    "user": { "id": "owner_fadhil", "email": "fadhil@boldstep.my", "permissions": ["read","write","execute"], "role": "owner" }
  }
}
```

#### `POST /api/auth/verify-pin`

```json
{ "link_id": "nova-dental", "pin": "123456" }
```

```json
{
  "success": true,
  "data": {
    "token": "eyJ…",
    "client": { "id": "nova-dental", "name": "Nova Dental Clinic", "goal": "leads", "link_id": "nova-dental" }
  }
}
```

#### `POST /api/auth/logout` · `GET /api/auth/me`

`logout` clears the cookie. `me` resolves the current token:

```json
{ "success": true, "data": { "id": "owner_fadhil", "role": "owner", "kind": "session", "permissions": ["read","write","execute"], "client": null } }
```

---

### Clients

#### `GET /api/clients`

Owner sees every client; a client session sees only itself. Secrets
(`access_pin_hash`, `access_token_encrypted`) are never included.

#### `POST /api/clients` — owner only, needs `write`

Creates a client account with its own access link and code.

```json
{
  "name": "Sari Wellness Spa",
  "link_id": "sari-wellness-spa",
  "pin": "314159",
  "primary_goal": "leads",
  "ad_account_id": "act_123456789",
  "meta_access_token": "EAAG…"
}
```

```json
{
  "success": true,
  "data": {
    "client": { "id": "sari-wellness-spa", "name": "Sari Wellness Spa", "link_id": "sari-wellness-spa", "…": "…" },
    "access_url": "/auth/client/sari-wellness-spa"
  }
}
```

- `link_id` must be 3–48 characters of lowercase letters, numbers and hyphens,
  and unique across clients. A duplicate returns `422 VALIDATION_ERROR`.
- `pin` is exactly 6 digits, hashed on save and **never readable again**.
- `meta_access_token` is optional and encrypted at rest; omit it to fall back to
  the account-wide `META_ACCESS_TOKEN`.

#### `GET /api/clients/{clientId}`

```json
{
  "success": true,
  "data": {
    "client": { "id": "nova-dental", "name": "Nova Dental Clinic", "primary_goal": "leads", "…": "…" },
    "recent_campaigns": [ ],
    "summary_7d": { "total_spend": 1570.67, "total_leads": 48, "avg_cpl": 32.72, "…": "…" },
    "pending_actions_count": 1,
    "settings": { "notification_enabled": true, "auto_execute": false, "notification_channel": "telegram" }
  }
}
```

#### `PUT /api/clients/{clientId}` — owner only

```json
{ "name": "Nova Dental", "primary_goal": "leads", "settings": { "notification_enabled": false } }
```

`settings` is merged, not replaced, so a partial update can't drop a flag.

Optional fields `pin`, `link_id` and `meta_access_token` are **only applied when
present** — saving a name change never silently rotates the PIN. The response
reports `pin_rotated` so the UI can warn that existing client sessions are now
invalid. Moving `link_id` onto another client's link returns `422`.

#### `DELETE /api/clients/{clientId}?confirm={exact name}` — owner only, needs `execute`

**Irreversible.** Deletes the client together with its campaigns, ad sets,
insights, pending actions, manual entries, creatives and stored files.

```bash
curl -X DELETE "http://localhost:3000/api/clients/sari-wellness-spa?confirm=Sari%20Wellness%20Spa" \
  -H "Authorization: Bearer $TOKEN"
```

```json
{
  "success": true,
  "data": {
    "deleted": true,
    "client_id": "sari-wellness-spa",
    "name": "Sari Wellness Spa",
    "deleted_documents": 97,
    "deleted_files": true
  }
}
```

Two guards, both server-side:

- `?confirm=` must match the client's **exact name**, or the call returns `422`.
  A mistyped id cannot wipe the wrong account.
- The client with `is_owner: true` cannot be deleted (`403`) — Section B of the
  dashboard is built around it.

Firestore does not cascade deletes, so each subcollection is drained explicitly.
Skipping that would leave orphaned documents that `collectionGroup` queries
still pick up. Once deleted, the `link_id` is free to reuse.

---

### Campaigns

#### `GET /api/campaigns/{clientId}?startDate=&endDate=&days=`

Defaults to the last 7 days. Each campaign carries a `stats` object for the
window, plus an overall `summary`.

```json
{
  "success": true,
  "data": {
    "campaigns": [
      {
        "id": "cmp-nova-implant",
        "name": "Nova — Dental Implant Leads",
        "status": "ACTIVE",
        "budget_daily": 120,
        "stats": { "total_spend": 797.66, "total_leads": 24, "avg_cpl": 33.24, "avg_ctr": 1.62 }
      }
    ],
    "range": { "start": "2026-08-10", "end": "2026-08-16" },
    "summary": { "total_spend": 1570.67, "total_leads": 48, "avg_cpl": 32.72 }
  }
}
```

#### `GET /api/campaigns/{clientId}/{campaignId}`

Returns `campaign`, `ad_sets` (each with rolled-up `stats`), `insights_7d`,
`insights_30d`, `trend_30d`, `summary_7d`, `summary_30d`, `pending_actions`.

---

### Insights

#### `GET /api/meta/insights/{clientId}?startDate=&endDate=&campaignId=&days=`

Reads stored insights — it never calls Meta.

```json
{
  "success": true,
  "data": {
    "insights": [ { "date": "2026-08-16", "campaign_id": "…", "spend": 118.4, "leads": 4, "cpl": 29.6, "…": "…" } ],
    "trend":    [ { "date": "2026-08-16", "spend": 118.4, "leads": 4, "cpl": 29.6, "ctr": 1.7 } ],
    "summary":  { "total_spend": 1570.67, "total_leads": 48, "avg_cpl": 32.72 },
    "range":    { "start": "2026-08-10", "end": "2026-08-16" }
  }
}
```

#### `POST /api/meta/sync` — owner or Hermes key, needs `write`

```json
{ "client_id": "nova-dental", "start_date": "2026-08-01", "end_date": "2026-08-16" }
```

```json
{
  "success": true,
  "data": {
    "synced_at": "2026-08-16T12:00:00.000Z",
    "mode": "mock",
    "range": { "start": "2026-08-01", "end": "2026-08-16" },
    "records_updated": 48,
    "campaigns_updated": 0,
    "ad_sets_updated": 0,
    "note": "META_ACCESS_TOKEN is not set — generated rows were written instead of live Meta data."
  }
}
```

`mode` is `"live"` once `META_ACCESS_TOKEN` is set. This is the endpoint the
Hermes cron calls daily.

---

### Approvals

#### `GET /api/approvals?status=pending|approved|rejected|executed|all&client_id=`

Owner only. Newest first.

#### `POST /api/approvals` — how Hermes files a suggestion

```json
{
  "client_id": "nova-dental",
  "campaign_id": "cmp-nova-implant",
  "adset_id": "cmp-nova-implant-as3",
  "action_type": "pause",
  "from_model": "glm-5-3",
  "suggestion_text": "Pause ad set \"Implant Leads · Interest Stack\"",
  "reason": "CPL rose from RM24 to RM39 over 7 days against a RM28 target.",
  "metadata": { "current_cpl": 39.4, "target_cpl": 28, "performance_change": 64.2 }
}
```

Creating an action sends the Telegram notification carrying the approval deep
link (`/dashboard?action={id}`).

#### `POST /api/approvals/{actionId}` — decide

```json
{ "decision": "approved" }
{ "decision": "rejected", "note": "Two-day spike, leaving it." }
{ "decision": "modified", "modified_params": { "budget": 300 }, "note": "Scaled 20% not 40%." }
```

```json
{
  "success": true,
  "data": {
    "action": { "id": "act-002", "status": "executed", "fadhil_decision": "…", "executed_at": "…" },
    "meta_result": {
      "ok": true,
      "mode": "mock",
      "message": "[MOCK] Would POST to Meta object cmp-zaf-condo with {\"daily_budget\":30000}…",
      "applied": { "daily_budget": 30000 },
      "executed_at": "2026-08-16T12:00:00.000Z"
    }
  }
}
```

`approved` and `modified` execute against Meta immediately, update the stored
campaign, append to Hermes' approval log and notify Telegram. An action can only
be decided once — a second attempt returns `409 ACTION_ALREADY_RESOLVED`.

Budgets are sent to Meta in the minor currency unit (sen), so `RM 300` becomes
`30000`.

---

### Hermes

#### `POST /api/hermes/chat`

```json
{ "message": "Which campaign has the worst CPL?", "client_id": "nova-dental", "history": [] }
```

Loads the client's last 14 days, compacts it into a context block and asks GLM
5.3 (falling back to Claude, then to a local heuristic marked `[MOCK]`).

```json
{
  "success": true,
  "data": {
    "response": "…",
    "model": "glm-5.3",
    "is_mock": false,
    "suggestions": [],
    "timestamp": "2026-08-16T12:00:00.000Z"
  }
}
```

#### `GET|PUT /api/hermes/settings`

```json
{ "frequency": "12h", "auto_execute": false, "notification_channel": "telegram", "monitored_campaigns": "all" }
```

`GET` also returns `agent_connected` and `notifications_configured`.

#### `GET /api/hermes/memory`

```json
{
  "success": true,
  "data": {
    "patterns": [ { "pattern_id": "weekend-cpl-spike", "description": "…", "frequency": 11, "confidence": 0.82, "examples": ["…"], "last_seen": "…" } ],
    "approval_history": [ { "decision": "approved", "campaign": "…", "reason": "…", "outcome": "…", "timestamp": "…" } ],
    "counts": { "patterns": 4, "decisions": 6, "approved": 3, "rejected": 2, "modified": 1 }
  }
}
```

#### `POST /api/hermes/execute`

```json
{ "action_id": "act-001" }
```

Applies an action with no human decision. **Refused with `403` unless
`auto_execute` is enabled** in Hermes settings — which is off by default, per
the MVP brief.

---

### Creatives

#### `POST /api/creatives/upload` — `multipart/form-data`

Fields: `file`, `client_id`, `campaign_id`, `adset_id?`.
Max 50 MB. Accepts `image/jpeg|png|webp|gif`, `video/mp4|quicktime|webm`.

```bash
curl -X POST http://localhost:3000/api/creatives/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@./ad.png" -F "client_id=nova-dental" -F "campaign_id=cmp-nova-implant"
```

```json
{
  "success": true,
  "data": {
    "creative_id": "crv-1a2b3c4d",
    "download_url": "/api/creatives/download/crv-1a2b3c4d",
    "expires_at": "2026-08-23T12:00:00.000Z",
    "creative": { "…": "…" }
  }
}
```

#### `GET /api/creatives/{clientId}?campaign_id=`

#### `GET /api/creatives/download/{creativeId}`

302-redirects to a valid signed URL, re-signing first if the stored one has
passed its 7-day window. In mock mode it streams the bytes directly.

---

### Manual entry

#### `POST /api/manual-entry`

```json
{
  "client_id": "nova-dental",
  "campaign_id": "cmp-nova-implant",
  "metric_type": "sales_value",
  "value": 5200,
  "date": "2026-08-15",
  "notes": "Closed via WhatsApp follow-up"
}
```

`metric_type` is `leads_closed`, `sales_value` or `conversion_custom`.

#### `GET /api/manual-entry/{clientId}?date=&startDate=&endDate=`

---

### Reports

#### `POST /api/reports/pdf` · `POST /api/reports/csv`

```json
{ "client_id": "nova-dental", "date_range": { "start": "2026-08-01", "end": "2026-08-16" } }
```

```json
{
  "success": true,
  "data": {
    "report_id": "cmVwb3J0cy9ub3ZhLWRlbnRhbC8…",
    "file_name": "boldstep-nova-dental-2026-08-01_2026-08-16.pdf",
    "download_url": "/api/reports/download/cmVwb3J0cy9ub3ZhLWRlbnRhbC8…",
    "pdf_url": "/api/reports/download/cmVwb3J0cy9ub3ZhLWRlbnRhbC8…",
    "expires_at": "2026-08-23T12:00:00.000Z",
    "size_bytes": 39724,
    "format": "pdf"
  }
}
```

Then `GET` the `download_url` with the same credential. The PDF carries the
Boldstep header, KPI cards, campaign table and daily detail. The CSV contains
summary, campaign breakdown, daily detail and manual entries in one file.

---

### Integrations

All `/api/integrations/*` routes require an **API key**, not a JWT.

#### `POST /api/integrations/auth/generate-key`

Auth: owner JWT.

```json
{ "name": "Zapier production", "expires_in_days": 365, "permissions": ["read", "write"] }
```

```json
{
  "success": true,
  "data": {
    "api_key": "boldstep_sk_9f3c…",
    "key_id": "key-1a2b3c4d",
    "permissions": ["read", "write"],
    "expires_at": "2027-08-16T12:00:00.000Z",
    "status": "active",
    "warning": "Store this key now — it is not retrievable after this response."
  }
}
```

Only a SHA-256 hash is stored. `GET` the same path to list existing keys.

#### `GET /api/integrations/auth/verify`

```json
{ "success": true, "data": { "valid": true, "key_name": "Zapier production", "owner_id": "owner_fadhil", "permissions": ["read","write"], "expires_at": "…", "rate_limit": { "requests_per_minute": 100 } } }
```

#### `GET /api/integrations/export/campaigns/{clientId}` · `.../insights/{clientId}`

Query: `?format=json|csv&startDate=&endDate=&campaignId=&page=&per_page=`.
`format=csv` returns a UTF-8 CSV download; `format=json` returns the paginated
list envelope.

#### `POST /api/integrations/sync/conversions` — needs `write`

```json
{
  "client_id": "nova-dental",
  "campaign_id": "cmp-nova-implant",
  "conversions": [
    { "date": "2026-08-14", "value": 3, "metric_type": "leads_closed" },
    { "date": "2026-08-15", "value": 7900, "metric_type": "sales_value", "notes": "Stripe" }
  ]
}
```

```json
{ "success": true, "data": { "entries_created": 2, "entry_ids": ["man-…", "man-…"] } }
```

#### `POST /api/integrations/sync/crm` — needs `write`

```json
{
  "client_id": "nova-dental",
  "source": "pipedrive",
  "records": [
    { "campaign_id": "cmp-nova-implant", "date": "2026-08-15", "leads_closed": 2, "sales_value": 3100 }
  ]
}
```

```json
{ "success": true, "data": { "source": "pipedrive", "synced_count": 2, "skipped_count": 1, "skipped": [ { "campaign_id": "ghost", "reason": "unknown campaign for this client" } ] } }
```

Unknown campaign ids are **skipped and reported**, not fatal — one stale row in
a CRM export shouldn't reject the whole batch.

---

## Webhooks

Registration is live now; **delivery is live in Phase 2** — set
`WEBHOOK_DISPATCH_ENABLED=true` in the app's environment and registered hooks
are delivered as they happen. With the flag unset, events are recorded but not
sent. The payload shape and signature scheme are fixed, so you can build
against them today.

#### `POST /api/integrations/webhooks/register`

```json
{ "event": "action.executed", "webhook_url": "https://example.com/hooks/boldstep", "active": true }
```

```json
{
  "success": true,
  "data": {
    "webhook_id": "wh-1a2b3c4d",
    "event": "action.executed",
    "signing_secret": "b3f1…",
    "dispatch_enabled": false,
    "note": "Registered. Set WEBHOOK_DISPATCH_ENABLED=true in the environment to deliver events."
  }
}
```

`signing_secret` is shown once and never returned by
`GET /api/integrations/webhooks/list`.

**Events:** `insight.synced`, `action.created`, `action.approved`,
`action.executed`, `creative.uploaded`, `manual_entry.created`.

**Delivery.** `POST` with headers `X-Boldstep-Event` and
`X-Boldstep-Signature: sha256=<hmac>`, where the HMAC is SHA-256 over the raw
body using your signing secret. Failed deliveries retry with backoff
(1s / 5s / 30s, 10s timeout each). A hook that accumulates 10 consecutive
failures is disabled; re-register to re-enable it.

```json
{ "event": "action.executed", "delivered_at": "2026-08-16T12:00:00.000Z", "data": { } }
```

Verify in Node:

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

function verify(rawBody, header, secret) {
  const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(header ?? '');
  return a.length === b.length && timingSafeEqual(a, b);
}
```

---

## The Hermes agent (Phase 2)

`hermes/agent.mjs` is the background process from the brief. It uses only the
REST API above — the same surface any integration gets — authenticated with
`HERMES_API_KEY`. One cycle:

1. `POST /api/meta/sync` for every client
2. analyse the last 7 days per campaign (GLM 5.3 with `GLM_API_KEY`, or a
   deterministic local heuristic without it)
3. `POST /api/approvals` for each worthwhile suggestion — which also sends the
   Telegram notification with the approval link
4. `POST /api/hermes/execute` only when `auto_execute` is enabled in Hermes
   settings

```bash
npm run hermes         # one cycle now
npm run hermes:watch   # scheduled — honours the dashboard frequency (6h/12h/24h)
```

Environment: `HERMES_API_KEY` (required, same value as the app's), 
`BOLDSTEP_API_URL` (default `http://localhost:3000`),
`HERMES_INTERVAL_HOURS` (0 = use the dashboard frequency),
`GLM_API_KEY` / `GLM_API_BASE` / `GLM_MODEL` for real model analysis.

---

## Integration recipes

### Nightly Meta sync from Hermes

```bash
curl -X POST https://boldstep.my/api/meta/sync \
  -H "Authorization: Bearer $HERMES_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"client_id":"nova-dental"}'
```

### File a suggestion after analysis

```bash
curl -X POST https://boldstep.my/api/approvals \
  -H "Authorization: Bearer $HERMES_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "client_id": "nova-dental",
    "campaign_id": "cmp-nova-implant",
    "action_type": "pause",
    "suggestion_text": "Pause ad set Interest Stack",
    "reason": "CPL RM39 vs RM28 target for 7 days.",
    "metadata": { "current_cpl": 39.4, "target_cpl": 28 }
  }'
```

Fadhil gets a Telegram message with a link straight to the approval.

### Push closed deals from a CRM

```bash
curl -X POST https://boldstep.my/api/integrations/sync/crm \
  -H "Authorization: Bearer $API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"client_id":"nova-dental","source":"hubspot","records":[
        {"campaign_id":"cmp-nova-implant","date":"2026-08-15","leads_closed":2,"sales_value":3100}]}'
```

### Pull a client's numbers into a spreadsheet

```bash
curl -o insights.csv \
  "https://boldstep.my/api/integrations/export/insights/nova-dental?format=csv&startDate=2026-08-01&endDate=2026-08-31" \
  -H "Authorization: Bearer $API_KEY"
```
