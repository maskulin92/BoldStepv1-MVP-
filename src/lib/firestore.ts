import 'server-only';
import { getBucket, getDb } from './firebase-admin';
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

/** True when another client already owns this link segment. */
export async function isLinkIdTaken(linkId: string, exceptClientId?: string): Promise<boolean> {
  const db = getDb();
  if (!db) {
    return mockStore().clients.some(
      (c) => c.link_id === linkId && c.id !== exceptClientId,
    );
  }

  const snapshot = await db
    .collection(COLLECTIONS.clients)
    .where('link_id', '==', linkId)
    .limit(2)
    .get();
  return snapshot.docs.some((doc) => doc.id !== exceptClientId);
}

export async function createClient(client: Client): Promise<Client> {
  const db = getDb();
  if (!db) {
    mockStore().clients.push(client);
    return client;
  }

  const { id, ...data } = client;
  await db.collection(COLLECTIONS.clients).doc(id).set(clean(data as Doc));
  return client;
}

/**
 * Deletes a client and everything hanging off it.
 *
 * Firestore does not cascade: removing `clients/{id}` would orphan every
 * campaign, insight and action underneath it, and those orphans would still be
 * picked up by `collectionGroup` queries. So each subcollection is drained
 * explicitly, then the stored files, then the client document itself.
 */
export async function deleteClient(clientId: string): Promise<{
  deleted_documents: number;
  deleted_files: boolean;
}> {
  const db = getDb();

  if (!db) {
    const store = mockStore();
    const before =
      store.campaigns.length +
      store.adSets.length +
      store.insights.length +
      store.actions.length +
      store.creatives.length +
      store.manualEntries.length;

    store.campaigns = store.campaigns.filter((c) => c.client_id !== clientId);
    store.adSets = store.adSets.filter((a) => a.client_id !== clientId);
    store.insights = store.insights.filter((i) => i.client_id !== clientId);
    store.actions = store.actions.filter((a) => a.client_id !== clientId);
    store.creatives = store.creatives.filter((c) => c.client_id !== clientId);
    store.manualEntries = store.manualEntries.filter((e) => e.client_id !== clientId);
    store.clients = store.clients.filter((c) => c.id !== clientId);

    const after =
      store.campaigns.length +
      store.adSets.length +
      store.insights.length +
      store.actions.length +
      store.creatives.length +
      store.manualEntries.length;

    for (const key of [...store.files.keys()]) {
      if (key.includes(`/${clientId}/`)) store.files.delete(key);
    }

    return { deleted_documents: before - after + 1, deleted_files: true };
  }

  const parents: [string, string][] = [
    [COLLECTIONS.campaigns, COLLECTIONS.campaignItems],
    [COLLECTIONS.adSets, COLLECTIONS.adSetItems],
    [COLLECTIONS.dailyInsights, COLLECTIONS.insightItems],
    [COLLECTIONS.pendingActions, COLLECTIONS.actionItems],
    [COLLECTIONS.manualEntries, COLLECTIONS.entryItems],
    [COLLECTIONS.creatives, COLLECTIONS.creativeItems],
  ];

  let deleted = 0;
  for (const [parent, child] of parents) {
    const parentRef = db.collection(parent).doc(clientId);
    deleted += await drainCollection(parentRef.collection(child));
    await parentRef.delete();
    deleted += 1;
  }

  await db.collection(COLLECTIONS.clients).doc(clientId).delete();
  deleted += 1;

  // Best effort: a storage failure must not leave the database half-deleted.
  let filesDeleted = false;
  try {
    const bucket = getBucket();
    if (bucket) {
      await Promise.all([
        bucket.deleteFiles({ prefix: `creatives/${clientId}/` }),
        bucket.deleteFiles({ prefix: `reports/${clientId}/` }),
      ]);
      filesDeleted = true;
    }
  } catch (error) {
    console.error(`[boldstep] Could not delete stored files for "${clientId}":`, error);
  }

  return { deleted_documents: deleted, deleted_files: filesDeleted };
}

