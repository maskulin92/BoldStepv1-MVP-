import { NextResponse } from 'next/server';
import { ApiError, withErrorHandling } from '@/lib/api-response';
import { assertClientAccess, requireCaller } from '@/lib/api-auth';
import { clientIdFromReportPath, decodeReportToken } from '@/lib/reports';
import { readMockFile, refreshSignedUrl } from '@/lib/storage';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ token: string }> };

/**
 * GET /api/reports/download/[token]
 * Authenticated via the session cookie, so a plain <a href> download works.
 */
export const GET = withErrorHandling(async (request: Request, context: Context) => {
  const { token } = await context.params;
  const caller = await requireCaller(request);

  const path = decodeReportToken(token);
  if (!path) throw new ApiError('NOT_FOUND', 'That report link is not valid.');

  const clientId = clientIdFromReportPath(path);
  if (!clientId) throw new ApiError('NOT_FOUND', 'That report link is not valid.');
  assertClientAccess(caller, clientId);

  const fileName = path.split('/').pop() ?? 'report';
  const contentType = fileName.endsWith('.pdf') ? 'application/pdf' : 'text/csv; charset=utf-8';

  const mockFile = readMockFile(path);
  if (mockFile) {
    return new NextResponse(new Uint8Array(mockFile.buffer), {
      headers: {
        'Content-Type': mockFile.contentType || contentType,
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  }

  const refreshed = await refreshSignedUrl(path);
  if (!refreshed) {
    throw new ApiError(
      'NOT_FOUND',
      'That report has expired. Generate it again from the dashboard.',
    );
  }
  return NextResponse.redirect(refreshed.download_url, 302);
});
