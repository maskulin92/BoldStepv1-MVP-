import { ApiError, ok, withErrorHandling } from '@/lib/api-response';
import { assertClientAccess, enforceRateLimit, requireCaller } from '@/lib/api-auth';
import { getClient, listInsights } from '@/lib/firestore';
import { buildTrend, defaultDateRange, isValidDateKey, sumInsights } from '@/lib/utils';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ accountId: string }> };

/**
 * GET /api/meta/insights/[accountId]?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 * Reads stored insights — it never calls Meta. The daily pull is Hermes' job
 * (Phase 2); this route serves whatever the last sync wrote.
 */
export const GET = withErrorHandling(async (request: Request, context: Context) => {
  const { accountId } = await context.params;
  const caller = await requireCaller(request);
  enforceRateLimit(request, caller);
  assertClientAccess(caller, accountId);

  const client = await getClient(accountId);
  if (!client) throw new ApiError('INVALID_CLIENT_ID', `No client with id "${accountId}".`);

  const url = new URL(request.url);
  const rawStart = url.searchParams.get('startDate');
  const rawEnd = url.searchParams.get('endDate');
  const campaignId = url.searchParams.get('campaignId') ?? undefined;

  const fallback = defaultDateRange(Number(url.searchParams.get('days') ?? 7) || 7);
  const startDate = isValidDateKey(rawStart) ? rawStart : fallback.start;
  const endDate = isValidDateKey(rawEnd) ? rawEnd : fallback.end;

  if (startDate > endDate) {
    throw new ApiError('VALIDATION_ERROR', 'startDate must be on or before endDate.');
  }

  const insights = await listInsights(accountId, startDate, endDate, campaignId);

  return ok({
    insights,
    trend: buildTrend(insights),
    summary: sumInsights(insights),
    range: { start: startDate, end: endDate },
  });
});