/** Deletes every document in a collection, 400 at a time (batch cap is 500). */
async function drainCollection(
  ref: FirebaseFirestore.CollectionReference,
): Promise<number> {
  const db = getDb();
  if (!db) return 0;

  let total = 0;
  for (let guard = 0; guard < 100; guard += 1) {
    const snapshot = await ref.limit(400).get();
    if (snapshot.empty) break;

    const batch = db.batch();
    for (const doc of snapshot.docs) batch.delete(doc.ref);
    await batch.commit();

    total += snapshot.size;
    if (snapshot.size < 400) break;
  }
  return total;
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

export async function createCampaign(campaign: Campaign): Promise<Campaign> {
  const db = getDb();
  if (!db) {
    mockStore().campaigns.unshift(campaign);
    return campaign;
  }

  const parent = db.collection(COLLECTIONS.campaigns).doc(campaign.client_id);
  await parent.set({ client_id: campaign.client_id }, { merge: true });
  await parent
    .collection(COLLECTIONS.campaignItems)
    .doc(campaign.id)
    .set(clean(campaign as unknown as Doc));
  return campaign;
}

export async function upsertCampaigns(clientId: string, campaigns: Campaign[]): Promise<number> {  const db = getDb();
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
  options: {
    date?: string;
    startDate?: string;
    endDate?: string;
    /** Only entries whose numbers count toward metrics. Default: true. */
    approvedOnly?: boolean;
  } = {},
): Promise<ManualEntry[]> {
  const { date, startDate, endDate, approvedOnly = true } = options;
  const db = getDb();

  const matches = (entry: ManualEntry) => {
    if (date && entry.date !== date) return false;
    if (startDate && entry.date < startDate) return false;
    if (endDate && entry.date > endDate) return false;
    if (approvedOnly && entry.status !== 'approved') return false;
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

export async function getManualEntry(entryId: string): Promise<ManualEntry | null> {
  const db = getDb();
  if (!db) return mockStore().manualEntries.find((e) => e.id === entryId) ?? null;

  const snapshot = await db
    .collectionGroup(COLLECTIONS.entryItems)
    .where('id', '==', entryId)
    .limit(1)
    .get();
  if (snapshot.empty) return null;
  const doc = snapshot.docs[0];
  return { id: doc.id, ...(doc.data() as Omit<ManualEntry, 'id'>) };
}

export async function updateManualEntry(
  entryId: string,
  patch: Partial<Pick<ManualEntry, 'status' | 'review_note' | 'reviewed_by' | 'reviewed_at'>>,
): Promise<ManualEntry | null> {
  const db = getDb();
  if (!db) {
    const store = mockStore();
    const index = store.manualEntries.findIndex((e) => e.id === entryId);
    if (index === -1) return null;
    store.manualEntries[index] = { ...store.manualEntries[index], ...patch };
    return store.manualEntries[index];
  }

  const snapshot = await db
    .collectionGroup(COLLECTIONS.entryItems)
    .where('id', '==', entryId)
    .limit(1)
    .get();
  if (snapshot.empty) return null;
  const doc = snapshot.docs[0];
  await doc.ref.set(clean(patch as Doc), { merge: true });
  const updated = await doc.ref.get();
  return { id: updated.id, ...(updated.data() as Omit<ManualEntry, 'id'>) };
}

/* ---------------------------------------------------------- creatives */

export async function listCreatives(
  clientId: string,
  options: { status?: Creative['status'] } = {},
): Promise<Creative[]> {
  const { status } = options;
  const db = getDb();
  const matches = (creative: Creative) => !status || creative.status === status;

  if (!db) {
    return mockStore()
      .creatives.filter((c) => c.client_id === clientId && matches(c))
      .sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at));
  }

  const snapshot = await db
    .collection(COLLECTIONS.creatives)
    .doc(clientId)
    .collection(COLLECTIONS.creativeItems)
    .get();
  return snapshot.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() as Omit<Creative, 'id'>) }))
    .filter(matches)
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
): Promise<Creative | null> {
  const db = getDb();
  if (!db) {
    const store = mockStore();
    const index = store.creatives.findIndex((c) => c.id === creativeId);
    if (index === -1) return null;
    store.creatives[index] = { ...store.creatives[index], ...patch };
    return store.creatives[index];
  }

  const ref = db
    .collection(COLLECTIONS.creatives)
    .doc(clientId)
    .collection(COLLECTIONS.creativeItems)
    .doc(creativeId);
  await ref.set(clean(patch as Doc), { merge: true });
  const updated = await ref.get();
  if (!updated.exists) return null;
  return { id: updated.id, ...(updated.data() as Omit<Creative, 'id'>) };
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

/** Patches delivery bookkeeping (failure_count, last_triggered_at, active). */
export async function updateWebhook(
  webhookId: string,
  patch: Partial<Pick<Webhook, 'active' | 'failure_count' | 'last_triggered_at'>>,
): Promise<void> {
  const db = getDb();
  if (!db) {
    const store = mockStore();
    const index = store.webhooks.findIndex((w) => w.id === webhookId);
    if (index !== -1) store.webhooks[index] = { ...store.webhooks[index], ...patch };
    return;
  }
  await db.collection(COLLECTIONS.webhooks).doc(webhookId).set(clean(patch as Doc), { merge: true });
}

/* ------------------------------------------------- per-link PIN lockout */

export interface PinAttemptState {
  failed_attempts: number;
  locked_until?: string;
}

export interface PinAttemptDecision {
  locked: boolean;
  failed_attempts: number;
  locked_until?: string;
  /** Seconds until the lock expires; 0 when not locked. */
  retry_after_seconds: number;
}

const PIN_MAX_ATTEMPTS = 10;
const PIN_LOCKOUT_MS = 15 * 60 * 1000;

interface MockPinAttempts {
  counters: Map<string, PinAttemptState>;
}

const PIN_GLOBAL_KEY = Symbol.for('boldstep.mock-pin-attempts');
type GlobalWithPinAttempts = typeof globalThis & {
  [PIN_GLOBAL_KEY]?: MockPinAttempts;
};

/**
 * Counts a failed PIN attempt against a client link in Firestore, so the
 * counter survives serverless cold starts and is shared across instances.
 * 10 consecutive failures lock the link for 15 minutes (auto-unlock).
 * A successful login clears the counter. Returns the post-increment state.
 */
export async function recordFailedPinAttempt(linkId: string): Promise<PinAttemptDecision> {
  const db = getDb();

  let state: PinAttemptState;
  if (!db) {
    const g = globalThis as GlobalWithPinAttempts;
    if (!g[PIN_GLOBAL_KEY]) g[PIN_GLOBAL_KEY] = { counters: new Map() };
    state = g[PIN_GLOBAL_KEY].counters.get(linkId) ?? { failed_attempts: 0 };
  } else {
    const doc = await db.collection(COLLECTIONS.pinAttempts).doc(linkId).get();
    state = (doc.data() as PinAttemptState | undefined) ?? { failed_attempts: 0 };
  }

  // An expired lock is a clean slate.
  if (state.locked_until && new Date(state.locked_until).getTime() <= Date.now()) {
    state = { failed_attempts: 0 };
  }

  state.failed_attempts += 1;
  if (state.failed_attempts >= PIN_MAX_ATTEMPTS) {
    state.locked_until = new Date(Date.now() + PIN_LOCKOUT_MS).toISOString();
  }

  if (!db) {
    (globalThis as GlobalWithPinAttempts)[PIN_GLOBAL_KEY]!.counters.set(linkId, state);
  } else {
    await db
      .collection(COLLECTIONS.pinAttempts)
      .doc(linkId)
      .set(clean(state as unknown as Doc), { merge: true });
  }

  return toDecision(state);
}

/** Whether a link is currently locked (called before verifying a PIN). */
export async function getPinAttemptState(linkId: string): Promise<PinAttemptDecision> {
  const db = getDb();

  let state: PinAttemptState;
  if (!db) {
    const g = globalThis as GlobalWithPinAttempts;
    state = g[PIN_GLOBAL_KEY]?.counters.get(linkId) ?? { failed_attempts: 0 };
  } else {
    const doc = await db.collection(COLLECTIONS.pinAttempts).doc(linkId).get();
    state = (doc.data() as PinAttemptState | undefined) ?? { failed_attempts: 0 };
  }

  if (state.locked_until && new Date(state.locked_until).getTime() <= Date.now()) {
    state = { failed_attempts: 0 };
  }

  return toDecision(state);
}

/** A correct PIN wipes the counter — lockouts never outlive a successful login. */
export async function clearPinAttempts(linkId: string): Promise<void> {
  const db = getDb();
  if (!db) {
    const g = globalThis as GlobalWithPinAttempts;
    g[PIN_GLOBAL_KEY]?.counters.delete(linkId);
    return;
  }
  await db.collection(COLLECTIONS.pinAttempts).doc(linkId).delete().catch(() => undefined);
}

function toDecision(state: PinAttemptState): PinAttemptDecision {
  const lockedUntil = state.locked_until ? new Date(state.locked_until).getTime() : 0;
  const locked = lockedUntil > Date.now();
  return {
    locked,
    failed_attempts: state.failed_attempts,
    locked_until: locked ? state.locked_until : undefined,
    retry_after_seconds: locked ? Math.ceil((lockedUntil - Date.now()) / 1000) : 0,
  };
}
