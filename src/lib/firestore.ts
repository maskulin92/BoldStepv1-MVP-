import 'server-only';
import { getDb } from './firebase-admin';
import { mockStore } from './mock-store';
import { COLLECTIONS, HERMES_DOCS, OWNER_DOC_ID, insightId } from './collections';
import { defaultHermesSettings } from './mock-data';
import { env } from './env';
import type {
  AdSet,
  ApiKeyRecord,
  AuthUser,
  Campaign,
  Client,
  Creative,
  DailyInsight,
  HermesApprovalLog,
  HermesPattern,
  HermesSettings,
  ManualEntry,
  PendingAction,
  PublicClient,
  Webhook,
} from '@/types';

/**
 * The single data-access layer for the whole app.
 *
 * Every function has two branches: real Firestore when the Admin SDK is
 * configured, the in-memory mock store otherwise. Callers never need to know
 * which one is live — that is what makes "fill in .env.local and it becomes
 * real, with no code changes" hold.
 *
 * Timestamps are stored as ISO-8601 strings rather than Firestore Timestamps
 * so a document round-trips through JSON unchanged.
 */

type Doc = Record<string, unknown>;

const clean = <T extends Doc>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;

/* ------------------------------------------------------------- clients */

export function toPublicClient(client: Client): PublicClient {
  const { access_token_encrypted: _t, access_pin_hash: _p, ...rest } = client;
  return rest;
}

export async function listClients(): Promise<Client[]> {
  const db = getDb();
  if (!db) return [...mockStore().clients];

  const snapshot = await db.collection(COLLECTIONS.clients).get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Omit<Client, 'id'>) }));
}

export async function getClient(clientId: string): Promise<Client | null> {
  const db = getDb();
  if (!db) return mockStore().clients.find((c) => c.id === clientId) ?? null;

  const doc = await db.collection(COLLECTIONS.clients).doc(clientId).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...(doc.data() as Omit<Client, 'id'>) };
}

export async function getClientByLinkId(linkId: string): Promise<Client | null> {
  const db = getDb();
  if (!db) {
    return mockStore().clients.find((c) => c.link_id === linkId || c.id === linkId) ?? null;
  }

  const byLink = await db
    .collection(COLLECTIONS.clients)
    .where('link_id', '==', linkId)
    .limit(1)
    .get();
  if (!byLink.empty) {
    const doc = byLink.docs[0];
    return { id: doc.id, ...(doc.data() as Omit<Client, 'id'>) };
  }
  // Fall back to treating the link segment as the document id.
  return getClient(linkId);
}

export async function updateClient(
  clientId: string,
  patch: Partial<Omit<Client, 'id'>>,
): Promise<Client | null> {
  const db = getDb();
  if (!db) {
    const store = mockStore();
    const index = store.clients.findIndex((c) => c.id === clientId);
    if (index === -1) return null;
    store.clients[index] = { ...store.clients[index], ...patch };
    return store.clients[index];
  }

  const ref = db.collection(COLLECTIONS.clients).doc(clientId);
  const existing = await ref.get();
  if (!existing.exists) return null;
  await ref.set(clean(patch as Doc), { merge: true });
  const updated = await ref.get();
  return { id: updated.id, ...(updated.data() as Omit<Client, 'id'>) };
}

/* ----------------------------------------------------------- campaigns */

export async function listCampaigns(clientId: string): Promise<Campaign[]> {
  const db = getDb();
  if (!db) return mockStore().campaigns.filter((c) => c.client_id === clientId);

  const snapshot = await db
    .collection(COLLECTIONS.campaigns)
    .doc(clientId)
    .collection(COLLECTIONS.campaignItems)
    .get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Omit<Campaign, 'id'>) }));
}

export async function getCampaign(clientId: string, campaignId: string): Promise<Campaign | null> {
  const db = getDb();
  if (!db) {
    return (
      mockStore().campaigns.find((c) => c.client_id === clientId && c.id === campaignId) ?? null
    );
  }

  const doc = await db
    .collection(COLLECTIONS.campaigns)
    .doc(clientId)
    .collection(COLLECTIONS.campaignItems)
    .doc(campaignId)
    .get();
  if (!doc.exists) return null;
  return { id: doc.id, ...(doc.data() as Omit<Campaign, 'id'>) };
}

