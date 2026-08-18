/**
 * Firestore path map.
 *
 * The brief writes paths like `campaigns/{accountId}/{campaignId}`. Firestore
 * alternates collection/document segments, so a per-client subcollection needs
 * a name of its own. Each subcollection gets a DISTINCT name so that
 * `collectionGroup()` queries (e.g. "every pending action across all clients")
 * stay unambiguous.
 */
export const COLLECTIONS = {
  clients: 'clients',
  authUsers: 'auth_users',
  apiKeys: 'api_keys',
  webhooks: 'webhooks',
  hermesMemory: 'hermes_memory',
  /** Per-link PIN attempt counters — one document per client link. */
  pinAttempts: 'pin_attempts',

  campaigns: 'campaigns',
  campaignItems: 'campaign_items',

  adSets: 'ad_sets',
  adSetItems: 'adset_items',

  dailyInsights: 'daily_insights',
  insightItems: 'insight_items',

  pendingActions: 'pending_actions',
  actionItems: 'action_items',

  manualEntries: 'manual_entries',
  entryItems: 'entry_items',

  creatives: 'creatives',
  creativeItems: 'creative_items',
} as const;

export const HERMES_DOCS = {
  patterns: 'patterns',
  approvalsLog: 'approvals_log',
  settings: 'settings',
} as const;

export const OWNER_DOC_ID = 'owner_fadhil';

/** Composite id for a daily insight row: one per campaign per day. */
export const insightId = (date: string, campaignId: string) => `${date}_${campaignId}`;
