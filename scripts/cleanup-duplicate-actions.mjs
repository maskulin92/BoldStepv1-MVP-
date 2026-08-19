#!/usr/bin/env node
/**
 * Cleanup duplicate PENDING actions in Firestore.
 *
 * Hermes (before the dedupe fix in commit 23a033e) could file the same
 * suggestion repeatedly — same campaign + action_type — piling up identical
 * pending approvals. This script removes the extras, keeping the OLDEST one
 * per (campaign_id, action_type) so the original suggestion survives.
 *
 * IMPORTANT: Only PENDING actions are de-duplicated. Actions that have already
 * been decided (executed / rejected) are left untouched — removing a resolved
 * action would corrupt the audit trail and could delete a newer valid pending
 * suggestion while keeping an old resolved one.
 *
 * Usage:
 *   node scripts/cleanup-duplicate-actions.mjs            # dry run (default)
 *   node scripts/cleanup-duplicate-actions.mjs --apply    # actually delete
 *
 * Reads Firebase credentials from .env.local. Only touches pending_actions;
 * nothing else is modified. Safe to re-run (idempotent).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env.local');

/* --- load .env.local (dotenv-style, honouring \$ and quoted values) --- */
function loadEnv(path) {
  const text = readFileSync(path, 'utf8');
  const vars = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    v = v.replace(/\\\$/g, '$');
    vars[m[1]] = v;
  }
  return vars;
}

const env = loadEnv(envPath);
const APPLY = process.argv.includes('--apply');

const COLLECTIONS = {
  clients: 'clients',
  pendingActions: 'pending_actions',
  actionItems: 'action_items',
};

function dedupeKey(action) {
  return `${action.campaign_id}|${action.action_type}`;
}

async function main() {
  if (!env.FIREBASE_PROJECT_ID || !env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) {
    console.error('Firebase Admin credentials are missing from .env.local. Cleanup only targets live Firestore (the in-memory mock store cannot be reached from a separate process).');
    process.exit(1);
  }

  // Dynamic import so the script runs on any machine with firebase-admin
  // installed in the project's node_modules — no hardcoded paths.
  const admin = await import('firebase-admin');
  const firebase = admin.default ?? admin;

  firebase.initializeApp({
    credential: firebase.credential.cert({
      projectId: env.FIREBASE_PROJECT_ID,
      clientEmail: env.FIREBASE_CLIENT_EMAIL,
      privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    }),
  });

  const db = firebase.firestore();

  // 1. Enumerate accounts.
  const clientsSnap = await db.collection(COLLECTIONS.clients).get();
  const accountIds = clientsSnap.docs.map((d) => d.id);
  console.log(`Accounts: ${accountIds.length} (${accountIds.join(', ') || 'none'})`);

  // 2. For each account, read every action in its action_items subcollection.
  //    (Per-account reads avoid the collectionGroup index dependency.)
  let totalSeen = 0;
  let totalPending = 0;
  let totalDuplicates = 0;

  for (const accountId of accountIds) {
    const actionsSnap = await db
      .collection(COLLECTIONS.pendingActions)
      .doc(accountId)
      .collection(COLLECTIONS.actionItems)
      .get();

    // 3. Group PENDING actions by dedupe key. Resolved actions (executed /
    //    rejected) are skipped entirely — they are historical and must not
    //    be deleted, and a resolved action must not "shadow" a newer pending
    //    suggestion for the same campaign + type.
    const byKey = new Map();
    for (const doc of actionsSnap.docs) {
      const action = doc.data();
      action._docId = doc.id;
      totalSeen += 1;

      if (action.status !== 'pending') continue;
      totalPending += 1;

      const key = dedupeKey(action);
      if (!byKey.has(key)) {
        byKey.set(key, []);
      }
      byKey.get(key).push(action);
    }

    // 4. Sort each group oldest-first; everything after [0] is a duplicate.
    for (const [key, group] of byKey.entries()) {
      if (group.length < 2) continue;
      group.sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''));
      const keep = group[0];
      const dupes = group.slice(1);
      totalDuplicates += dupes.length;

      console.log(
        `\nDUPLICATE GROUP (${group.length} pending copies) — ${key}\n` +
          `  keep:  ${keep._docId}  (${keep.created_at ?? 'no created_at'})  [${keep.status}]`,
      );
      for (const d of dupes) {
        console.log(
          `  drop:  ${d._docId}  (${d.created_at ?? 'no created_at'})  [${d.status}]`,
        );
        if (APPLY) {
          await db
            .collection(COLLECTIONS.pendingActions)
            .doc(accountId)
            .collection(COLLECTIONS.actionItems)
            .doc(d._docId)
            .delete();
        }
      }
    }
  }

  console.log('\n====================================');
  console.log(`Total actions scanned:      ${totalSeen}`);
  console.log(`Pending actions scanned:    ${totalPending}`);
  console.log(`Duplicate actions to drop:  ${totalDuplicates}`);
  console.log(APPLY ? 'ACTION: duplicates deleted.' : 'DRY RUN — nothing deleted. Re-run with --apply to delete.');
  console.log('====================================');

  process.exit(0);
}

main().catch((err) => {
  console.error('Cleanup failed:', err);
  process.exit(1);
});