export async function upsertCampaigns(clientId: string, campaigns: Campaign[]): Promise<number> {
  const db = getDb();
  if (!db) {
    const store = mockStore();
    for (const campaign of campaigns) {
      const index = store.campaigns.findIndex(
        (c) => c.client_id === clientId && c.id === campaign.id,
      );
      if (index === -1) store.campaigns.push(campaign);
      else store.campaigns[index] = { ...store.campaigns[index], ...campaign };
    }
    return campaigns.length;
  }

  const parent = db.collection(COLLECTIONS.campaigns).doc(clientId);
  await parent.set({ client_id: clientId }, { merge: true });
  const batch = db.batch();
  for (const campaign of campaigns) {
    batch.set(parent.collection(COLLECTIONS.campaignItems).doc(campaign.id), clean(campaign as unknown as Doc), {
      merge: true,
    });
  }
  await batch.commit();
  return campaigns.length;
}

export async function updateCampaign(
  clientId: string,
  campaignId: string,
  patch: Partial<Campaign>,
): Promise<Campaign | null> {
  const db = getDb();
  if (!db) {
    const store = mockStore();
    const index = store.campaigns.findIndex((c) => c.client_id === clientId && c.id === campaignId);
    if (index === -1) return null;
    store.campaigns[index] = { ...store.campaigns[index], ...patch };
    return store.campaigns[index];
  }

  const ref = db
    .collection(COLLECTIONS.campaigns)
    .doc(clientId)
    .collection(COLLECTIONS.campaignItems)
    .doc(campaignId);
  const existing = await ref.get();
  if (!existing.exists) return null;
  await ref.set(clean(patch as Doc), { merge: true });
  const updated = await ref.get();
  return { id: updated.id, ...(updated.data() as Omit<Campaign, 'id'>) };
}

/* ------------------------------------------------------------- ad sets */

export async function listAdSets(clientId: string, campaignId?: string): Promise<AdSet[]> {
  const db = getDb();
  if (!db) {
    return mockStore().adSets.filter(
      (a) => a.client_id === clientId && (!campaignId || a.campaign_id === campaignId),
    );
  }

  const base = db
    .collection(COLLECTIONS.adSets)
    .doc(clientId)
    .collection(COLLECTIONS.adSetItems);
  const snapshot = campaignId
    ? await base.where('campaign_id', '==', campaignId).get()
    : await base.get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Omit<AdSet, 'id'>) }));
}

export async function upsertAdSets(clientId: string, adSets: AdSet[]): Promise<number> {
  const db = getDb();
  if (!db) {
    const store = mockStore();
    for (const adSet of adSets) {
      const index = store.adSets.findIndex((a) => a.client_id === clientId && a.id === adSet.id);
      if (index === -1) store.adSets.push(adSet);
      else store.adSets[index] = { ...store.adSets[index], ...adSet };
    }
    return adSets.length;
  }

  const parent = db.collection(COLLECTIONS.adSets).doc(clientId);
  await parent.set({ client_id: clientId }, { merge: true });
  const batch = db.batch();
  for (const adSet of adSets) {
    batch.set(parent.collection(COLLECTIONS.adSetItems).doc(adSet.id), clean(adSet as unknown as Doc), {
      merge: true,
    });
  }
  await batch.commit();
  return adSets.length;
}

/* ------------------------------------------------------------ insights */

