import { ApiError, list, withErrorHandling } from '@/lib/api-response';
import { enforceRateLimit, requireApiKey, requirePermission } from '@/lib/api-auth';
import { csvResponse } from '@/lib/csv';
import { getClient, listCampaigns, listInsights } from '@/lib/firestore';
import { defaultDateRange, isValidDateKey, paginate, round, sumInsights } from '@/lib/utils';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ clientId: string }> };

/**
 * GET /api/integrations/export/campaigns/[clientId]?format=json|csv&startDate=&endDate=
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

  const [campaigns, insights] = await Promise.all([
    listCampaigns(clientId),
    listInsights(clientId, startDate, endDate),
  ]);

  const rows = campaigns.map((campaign) => {
    const stats = sumInsights(insights.filter((i) => i.campaign_id === campaign.id));
    return {
      campaign_id: campaign.id,
      meta_campaign_id: campaign.meta_campaign_id,
      name: campaign.name,
      objective: campaign.objective,
      status: campaign.status,
      budget_daily: campaign.budget_daily,
      spend: round(stats.total_spend, 2),
      impressions: stats.total_impressions,
      clicks: stats.total_clicks,
      leads: stats.total_leads,
      conversions: stats.total_conversions,
      cpl: stats.avg_cpl,
      ctr: stats.avg_ctr,
      last_synced: campaign.last_synced,
    };
  });

  if (format === 'csv') {
    return csvResponse(rows, `boldstep-campaigns-${clientId}-${startDate}_${endDate}.csv`);
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
