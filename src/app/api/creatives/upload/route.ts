import { ApiError, created, withErrorHandling } from '@/lib/api-response';
import { assertClientAccess, enforceRateLimit, requireCaller, requirePermission } from '@/lib/api-auth';
import { createCreative, getClient } from '@/lib/firestore';
import { creativeStoragePath, uploadFile } from '@/lib/storage';
import { ALLOWED_UPLOAD_TYPES, MAX_UPLOAD_BYTES } from '@/constants/form-options';
import { dispatchWebhook } from '@/lib/webhooks';
import { sanitizeFileName } from '@/lib/utils';
import { randomUUID } from 'node:crypto';
import type { Creative } from '@/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/creatives/upload   (multipart/form-data)
 *   file, client_id, campaign_id, adset_id?
 *
 * Stores the file and returns a signed URL that expires in 7 days.
 *
 * Owner uploads publish immediately. Client uploads land in the review queue
 * (status: pending_review) and only appear in the client library and Top
 * Performing Ads once approved at POST /api/creatives/review/[id].
 */
export const POST = withErrorHandling(async (request: Request) => {
  const caller = await requireCaller(request);
  requirePermission(caller, 'write');
  enforceRateLimit(request, caller, 30, 'creatives-upload');

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new ApiError('VALIDATION_ERROR', 'Expected a multipart/form-data body.');
  }

  const file = form.get('file');
  const clientId = String(form.get('client_id') ?? '');
  const campaignId = String(form.get('campaign_id') ?? '');
  const adSetId = form.get('adset_id') ? String(form.get('adset_id')) : undefined;

  if (!(file instanceof File)) {
    throw new ApiError('VALIDATION_ERROR', 'A "file" field is required.');
  }
  if (!clientId || !campaignId) {
    throw new ApiError('VALIDATION_ERROR', 'client_id and campaign_id are required.');
  }
  assertClientAccess(caller, clientId);

  const client = await getClient(clientId);
  if (!client) throw new ApiError('INVALID_CLIENT_ID', `No client with id "${clientId}".`);

  if (file.size > MAX_UPLOAD_BYTES) {
    throw new ApiError('FILE_TOO_LARGE', `Files must be under ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`, {
      size_bytes: file.size,
    });
  }

  const contentType = file.type || 'application/octet-stream';
  if (!ALLOWED_UPLOAD_TYPES.includes(contentType as (typeof ALLOWED_UPLOAD_TYPES)[number])) {
    throw new ApiError('UNSUPPORTED_FILE_TYPE', `"${contentType}" is not an accepted creative format.`, {
      allowed: ALLOWED_UPLOAD_TYPES,
    });
  }

  const creativeId = `crv-${randomUUID().slice(0, 8)}`;
  const fileName = sanitizeFileName(file.name);
  const path = creativeStoragePath(clientId, creativeId, fileName);

  const stored = await uploadFile({
    path,
    buffer: Buffer.from(await file.arrayBuffer()),
    contentType,
  });

  const creative: Creative = {
    id: creativeId,
    client_id: clientId,
    file_name: fileName,
    file_type: contentType.startsWith('video/') ? 'video' : 'image',
    content_type: contentType,
    storage_path: stored.storage_path,
    campaign_id: campaignId,
    adset_id: adSetId,
    // In mock mode there is no signed URL — the download route serves the bytes.
    download_url: stored.download_url || `/api/creatives/download/${creativeId}`,
    url_expires_at: stored.url_expires_at,
    uploaded_at: new Date().toISOString(),
    size_bytes: file.size,
    // Owner uploads publish immediately; client uploads await review.
    status: caller.role === 'owner' ? 'approved' : 'pending_review',
    uploaded_by: caller.role === 'owner' ? 'fadhil' : 'client',
  };

  await createCreative(creative);
  void dispatchWebhook('creative.uploaded', creative);

  return created({
    creative_id: creative.id,
    creative,
    download_url: creative.download_url,
    expires_at: creative.url_expires_at,
    ...(caller.role === 'owner'
      ? {}
      : { note: 'Uploaded for review — it appears in the library once approved.' }),
  });
});