export async function listInsights(
  clientId: string,
  startDate: string,
  endDate: string,
  campaignId?: string,
): Promise<DailyInsight[]> {
  const db = getDb();
  if (!db) {
    return mockStore()
      .insights.filter(
        (i) =>
          i.client_id === clientId &&
          i.date >= startDate &&
          i.date <= endDate &&
          (!campaignId || i.campaign_id === campaignId),
      )
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  let query = db
    .collection(COLLECTIONS.dailyInsights)
    .doc(clientId)
    .collection(COLLECTIONS.insightItems)
    .where('date', '>=', startDate)
    .where('date', '<=', endDate);
  if (campaignId) query = query.where('campaign_id', '==', campaignId);

  const snapshot = await query.get();
  return snapshot.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() as Omit<DailyInsight, 'id'>) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function upsertInsights(
  clientId: string,
  insights: DailyInsight[],
): Promise<number> {
  const db = getDb();
  if (!db) {
    const store = mockStore();
    for (const insight of insights) {
      const index = store.insights.findIndex(
        (i) => i.client_id === clientId && i.id === insight.id,
      );
      if (index === -1) store.insights.push(insight);
      else store.insights[index] = { ...store.insights[index], ...insight };
    }
    return insights.length;
  }

  const parent = db.collection(COLLECTIONS.dailyInsights).doc(clientId);
  await parent.set({ client_id: clientId }, { merge: true });

  // Firestore caps a batch at 500 writes.
  let written = 0;
  for (let offset = 0; offset < insights.length; offset += 400) {
    const chunk = insights.slice(offset, offset + 400);
    const batch = db.batch();
    for (const insight of chunk) {
      batch.set(
        parent
          .collection(COLLECTIONS.insightItems)
          .doc(insight.id || insightId(insight.date, insight.campaign_id)),
        clean(insight as unknown as Doc),
        { merge: true },
      );
    }
    await batch.commit();
    written += chunk.length;
  }
  return written;
}

/* ------------------------------------------------------ pending actions */

export async function listPendingActions(options: {
  clientId?: string;
  status?: string;
}): Promise<PendingAction[]> {
  const { clientId, status } = options;
  const db = getDb();

  if (!db) {
    return mockStore()
      .actions.filter(
        (a) => (!clientId || a.client_id === clientId) && (!status || a.status === status),
      )
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  const snapshot = clientId
    ? await db
        .collection(COLLECTIONS.pendingActions)
        .doc(clientId)
        .collection(COLLECTIONS.actionItems)
        .get()
    : await db.collectionGroup(COLLECTIONS.actionItems).get();

  return snapshot.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() as Omit<PendingAction, 'id'>) }))
    .filter((a) => !status || a.status === status)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function getPendingAction(actionId: string): Promise<PendingAction | null> {
  const db = getDb();
  if (!db) return mockStore().actions.find((a) => a.id === actionId) ?? null;

  const snapshot = await db
    .collectionGroup(COLLECTIONS.actionItems)
    .where('id', '==', actionId)
    .limit(1)
    .get();
  if (snapshot.empty) return null;
  const doc = snapshot.docs[0];
  return { id: doc.id, ...(doc.data() as Omit<PendingAction, 'id'>) };
}

export async function createPendingAction(action: PendingAction): Promise<PendingAction> {
  const db = getDb();
  if (!db) {
    mockStore().actions.unshift(action);
    return action;
  }

  const parent = db.collection(COLLECTIONS.pendingActions).doc(action.client_id);
  await parent.set({ client_id: action.client_id }, { merge: true });
  await parent
    .collection(COLLECTIONS.actionItems)
    .doc(action.id)
    .set(clean(action as unknown as Doc));
  return action;
}

export async function updatePendingAction(
  actionId: string,
  patch: Partial<PendingAction>,
): Promise<PendingAction | null> {
  const db = getDb();
  if (!db) {
    const store = mockStore();
    const index = store.actions.findIndex((a) => a.id === actionId);
    if (index === -1) return null;
    store.actions[index] = { ...store.actions[index], ...patch };
    return store.actions[index];
  }

  const snapshot = await db
    .collectionGroup(COLLECTIONS.actionItems)
    .where('id', '==', actionId)
    .limit(1)
    .get();
  if (snapshot.empty) return null;
  await snapshot.docs[0].ref.set(clean(patch as Doc), { merge: true });
  const updated = await snapshot.docs[0].ref.get();
  return { id: updated.id, ...(updated.data() as Omit<PendingAction, 'id'>) };
}

/* ------------------------------------------------------ manual entries */

export async function listManualEntries(
  clientId: string,
  options: { date?: string; startDate?: string; endDate?: string } = {},
): Promise<ManualEntry[]> {
  const { date, startDate, endDate } = options;
  const db = getDb();

  const matches = (entry: ManualEntry) => {
    if (date) return entry.date === date;
    if (startDate && entry.date < startDate) return false;
    if (endDate && entry.date > endDate) return false;
    return true;
  };

  if (!db) {
    return mockStore()
      .manualEntries.filter((e) => e.client_id === clientId && matches(e))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  const snapshot = await db
    .collection(COLLECTIONS.manualEntries)
    .doc(clientId)
    .collection(COLLECTIONS.entryItems)
    .get();
  return snapshot.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() as Omit<ManualEntry, 'id'>) }))
    .filter(matches)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function createManualEntries(entries: ManualEntry[]): Promise<ManualEntry[]> {
  if (entries.length === 0) return [];
  const db = getDb();
  if (!db) {
    mockStore().manualEntries.unshift(...entries);
    return entries;
  }

  const clientId = entries[0].client_id;
  const parent = db.collection(COLLECTIONS.manualEntries).doc(clientId);
  await parent.set({ client_id: clientId }, { merge: true });
  const batch = db.batch();
  for (const entry of entries) {
    batch.set(
      parent.collection(COLLECTIONS.entryItems).doc(entry.id),
      clean(entry as unknown as Doc),
    );
  }
  await batch.commit();
  return entries;
}

