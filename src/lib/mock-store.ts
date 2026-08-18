import 'server-only';
import { MOCK_MODE } from './env';
import {
  buildMockAdSets,
  buildMockApprovalLog,
  buildMockCampaigns,
  buildMockClients,
  buildMockCreatives,
  buildMockHermesPatterns,
  buildMockInsights,
  buildMockManualEntries,
  buildMockOwner,
  buildMockPendingActions,
  defaultHermesSettings,
} from './mock-data';
import type {
  AdSet,
  ApiKeyRecord,
  AuditLogEntry,
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
  Webhook,
} from '@/types';

/**
 * In-memory stand-in for Firestore.
 *
 * Writes land here and persist for the lifetime of the dev server, so the
 * whole approval / upload / manual-entry flow is exercisable end-to-end before
 * Firebase credentials exist. It is stored on `globalThis` so Next.js hot
 * reloads don't reset the data mid-test.
 */

export interface MockStore {
  clients: Client[];
  campaigns: Campaign[];
  adSets: AdSet[];
  insights: DailyInsight[];
  actions: PendingAction[];
  creatives: Creative[];
  manualEntries: ManualEntry[];
  patterns: HermesPattern[];
  approvalLog: HermesApprovalLog[];
  hermesSettings: HermesSettings;
  authUsers: AuthUser[];
  apiKeys: ApiKeyRecord[];
  webhooks: Webhook[];
  /** Operational audit trail (meta syncs, admin actions). */
  auditLog: AuditLogEntry[];
  /** Raw bytes for creatives uploaded during this session. */
  files: Map<string, { buffer: Buffer; contentType: string }>;
}

const GLOBAL_KEY = Symbol.for('boldstep.mock-store');

type GlobalWithStore = typeof globalThis & { [GLOBAL_KEY]?: MockStore };

function seed(): MockStore {
  const adSets = buildMockAdSets();
  const owner = buildMockOwner();
  return {
    clients: buildMockClients(),
    campaigns: buildMockCampaigns(),
    adSets,
    insights: buildMockInsights(adSets),
    actions: buildMockPendingActions(),
    creatives: buildMockCreatives(),
    manualEntries: buildMockManualEntries(),
    patterns: buildMockHermesPatterns(),
    approvalLog: buildMockApprovalLog(),
    hermesSettings: defaultHermesSettings(),
    authUsers: [{ ...owner, permissions: [...owner.permissions] }],
    apiKeys: [],
    webhooks: [],
    auditLog: [],
    files: new Map(),
  };
}

export function mockStore(): MockStore {
  // A production deploy must fail loudly rather than quietly serve invented
  // numbers as if they were a client's real ad performance.
  if (!MOCK_MODE) {
    throw new Error(
      'Mock data was requested but mock mode is off. Firebase Admin credentials are missing or invalid — set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY, or set BOLDSTEP_ALLOW_MOCK=true for a deliberate demo build.',
    );
  }

  const g = globalThis as GlobalWithStore;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = seed();
    console.info(
      '[boldstep] Running in MOCK MODE — data is generated in memory. Fill in the Firebase Admin vars in .env.local to switch to real Firestore.',
    );
  }
  return g[GLOBAL_KEY];
}

/** Test/utility hook — drops all in-session writes. */
export function resetMockStore(): void {
  (globalThis as GlobalWithStore)[GLOBAL_KEY] = seed();
}
