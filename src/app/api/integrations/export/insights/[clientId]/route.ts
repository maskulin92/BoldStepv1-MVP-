import { ApiError, list, withErrorHandling } from '@/lib/api-response';
import { enforceRateLimit, requireApiKey, requirePermission } from '@/lib/api-auth';
import { csvResponse } from '@/lib/csv';
import { getClient, listInsights } from '@/lib/firestore';
import { defaultDateRange, isValidDateKey, paginate } from '@/lib/utils';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ clientId: string }> };

/**
 * GET /api/integrations/export/insights/[clientId]?format=json|csv&startDate=&endDate=&campaignId=
 * Auth: API key with `read`.
 */
export const GET = withErrorHandling(async (request: Request, context: Context) => {
  const { clientId } = await context.params;
  const caller = await requireApiKey(request);
  requirePermission(caller, 'read');
  enforceRateLimit(request, caller);

  const client = await getClient(clientId);
  if (!client) throw new ApiError('INVALID_CLIENT_ID', `No client with id "${clientId}".`);

  const url = new URL(request.url);
  const format = (url.searchParams.get('format') ?? 'json').toLowerCase();
  const fallback = defaultDateRange(30);
  const startDate = isValidDateKey(url.searchParams.get('startDate'))
    ? url.searchParams.get('startDate')!
    : fallback.start;
  const endDate = isValidDateKey(url.searchParams.get('endDate'))
    ? url.searchParams.get('endDate')!
    : fallback.end;

  const insights = await listInsights(
    clientId,
    startDate,
    endDate,
    url.searchParams.get('campaignId') ?? undefined,
  );

  const rows = insights.map((insight) => ({
    date: insight.date,
    campaign_id: insight.campaign_id,
    campaign_name: insight.campaign_name,
    spend: insight.spend,
    impressions: insight.impressions,
    clicks: insight.clicks,
    leads: insight.leads,
    conversions: insight.conversions,
    ctr: insight.ctr,
    cpm: insight.cpm,
    cpc: insight.cpc,
    cpl: insight.cpl,
    synced_at: insight.synced_at,
  }));

  if (format === 'csv') {
    return csvResponse(rows, `boldstep-insights-${clientId}-${startDate}_${endDate}.csv`);
  }
  if (format !== 'json') {
    throw new ApiError('VALIDATION_ERROR', 'format must be "json" or "csv".');
  }

  const { items, pagination } = paginate(
    rows,
    Number(url.searchParams.get('page') ?? 1),
    Number(url.searchParams.get('per_page') ?? 100),
  );
  return list(items, pagination);
});