/* ---------------------------------------------------------- creatives */

export async function listCreatives(clientId: string): Promise<Creative[]> {
  const db = getDb();
  if (!db) {
    return mockStore()
      .creatives.filter((c) => c.client_id === clientId)
      .sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at));
  }

  const snapshot = await db
    .collection(COLLECTIONS.creatives)
    .doc(clientId)
    .collection(COLLECTIONS.creativeItems)
    .get();
  return snapshot.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() as Omit<Creative, 'id'>) }))
    .sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at));
}

export async function getCreative(creativeId: string): Promise<Creative | null> {
  const db = getDb();
  if (!db) return mockStore().creatives.find((c) => c.id === creativeId) ?? null;

  const snapshot = await db
    .collectionGroup(COLLECTIONS.creativeItems)
    .where('id', '==', creativeId)
    .limit(1)
    .get();
  if (snapshot.empty) return null;
  const doc = snapshot.docs[0];
  return { id: doc.id, ...(doc.data() as Omit<Creative, 'id'>) };
}

export async function createCreative(creative: Creative): Promise<Creative> {
  const db = getDb();
  if (!db) {
    mockStore().creatives.unshift(creative);
    return creative;
  }

  const parent = db.collection(COLLECTIONS.creatives).doc(creative.client_id);
  await parent.set({ client_id: creative.client_id }, { merge: true });
  await parent
    .collection(COLLECTIONS.creativeItems)
    .doc(creative.id)
    .set(clean(creative as unknown as Doc));
  return creative;
}

export async function updateCreative(
  creativeId: string,
  clientId: string,
  patch: Partial<Creative>,
): Promise<void> {
  const db = getDb();
  if (!db) {
    const store = mockStore();
    const index = store.creatives.findIndex((c) => c.id === creativeId);
    if (index !== -1) store.creatives[index] = { ...store.creatives[index], ...patch };
    return;
  }

  await db
    .collection(COLLECTIONS.creatives)
    .doc(clientId)
    .collection(COLLECTIONS.creativeItems)
    .doc(creativeId)
    .set(clean(patch as Doc), { merge: true });
}

/* ------------------------------------------------------ hermes memory */

export async function getHermesSettings(): Promise<HermesSettings> {
  const db = getDb();
  if (!db) return mockStore().hermesSettings;

  const doc = await db.collection(COLLECTIONS.hermesMemory).doc(HERMES_DOCS.settings).get();
  if (!doc.exists) return defaultHermesSettings();
  return doc.data() as HermesSettings;
}

export async function updateHermesSettings(
  patch: Partial<HermesSettings>,
): Promise<HermesSettings> {
  const next = { ...(await getHermesSettings()), ...patch, updated_at: new Date().toISOString() };
  const db = getDb();
  if (!db) {
    mockStore().hermesSettings = next;
    return next;
  }

  await db
    .collection(COLLECTIONS.hermesMemory)
    .doc(HERMES_DOCS.settings)
    .set(clean(next as unknown as Doc), { merge: true });
  return next;
}

export async function getHermesPatterns(): Promise<HermesPattern[]> {
  const db = getDb();
  if (!db) return mockStore().patterns;

  const doc = await db.collection(COLLECTIONS.hermesMemory).doc(HERMES_DOCS.patterns).get();
  if (!doc.exists) return [];
  const data = doc.data() as { items?: HermesPattern[] };
  return data.items ?? [];
}

