# Firestore Schema

## How paths map to the brief

Firestore alternates collection / document segments, so a path written as
`campaigns/{clientId}/{campaignId}` in the brief needs a named subcollection in
between. Each subcollection gets a **distinct** name so `collectionGroup()`
queries (for example "every pending action across all clients") stay
unambiguous.

| Brief notation | Actual Firestore path |
| --- | --- |
| `clients/{clientId}` | `clients/{clientId}` |
| `campaigns/{clientId}/{campaignId}` | `campaigns/{clientId}/campaign_items/{campaignId}` |
| `ad_sets/{clientId}/{campaignId}/{adSetId}` | `ad_sets/{clientId}/adset_items/{adSetId}` (with a `campaign_id` field) |
| `daily_insights/{clientId}/{date}/{campaignId}` | `daily_insights/{clientId}/insight_items/{date}_{campaignId}` |
| `pending_actions/{clientId}/{actionId}` | `pending_actions/{clientId}/action_items/{actionId}` |
| `manual_entries/{clientId}/{date}/{entryId}` | `manual_entries/{clientId}/entry_items/{entryId}` (with a `date` field) |
| `creatives/{clientId}/{creativeId}` | `creatives/{clientId}/creative_items/{creativeId}` |
| `hermes_memory/patterns` | `hermes_memory/patterns` |
| `hermes_memory/approvals_log` | `hermes_memory/approvals_log` |
| `auth_users/owner_fadhil` | `auth_users/{userId}` |

Two collections exist beyond the brief, both required by Section 7:
`api_keys/{keyId}` and `webhooks/{webhookId}`.

Flattening `{date}` into the document id (rather than making it a collection
segment) is what allows a single ranged query
`where('date', '>=', start).where('date', '<=', end)` to serve every date-range
screen. A date-as-collection layout would need one read per day.

**Timestamps are ISO-8601 strings, not Firestore `Timestamp` objects**, so a
document round-trips through JSON unchanged between the API, Hermes and any
integration.

---

## Collections

### `clients/{clientId}`

```ts
{
  name: string;
  link_id: string;                  // the /client/[linkId] URL segment
  ad_account_id: string;            // "act_123456789"
  access_token_encrypted: string;   // AES-256-GCM, "v1:iv:tag:ciphertext"
  access_pin_hash: string;          // SHA-256 of the 6-digit PIN
  primary_goal: 'leads' | 'conversions' | 'traffic';
  created_at: string;               // ISO-8601
  is_owner: boolean;                // true for Fadhil's own ad account
  settings: {
    notification_enabled: boolean;
    auto_execute: boolean;
    notification_channel: 'telegram';
  };
}
```

`access_token_encrypted` and `access_pin_hash` are stripped by
`toPublicClient()` before any API response — they never reach a browser.

Generate a PIN hash: `npm run hash -- --pin 123456`

### `campaigns/{clientId}/campaign_items/{campaignId}`

```ts
{
  client_id: string;
  name: string;
  objective: 'LEAD_GENERATION' | 'CONVERSIONS' | 'TRAFFIC';
  status: 'ACTIVE' | 'PAUSED' | 'ARCHIVED';
  budget_daily: number;             // RM, already converted from Meta's sen
  created_at: string;
  last_synced: string;
  meta_campaign_id: string;
}
```

### `ad_sets/{clientId}/adset_items/{adSetId}`

```ts
{
  client_id: string;
  campaign_id: string;              // indexed — see firestore.indexes.json
  name: string;
  daily_budget: number;
  targeting: {
    age_min: number; age_max: number;
    genders: string[]; locations: string[]; interests: string[];
  };
  status: 'ACTIVE' | 'PAUSED';
  created_at: string;
  meta_adset_id: string;
}
```

### `daily_insights/{clientId}/insight_items/{date}_{campaignId}`

One document per campaign per day. The composite id makes a re-sync idempotent —
running the same day twice overwrites rather than duplicates.

```ts
{
  client_id: string;
  campaign_id: string;
  campaign_name: string;
  date: string;                     // "YYYY-MM-DD" — range-queried
  spend: number;                    // RM
  impressions: number;
  clicks: number;
  leads: number;
  conversions: number;
  ctr: number;                      // %
  cpm: number;
  cpc: number;
  cpl: number;                      // the primary metric
  synced_at: string;
  by_adset: {                       // ad-set slice of the same day
    [adSetId: string]: {
      spend, impressions, clicks, leads, conversions, ctr, cpm, cpc, cpl
    };
  };
}
```

