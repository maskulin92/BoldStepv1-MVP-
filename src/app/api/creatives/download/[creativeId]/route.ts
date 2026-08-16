import { NextResponse } from 'next/server';
import { ApiError, withErrorHandling } from '@/lib/api-response';
import { assertClientAccess, requireCaller } from '@/lib/api-auth';
import { getCreative, updateCreative } from '@/lib/firestore';
import { isUrlExpired, readMockFile, refreshSignedUrl } from '@/lib/storage';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ creativeId: string }> };

/**
 * GET /api/creatives/download/[creativeId]
 *
 * Redirects to a valid signed URL, re-signing first if the stored one has
 * passed its 7-day window. In mock mode it streams the bytes held in memory.
 */
export const GET = withErrorHandling(async (request: Request, context: Context) => {
  const { creativeId } = await context.params;
  const caller = await requireCaller(request);

  const creative = await getCreative(creativeId);
  if (!creative) throw new ApiError('CREATIVE_NOT_FOUND', `No creative with id "${creativeId}".`);
  assertClientAccess(caller, creative.client_id);

  // Mock mode: serve from memory. Seeded demo creatives have no bytes behind
  // them, which is expected — a real upload in this session does.
  if (creative.storage_path.startsWith('mock://') || !creative.storage_path) {
    const file = readMockFile(creative.storage_path);
    if (!file) {
      throw new ApiError(
        'NOT_CONFIGURED',
        'This is a seeded demo creative with no file behind it. Upload a real file, or configure Firebase Storage.',
      );
    }
    return new NextResponse(new Uint8Array(file.buffer), {
      headers: {
        'Content-Type': file.contentType,
        'Content-Disposition': `attachment; filename="${creative.file_name}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  }

  let url = creative.download_url;
  if (!url || url.startsWith('/api/') || isUrlExpired(creative.url_expires_at)) {
    const refreshed = await refreshSignedUrl(creative.storage_path);
    if (!refreshed) {
      throw new ApiError('CREATIVE_NOT_FOUND', 'The stored file could not be found in the bucket.');
    }
    url = refreshed.download_url;
    await updateCreative(creative.id, creative.client_id, {
      download_url: refreshed.download_url,
      url_expires_at: refreshed.url_expires_at,
    });
  }

  return NextResponse.redirect(url, 302);
});
