import { ApiError, ok, withErrorHandling } from '@/lib/api-response';
import { assertClientAccess, enforceRateLimit, requireCaller } from '@/lib/api-auth';
import { getClient, listCampaigns, listInsights } from '@/lib/firestore';
import { defaultDateRange, isValidDateKey, sumInsights } from '@/lib/utils';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ clientId: string }> };

/**
 * GET /api/campaigns/[clientId]?startDate=&endDate=
 * Campaigns with per-campaign totals for the window, plus a client summary.
 */
export const GET = withErrorHandling(async (request: Request, context: Context) => {
  const { clientId } = await context.params;
  const caller = await requireCaller(request);
  enforceRateLimit(request, caller);
  assertClientAccess(caller, clientId);

  const client = await getClient(clientId);
  if (!client) throw new ApiError('INVALID_CLIENT_ID', `No client with id "${clientId}".`);

  const url = new URL(request.url);
  const fallback = defaultDateRange(Number(url.searchParams.get('days') ?? 7));
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

  const withStats = campaigns.map((campaign) => ({
    ...campaign,
    stats: sumInsights(insights.filter((i) => i.campaign_id === campaign.id)),
  }));

  return ok({
    campaigns: withStats,
    range: { start: startDate, end: endDate },
    summary: sumInsights(insights),
  });
});