Rates (`ctr`, `cpm`, `cpc`, `cpl`) are **recomputed from summed totals** when
aggregating, never averaged — see `deriveRates()` in `src/lib/utils.ts`.
Averaging ratios across days gives the wrong answer whenever daily spend varies.

### `pending_actions/{clientId}/action_items/{actionId}`

```ts
{
  id: string;                       // duplicated as a field for collectionGroup lookup
  client_id: string;
  client_name: string;
  from_model: 'glm' | 'claude';
  action_type: 'pause' | 'resume' | 'budget_change' | 'analysis';
  campaign_id: string;
  campaign_name: string;
  adset_id?: string;                // present when the action targets an ad set
  suggestion_text: string;          // human-readable, shown in the queue
  reason: string;                   // why Hermes proposed it
  metadata: { current_cpl?, target_cpl?, performance_change?, current_budget?, proposed_budget? };
  status: 'pending' | 'approved' | 'rejected' | 'executed' | 'failed';
  fadhil_decision: string;
  created_at: string;
  executed_at?: string;
  meta_result?: { ok, mode: 'live' | 'mock', message, applied, executed_at };
}
```

### `manual_entries/{clientId}/entry_items/{entryId}`

```ts
{
  client_id: string;
  campaign_id: string;
  adset_id?: string;
  metric_type: 'leads_closed' | 'sales_value' | 'conversion_custom';
  value: number;
  notes: string;
  entered_by: 'fadhil' | 'client';
  created_at: string;
  date: string;                     // "YYYY-MM-DD"
}
```

Both the dashboard form and `POST /api/integrations/sync/crm` write here, so
CRM-sourced and hand-entered data are treated identically by reports.

### `creatives/{clientId}/creative_items/{creativeId}`

```ts
{
  id: string;                       // duplicated for collectionGroup lookup
  client_id: string;
  file_name: string;
  file_type: 'image' | 'video';
  content_type: string;
  storage_path: string;             // "gs://bucket/creatives/..."
  campaign_id: string;
  adset_id?: string;
  download_url: string;             // signed URL
  url_expires_at: string;           // +7 days
  uploaded_at: string;
  size_bytes: number;
}
```

Expired URLs are re-signed on demand by `/api/creatives/download/[creativeId]`,
so a stale link never 403s at the client.

### `hermes_memory/{doc}`

Three fixed documents:

- `hermes_memory/patterns` — `{ items: HermesPattern[] }`
- `hermes_memory/approvals_log` — `{ items: HermesApprovalLog[] }`, newest first, capped at 500
- `hermes_memory/settings` — `{ frequency, auto_execute, notification_channel, monitored_campaigns, updated_at }`

### `auth_users/{userId}`

```ts
{
  email: string;                    // lowercase — queried with ==
  password_hash: string;            // "scrypt$16384$salt$hash"
  created_at: string;
  permissions: ('read' | 'write' | 'execute')[];
}
```

Seed the owner as `auth_users/owner_fadhil`. Generate the hash with
`npm run hash -- "your-password"`. Until this document exists, login falls back
to `OWNER_EMAIL` / `OWNER_PASSWORD_HASH` from the environment.

### `api_keys/{keyId}` and `webhooks/{webhookId}`

API keys store only a SHA-256 hash plus a display prefix — the plaintext is
returned once at creation and never again. Webhook signing secrets are excluded
from every list response.

---

## Indexes

`firestore.indexes.json` covers the five composite indexes this app needs.
Deploy them before the first real query:

```bash
firebase deploy --only firestore:indexes
```

Firestore also prints a ready-made index link in the server console the first
time an un-indexed query runs, which is a fine way to catch anything missed.

## Security rules

See `firestore.rules` and `storage.rules`. The baseline denies all direct
browser access: the dashboard reads through the API (which authenticates and
scopes every query), and the Admin SDK bypasses rules. Commented rules for
Phase 2 browser listeners are included in the file.

```bash
firebase deploy --only firestore:rules,storage
```
