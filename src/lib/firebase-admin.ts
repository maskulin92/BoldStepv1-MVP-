import 'server-only';
import { cert, getApp, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { env } from './env';

/**
 * Lazily initialises the Admin SDK. Returns `null` when credentials are
 * absent so callers can fall back to the in-memory mock store instead of
 * crashing (SECTION 10 of the brief).
 */

const APP_NAME = 'boldstep-admin';

let cachedApp: App | null = null;
let initFailed = false;

export function getAdminApp(): App | null {
  if (!env.firebaseAdmin.isConfigured || initFailed) return null;
  if (cachedApp) return cachedApp;

  try {
    const existing = getApps().find((a) => a.name === APP_NAME);
    cachedApp =
      existing ??
      initializeApp(
        {
          credential: cert({
            projectId: env.firebaseAdmin.projectId!,
            clientEmail: env.firebaseAdmin.clientEmail!,
            privateKey: env.firebaseAdmin.privateKey!,
          }),
          projectId: env.firebaseAdmin.projectId!,
          storageBucket: env.firebaseAdmin.storageBucket,
        },
        APP_NAME,
      );
    return cachedApp;
  } catch (error) {
    // Don't retry a bad credential on every request — log once, fall back.
    initFailed = true;
    console.error(
      '[boldstep] Firebase Admin failed to initialise; falling back to mock data.',
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

let cachedDb: Firestore | null = null;

export function getDb(): Firestore | null {
  if (cachedDb) return cachedDb;
  const app = getAdminApp();
  if (!app) return null;
  try {
    cachedDb = getFirestore(app);
    cachedDb.settings({ ignoreUndefinedProperties: true });
    return cachedDb;
  } catch (error) {
    console.error('[boldstep] Firestore unavailable:', error);
    return null;
  }
}

export function getBucket() {
  const app = getAdminApp();
  if (!app || !env.firebaseAdmin.storageBucket) return null;
  try {
    return getStorage(app).bucket(env.firebaseAdmin.storageBucket);
  } catch (error) {
    console.error('[boldstep] Cloud Storage unavailable:', error);
    return null;
  }
}

export function isFirestoreLive(): boolean {
  return getDb() !== null;
}