export async function getHermesApprovalLog(): Promise<HermesApprovalLog[]> {
  const db = getDb();
  if (!db) return mockStore().approvalLog;

  const doc = await db.collection(COLLECTIONS.hermesMemory).doc(HERMES_DOCS.approvalsLog).get();
  if (!doc.exists) return [];
  const data = doc.data() as { items?: HermesApprovalLog[] };
  return (data.items ?? []).sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

export async function appendApprovalLog(entry: HermesApprovalLog): Promise<void> {
  const db = getDb();
  if (!db) {
    mockStore().approvalLog.unshift(entry);
    return;
  }

  const ref = db.collection(COLLECTIONS.hermesMemory).doc(HERMES_DOCS.approvalsLog);
  const doc = await ref.get();
  const items = doc.exists ? ((doc.data() as { items?: HermesApprovalLog[] }).items ?? []) : [];
  await ref.set({ items: [entry, ...items].slice(0, 500) }, { merge: true });
}

/* ---------------------------------------------------------- auth users */

export async function getOwnerByEmail(email: string): Promise<AuthUser | null> {
  const normalized = email.trim().toLowerCase();
  const db = getDb();

  if (!db) {
    const store = mockStore();
    // An explicitly configured owner in .env.local always wins over the demo user.
    if (env.owner.passwordHash) {
      if (normalized !== env.owner.email.toLowerCase()) return null;
      return {
        id: OWNER_DOC_ID,
        email: env.owner.email,
        password_hash: env.owner.passwordHash,
        created_at: new Date().toISOString(),
        permissions: ['read', 'write', 'execute'],
      };
    }
    return store.authUsers.find((u) => u.email.toLowerCase() === normalized) ?? null;
  }

  const snapshot = await db
    .collection(COLLECTIONS.authUsers)
    .where('email', '==', normalized)
    .limit(1)
    .get();

  if (!snapshot.empty) {
    const doc = snapshot.docs[0];
    return { id: doc.id, ...(doc.data() as Omit<AuthUser, 'id'>) };
  }

  // Bootstrap path: no auth_users document yet, but .env.local has the owner.
  if (env.owner.passwordHash && normalized === env.owner.email.toLowerCase()) {
    return {
      id: OWNER_DOC_ID,
      email: env.owner.email,
      password_hash: env.owner.passwordHash,
      created_at: new Date().toISOString(),
      permissions: ['read', 'write', 'execute'],
    };
  }
  return null;
}

/* ------------------------------------------------------------ api keys */

export async function createApiKey(record: ApiKeyRecord): Promise<ApiKeyRecord> {
  const db = getDb();
  if (!db) {
    mockStore().apiKeys.unshift(record);
    return record;
  }
  await db.collection(COLLECTIONS.apiKeys).doc(record.id).set(clean(record as unknown as Doc));
  return record;
}

export async function findApiKeyByHash(hash: string): Promise<ApiKeyRecord | null> {
  const db = getDb();
  if (!db) return mockStore().apiKeys.find((k) => k.key_hash === hash) ?? null;

  const snapshot = await db
    .collection(COLLECTIONS.apiKeys)
    .where('key_hash', '==', hash)
    .limit(1)
    .get();
  if (snapshot.empty) return null;
  const doc = snapshot.docs[0];
  return { id: doc.id, ...(doc.data() as Omit<ApiKeyRecord, 'id'>) };
}

export async function touchApiKey(keyId: string): Promise<void> {
  const now = new Date().toISOString();
  const db = getDb();
  if (!db) {
    const key = mockStore().apiKeys.find((k) => k.id === keyId);
    if (key) key.last_used_at = now;
    return;
  }
  await db.collection(COLLECTIONS.apiKeys).doc(keyId).set({ last_used_at: now }, { merge: true });
}

export async function listApiKeys(ownerId: string): Promise<ApiKeyRecord[]> {
  const db = getDb();
  if (!db) return mockStore().apiKeys.filter((k) => k.owner_id === ownerId);

  const snapshot = await db
    .collection(COLLECTIONS.apiKeys)
    .where('owner_id', '==', ownerId)
    .get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Omit<ApiKeyRecord, 'id'>) }));
}

/* ------------------------------------------------------------ webhooks */

export async function createWebhook(webhook: Webhook): Promise<Webhook> {
  const db = getDb();
  if (!db) {
    mockStore().webhooks.unshift(webhook);
    return webhook;
  }
  await db.collection(COLLECTIONS.webhooks).doc(webhook.id).set(clean(webhook as unknown as Doc));
  return webhook;
}

export async function listWebhooks(ownerId: string): Promise<Webhook[]> {
  const db = getDb();
  if (!db) return mockStore().webhooks.filter((w) => w.owner_id === ownerId);

  const snapshot = await db.collection(COLLECTIONS.webhooks).where('owner_id', '==', ownerId).get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Omit<Webhook, 'id'>) }));
}
