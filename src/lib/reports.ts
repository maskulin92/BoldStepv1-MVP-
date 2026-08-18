import 'server-only';
import { ApiError } from './api-response';
import { getClient, listCampaigns, listInsights, listManualEntries } from './firestore';
import { reportStoragePath, uploadFile } from './storage';
import { reportFileName, type ReportPayload } from './export';
import type { Caller } from './api-auth';
import { assertClientAccess } from './api-auth';

/** Loads everything a report needs, honouring the caller's client scope. */
export async function loadReportPayload(options: {
  caller: Caller;
  accountId: string;
  range: { start: string; end: string };
}): Promise<ReportPayload> {
  const { caller, accountId, range } = options;
  assertClientAccess(caller, accountId);

  if (range.start > range.end) {
    throw new ApiError('VALIDATION_ERROR', 'date_range.start must be on or before date_range.end.');
  }

  const client = await getClient(accountId);
  if (!client) throw new ApiError('INVALID_CLIENT_ID', `No client with id "${accountId}".`);

  const [campaigns, insights, manualEntries] = await Promise.all([
    listCampaigns(accountId),
    listInsights(accountId, range.start, range.end),
    listManualEntries(accountId, { startDate: range.start, endDate: range.end }),
  ]);

  return {
    client: { id: client.id, name: client.name, primary_goal: client.primary_goal },
    range,
    campaigns,
    insights,
    manualEntries,
    generatedAt: new Date().toISOString(),
  };
}

/** Opaque handle for the download route: base64url of the storage path. */
export const encodeReportToken = (path: string): string =>
  Buffer.from(path, 'utf8').toString('base64url');

export function decodeReportToken(token: string): string | null {
  try {
    const path = Buffer.from(token, 'base64url').toString('utf8');
    // Only ever resolve paths inside the reports prefix — no traversal.
    if (!path.startsWith('reports/') || path.includes('..')) return null;
    return path;
  } catch {
    return null;
  }
}

/** Client id is the second segment of `reports/{accountId}/{file}`. */
export function clientIdFromReportPath(path: string): string | null {
  return path.split('/')[1] ?? null;
}

/** Stores a generated report and returns the handle the browser should hit. */
export async function storeReport(options: {
  accountId: string;
  range: { start: string; end: string };
  extension: 'pdf' | 'csv';
  buffer: Buffer;
  contentType: string;
}) {
  const { accountId, range, extension, buffer, contentType } = options;
  const fileName = reportFileName(accountId, range, extension);
  const path = reportStoragePath(accountId, fileName);

  const stored = await uploadFile({ path, buffer, contentType, ttlDays: 7 });

  return {
    report_id: encodeReportToken(path),
    file_name: fileName,
    // Always hand back our own route: it works in mock mode and re-signs a
    // stale bucket URL in live mode.
    download_url: `/api/reports/download/${encodeReportToken(path)}`,
    signed_url: stored.download_url || null,
    expires_at: stored.url_expires_at,
    size_bytes: buffer.byteLength,
    storage_path: stored.storage_path,
  };
}
