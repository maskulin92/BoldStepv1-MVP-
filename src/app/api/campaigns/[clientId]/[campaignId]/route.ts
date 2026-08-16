import { ApiError, ok, withErrorHandling } from '@/lib/api-response';
import { assertClientAccess, enforceRateLimit, requireCaller } from '@/lib/api-auth';
import { getCampaign, listAdSets, listInsights, listPendingActions } from '@/lib/firestore';
import { buildTrend, defaultDateRange, deriveRates, round, sumInsights } from '@/lib/utils';
import type { DailyInsight } from '@/types';

export const dynamic = 'force-dynamic';

/** Rolls one ad set's slice of `by_adset` up across every day in the window. */
function sumAdSetMetrics(insights: DailyInsight[], adSetId: string) {
  const totals = insights.reduce(
    (acc, insight) => {
      const metrics = insight.by_adset?.[adSetId];
      if (!metrics) return acc;
      return {
        spend: acc.spend + (metrics.spend || 0),
        impressions: acc.impressions + (metrics.impressions || 0),
        clicks: acc.clicks + (metrics.clicks || 0),
        leads: acc.leads + (metrics.leads || 0),
        conversions: acc.conversions + (metrics.conversions || 0),
      };
    },
    { spend: 0, impressions: 0, clicks: 0, leads: 0, conversions: 0 },
  );

  return deriveRates({ ...totals, spend: round(totals.spend, 2) });
}

type Context = { params: Promise<{ clientId: string; campaignId: string }> };

/**
 * GET /api/campaigns/[clientId]/[campaignId]
 * Full drill-down: ad sets, 7d and 30d insight windows, open actions.
 */
export const GET = withErrorHandling(async (request: Request, context: Context) => {
  const { clientId, campaignId } = await context.params;
  const caller = await requireCaller(request);
  enforceRateLimit(request, caller);
  assertClientAccess(caller, clientId);

  const campaign = await getCampaign(clientId, campaignId);
  if (!campaign) {
    throw new ApiError('INVALID_CAMPAIGN_ID', `No campaign "${campaignId}" for this client.`);
  }

  const range7 = defaultDateRange(7);
  const range30 = defaultDateRange(30);

  const [adSets, insights30, actions] = await Promise.all([
    listAdSets(clientId, campaignId),
    listInsights(clientId, range30.start, range30.end, campaignId),
    caller.role === 'owner' ? listPendingActions({ clientId }) : Promise.resolve([]),
  ]);

  const insights7 = insights30.filter((i) => i.date >= range7.start);

  return ok({
    campaign,
    ad_sets: adSets.map((adSet) => ({
      ...adSet,
      stats: sumAdSetMetrics(insights30, adSet.id),
    })),
    insights_7d: insights7,
    insights_30d: insights30,
    trend_30d: buildTrend(insights30),
    summary_7d: sumInsights(insights7),
    summary_30d: sumInsights(insights30),
    pending_actions: actions.filter((a) => a.campaign_id === campaignId),
  });
});
