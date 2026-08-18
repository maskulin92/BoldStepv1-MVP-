import 'server-only';
import { getBucket } from './firebase-admin';
import { mockStore } from './mock-store';
import { CREATIVE_URL_TTL_DAYS } from '@/constants/form-options';
import { sanitizeFileName } from './utils';

/**
 * Firebase Cloud Storage operations.
 *
 * Without Admin credentials, uploads are held in the in-memory mock store and
 * served back through /api/creatives/download/[creativeId] — so the upload →
 * library → download loop is testable before any bucket exists.
 */

export interface StoredFile {
  storage_path: string;
  download_url: string;
  url_expires_at: string;
}

export function creativeStoragePath(accountId: string, creativeId: string, fileName: string): string {
  return `creatives/${accountId}/${creativeId}-${sanitizeFileName(fileName)}`;
}

export function reportStoragePath(accountId: string, fileName: string): string {
  return `reports/${accountId}/${sanitizeFileName(fileName)}`;
}

function expiryDate(days = CREATIVE_URL_TTL_DAYS): Date {
  return new Date(Date.now() + days * 86400_000);
}

export function isStorageLive(): boolean {
  return getBucket() !== null;
}

/** Uploads bytes and returns a signed URL valid for `ttlDays` (default 7). */
export async function uploadFile(options: {
  path: string;
  buffer: Buffer;
  contentType: string;
  ttlDays?: number;
}): Promise<StoredFile> {
  const { path, buffer, contentType, ttlDays = CREATIVE_URL_TTL_DAYS } = options;
  const expires = expiryDate(ttlDays);
  const bucket = getBucket();

  if (!bucket) {
    mockStore().files.set(path, { buffer, contentType });
    return {
      storage_path: `mock://${path}`,
      // Resolved through the download route, which reads the mock store.
      download_url: '',
      url_expires_at: expires.toISOString(),
    };
  }

  const file = bucket.file(path);
  await file.save(buffer, {
    contentType,
    resumable: false,
    metadata: { cacheControl: 'private, max-age=0' },
  });

  const [url] = await file.getSignedUrl({ action: 'read', expires });
  return {
    storage_path: `gs://${bucket.name}/${path}`,
    download_url: url,
    url_expires_at: expires.toISOString(),
  };
}

/** Re-signs an object whose previous URL has passed its 7-day expiry. */
export async function refreshSignedUrl(
  storagePath: string,
  ttlDays = CREATIVE_URL_TTL_DAYS,
): Promise<StoredFile | null> {
  const bucket = getBucket();
  if (!bucket) return null;

  const objectPath = storagePath.replace(`gs://${bucket.name}/`, '').replace(/^gs:\/\/[^/]+\//, '');
  const file = bucket.file(objectPath);

  const [exists] = await file.exists();
  if (!exists) return null;

  const expires = expiryDate(ttlDays);
  const [url] = await file.getSignedUrl({ action: 'read', expires });
  return {
    storage_path: storagePath,
    download_url: url,
    url_expires_at: expires.toISOString(),
  };
}

/** Reads a mock-mode upload back out for the download route. */
export function readMockFile(path: string): { buffer: Buffer; contentType: string } | null {
  return mockStore().files.get(path.replace(/^mock:\/\//, '')) ?? null;
}

export function isUrlExpired(expiresAt: string | undefined): boolean {
  if (!expiresAt) return true;
  const time = new Date(expiresAt).getTime();
  return Number.isNaN(time) || time <= Date.now();
}
